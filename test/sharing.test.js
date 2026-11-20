// Shared folders on the desktop: the readable copies a shared folder uploads, kept in step with the local meetings.
const test = require('node:test');
const assert = require('node:assert/strict');
const { SharingManager } = require('../src/main/sharing');
const { newRepo } = require('./helpers');

const offline = () => Object.assign(new Error('offline'), { code: 'offline', status: 0 });

/** What the backend does for the routes the desktop uses, in memory. */
class FakeServer {
  constructor() { this.folders = []; this.meetings = []; this.segments = {}; this.shared = {}; this.names = {}; this.down = false; this.n = 0; this.calls = []; }
  api() {
    const s = this;
    const guard = (name) => { s.calls.push(name); if (s.down) throw offline(); };
    return {
      serverFolders: async () => { guard('serverFolders'); return s.folders.slice(); },
      createServerFolder: async (name) => {
        guard('createServerFolder');
        const hit = s.folders.find((f) => f.name === name);
        if (hit) throw Object.assign(new Error('folder_exists'), { status: 409, code: 'folder_exists' });
        const f = { id: `srv_f${++s.n}`, name }; s.folders.push(f); return f;
      },
      shareServerFolder: async (id, orgId) => { guard('shareServerFolder'); s.shared[id] = orgId; return { id }; },
      unshareServerFolder: async (id) => {
        guard('unshareServerFolder');
        delete s.shared[id];
        s.meetings = s.meetings.filter((m) => !(m.folder_id === id && m.share_copy));   // the server deletes the copies itself
      },
      createCopy: async (body) => {
        guard('createCopy');
        const prior = s.meetings.find((m) => m.client_id === body.client_id);
        if (prior) return prior;
        const m = { id: `srv_m${++s.n}`, ...body }; s.meetings.push(m); s.segments[m.id] = []; return m;
      },
      addCopySegments: async (id, body) => {
        guard('addCopySegments');
        for (const seg of body.segments) if (!s.segments[id].some((x) => x.client_id === seg.client_id)) s.segments[id].push(seg);
      },
      nameCopySpeaker: async (id, key, name) => { guard('nameCopySpeaker'); (s.names[id] ||= {})[key] = name; },
      deleteCopy: async (id) => { guard('deleteCopy'); s.meetings = s.meetings.filter((m) => m.id !== id); },
    };
  }
}

function finished(repo, folderId, title = 'Weekly') {
  const m = repo.createMeeting({ title, folderId, status: 'done', startedAt: '2026-11-19T09:00:00.000Z' });
  repo.updateMeeting(m.id, { status: 'done', endedAt: '2026-11-19T09:30:00.000Z', durationSeconds: 1800, notesState: 'ready', summary: 'We agreed the plan.' });
  repo.addSegments(m.id, [{ clientId: 'c1', text: 'Hello team', speakerKey: 'spk_me', source: 'mic', startMs: 0 },
    { clientId: 'c2', text: 'Ship it on Friday', speakerKey: 'spk_2', source: 'system', startMs: 5000 }]);
  repo.addTask(m.id, 'Send the deck', { owner: 'Ana' });
  return repo.getMeeting(m.id);
}

function setup() {
  const { repo } = newRepo();
  const srv = new FakeServer();
  const sharing = new SharingManager({ repo, api: srv.api(), ownerName: () => 'Ana' });
  const folder = repo.createFolder('Team');
  return { repo, srv, sharing, folder };
}

test('sharing a folder uploads one marked copy per finished meeting and remembers it', async () => {
  const { repo, srv, sharing, folder } = setup();
  const a = finished(repo, folder.id, 'One');
  finished(repo, folder.id, 'Two');
  repo.createMeeting({ title: 'Still recording', folderId: folder.id, status: 'recording' });
  await sharing.shareFolder(folder.id, 'org1', { includeTranscript: false });
  assert.equal(srv.meetings.length, 2);
  const copy = srv.meetings.find((m) => m.title === 'One');
  assert.equal(copy.share_copy, true);
  assert.equal(copy.source, 'local');
  assert.equal(copy.status, 'done');
  assert.equal(copy.client_id, a.id);
  assert.equal(copy.summary, 'We agreed the plan.');
  assert.deepEqual(copy.action_items.map((t) => t.text), ['Send the deck']);
  assert.equal(copy.started_at, '2026-11-19T09:00:00.000Z');
  assert.equal(srv.shared[copy.folder_id], 'org1');
  assert.equal(repo.getMeeting(a.id).shareCopyId, copy.id);
  assert.equal(repo.listFolders().find((f) => f.id === folder.id).share.orgId, 'org1');
});

test('the transcript is uploaded only when the owner ticked it', async () => {
  const { repo, srv, sharing, folder } = setup();
  const m = finished(repo, folder.id);
  await sharing.shareFolder(folder.id, 'org1', { includeTranscript: false });
  assert.deepEqual(srv.segments[srv.meetings[0].id], []);
  await sharing.unshareFolder(folder.id);
  await sharing.shareFolder(folder.id, 'org1', { includeTranscript: true });
  const lines = srv.segments[srv.meetings[0].id];
  assert.deepEqual(lines.map((l) => l.text), ['Hello team', 'Ship it on Friday']);
  assert.equal(lines[0].client_id, 'c1');
  assert.ok(repo.getMeeting(m.id).shareCopyId);
});

test('running the share twice creates no duplicates', async () => {
  const { repo, srv, sharing, folder } = setup();
  finished(repo, folder.id);
  await sharing.shareFolder(folder.id, 'org1', {});
  await sharing.shareFolder(folder.id, 'org1', {});
  assert.equal(srv.meetings.length, 1);
  assert.equal(srv.folders.length, 1);
});

test('a server folder with the same name is reused', async () => {
  const { repo, srv, sharing, folder } = setup();
  srv.folders.push({ id: 'srv_old', name: 'Team' });
  finished(repo, folder.id);
  await sharing.shareFolder(folder.id, 'org1', {});
  assert.equal(srv.meetings[0].folder_id, 'srv_old');
  assert.equal(srv.folders.length, 1);
});

test('unsharing clears the folder share and every remembered copy', async () => {
  const { repo, srv, sharing, folder } = setup();
  const m = finished(repo, folder.id);
  await sharing.shareFolder(folder.id, 'org1', {});
  await sharing.unshareFolder(folder.id);
  assert.equal(srv.meetings.length, 0);
  assert.equal(repo.listFolders().find((f) => f.id === folder.id).share, null);
  assert.equal(repo.getMeeting(m.id).shareCopyId, null);
});

test('offline leaves the meeting pending and syncPending finishes it later', async () => {
  const { repo, srv, sharing, folder } = setup();
  const m = finished(repo, folder.id);
  await sharing.shareFolder(folder.id, 'org1', {});
  const later = finished(repo, folder.id, 'Later');
  srv.down = true;
  await sharing.syncMeeting(later.id);                       // must not throw
  assert.equal(repo.getMeeting(later.id).shareCopyId || null, null);
  srv.down = false;
  assert.equal(await sharing.syncPending(), 1);
  assert.ok(repo.getMeeting(later.id).shareCopyId);
  assert.equal(srv.meetings.length, 2);
  assert.ok(repo.getMeeting(m.id).shareCopyId);
});

test('a changed meeting replaces its copy; an unchanged one is left alone', async () => {
  const { repo, srv, sharing, folder } = setup();
  const m = finished(repo, folder.id);
  await sharing.shareFolder(folder.id, 'org1', {});
  const calls = srv.calls.length;
  await sharing.syncMeeting(m.id);
  assert.equal(srv.calls.length, calls, 'nothing to do when nothing changed');
  repo.updateMeeting(m.id, { summary: 'A better summary.' });
  await sharing.syncMeeting(m.id);
  assert.equal(srv.meetings.length, 1);
  assert.equal(srv.meetings[0].summary, 'A better summary.');
});

test('moving a meeting out of the shared folder removes its copy', async () => {
  const { repo, srv, sharing, folder } = setup();
  const m = finished(repo, folder.id);
  await sharing.shareFolder(folder.id, 'org1', {});
  repo.updateMeeting(m.id, { folderId: null });
  await sharing.syncMeeting(m.id);
  assert.equal(srv.meetings.length, 0);
  assert.equal(repo.getMeeting(m.id).shareCopyId, null);
});

test('deleting a meeting removes its copy, and an offline delete is retried', async () => {
  const { repo, srv, sharing, folder } = setup();
  const m = finished(repo, folder.id);
  const n = finished(repo, folder.id, 'Other');
  await sharing.shareFolder(folder.id, 'org1', {});
  await sharing.removeMeetingCopy(m.id);
  repo.deleteMeeting(m.id);
  assert.equal(srv.meetings.length, 1);
  srv.down = true;
  await sharing.removeMeetingCopy(n.id);                     // offline: remembered, not lost
  repo.deleteMeeting(n.id);
  assert.equal(srv.meetings.length, 1);
  srv.down = false;
  await sharing.syncPending();
  assert.equal(srv.meetings.length, 0);
});

test('a meeting added to a shared folder later gets a copy', async () => {
  const { repo, srv, sharing, folder } = setup();
  await sharing.shareFolder(folder.id, 'org1', {});
  const m = finished(repo, folder.id);
  await sharing.syncMeeting(m.id);
  assert.equal(srv.meetings.length, 1);
});

test('meetings outside shared folders are never uploaded', async () => {
  const { repo, srv, sharing, folder } = setup();
  const other = repo.createFolder('Private');
  const m = finished(repo, other.id);
  await sharing.shareFolder(folder.id, 'org1', {});
  await sharing.syncMeeting(m.id);
  assert.equal(srv.meetings.length, 0);
});

test('schedule uploads a changed meeting after a short wait, once, however many changes came', async () => {
  const { repo, srv, sharing, folder } = setup();
  await sharing.shareFolder(folder.id, 'org1', {});
  const m = finished(repo, folder.id);
  sharing.schedule(m.id, 5);
  sharing.schedule(m.id, 5);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(srv.meetings.length, 1);
  assert.equal(srv.calls.filter((c) => c === 'createCopy').length, 1);
  sharing.stop();
});

test('with the transcript, speakers go with their names so teammates do not see raw keys', async () => {
  const { repo, srv, sharing, folder } = setup();
  const m = finished(repo, folder.id);
  repo.renameSpeaker(m.id, 'spk_2', 'Bruno');
  await sharing.shareFolder(folder.id, 'org1', { includeTranscript: true });
  assert.deepEqual(srv.names[srv.meetings[0].id], { spk_me: 'Ana', spk_2: 'Bruno' });
});

test('without the transcript no speaker names are sent', async () => {
  const { repo, srv, sharing, folder } = setup();
  finished(repo, folder.id);
  await sharing.shareFolder(folder.id, 'org1', { includeTranscript: false });
  assert.deepEqual(srv.names, {});
});

// ---- final review fixes ------------------------------------------------------------------------------------------------------

test('the share fields never travel through encrypted sync, and sync keeps this computer\'s own', () => {
  const { snapshot, SyncManager } = require('../src/main/sync');
  const { repo, store } = newRepo();
  const m = finished(repo, null);
  repo.setShareCopy(m.id, { copyId: 'srv_m1', version: 3 });
  const snap = snapshot(repo.getMeeting(m.id));
  assert.equal('shareCopyId' in snap, false);
  assert.equal('shareSyncedVersion' in snap, false);
  assert.equal('shareAttempt' in snap, false);
  const sync = new SyncManager({ repo, store, api: {}, secure: {} });
  sync._keepAsCopy(repo.getMeeting(m.id));
  const copy = repo.d.meetings.find((x) => x.id !== m.id);
  assert.ok(!copy.shareCopyId && !copy.shareAttempt, 'a conflict copy is not the shared copy');
  sync._place({ ...JSON.parse(JSON.stringify(repo.getMeeting(m.id))), shareCopyId: undefined, summary: 'from another computer' });
  assert.equal(repo.getMeeting(m.id).shareCopyId, 'srv_m1', 'what came from another computer must not wipe the local share mark');
});

test('edits to my notes, tasks and speaker names reach the copy', async () => {
  const { repo, srv, sharing, folder } = setup();
  const m = finished(repo, folder.id);
  await sharing.shareFolder(folder.id, 'org1', { includeTranscript: true });
  repo.setMyNotes(m.id, 'A new note');
  assert.equal(await sharing.syncMeeting(m.id), true);
  assert.equal(srv.meetings[0].user_notes, 'A new note');
  repo.addTask(m.id, 'Book the room');
  await sharing.syncMeeting(m.id);
  assert.deepEqual(srv.meetings[0].action_items.map((t) => t.text), ['Send the deck', 'Book the room']);
  repo.renameSpeaker(m.id, 'spk_2', 'Carla');
  await sharing.syncMeeting(m.id);
  assert.equal(srv.names[srv.meetings[0].id].spk_2, 'Carla');
  assert.equal(await sharing.syncMeeting(m.id), false, 'unchanged again: nothing to do');
});

test('deleting a shared folder stops sharing it and removes the copies, offline too', async () => {
  const { repo, srv, sharing, folder } = setup();
  const m = finished(repo, folder.id);
  await sharing.shareFolder(folder.id, 'org1', {});
  await sharing.folderWillBeDeleted(folder.id);
  repo.deleteFolder(folder.id);
  assert.equal(srv.meetings.length, 0);
  assert.equal(Object.keys(srv.shared).length, 0);
  assert.equal(repo.getMeeting(m.id).shareCopyId, null);

  const b = setup();
  const m2 = finished(b.repo, b.folder.id);
  await b.sharing.shareFolder(b.folder.id, 'org1', {});
  b.srv.down = true;
  await b.sharing.folderWillBeDeleted(b.folder.id);              // offline: must not throw nor block the delete
  b.repo.deleteFolder(b.folder.id);
  b.srv.down = false;
  await b.sharing.syncPending();
  assert.equal(b.srv.meetings.length, 0);
  assert.equal(b.repo.getMeeting(m2.id).shareCopyId, null);
});

test('a delete that failed for any reason other than offline is remembered, not lost', async () => {
  const { repo, srv, sharing, folder } = setup();
  const m = finished(repo, folder.id);
  await sharing.shareFolder(folder.id, 'org1', {});
  const real = sharing.api.deleteCopy;
  sharing.api.deleteCopy = async () => { throw Object.assign(new Error('unauthorised'), { status: 401, code: 'unauthorized' }); };
  await sharing.removeMeetingCopy(m.id);
  repo.deleteMeeting(m.id);
  assert.equal(srv.meetings.length, 1);
  assert.equal(repo.shareTombstones().length, 1);
  sharing.api.deleteCopy = real;
  await sharing.syncPending();
  assert.equal(srv.meetings.length, 0);
});

test('a copy whose upload reply was lost is found again and removed when the meeting leaves', async () => {
  const { repo, srv, sharing, folder } = setup();
  const m = finished(repo, folder.id);
  await sharing.shareFolder(folder.id, 'org1', {});
  const real = sharing.api.createCopy;
  repo.updateMeeting(m.id, { summary: 'Changed' });
  let lost = true;
  sharing.api.createCopy = async (body) => { const r = await real(body); if (lost) { lost = false; throw offline(); } return r; };
  await sharing.syncMeeting(m.id);                                // the server created it, the reply never came
  assert.equal(srv.meetings.length, 1);
  assert.equal(repo.getMeeting(m.id).shareCopyId || null, null);
  repo.updateMeeting(m.id, { folderId: null });                   // the meeting leaves the shared folder meanwhile
  await sharing.syncMeeting(m.id);
  assert.equal(srv.meetings.length, 0, 'the copy must not stay readable');
});

test('one meeting the server keeps refusing does not stop the others', async () => {
  const { repo, srv, sharing, folder } = setup();
  const bad = finished(repo, folder.id, 'Refused');
  const good = finished(repo, folder.id, 'Fine');
  const real = sharing.api.createCopy;
  sharing.api.createCopy = async (body) => { if (body.title === 'Refused') throw Object.assign(new Error('422'), { status: 422, code: 'validation_error' }); return real(body); };
  await sharing.syncPending().catch(() => {});
  await sharing.shareFolder(folder.id, 'org1', {}).catch(() => {});
  await sharing.syncPending().catch(() => {});
  assert.ok(repo.getMeeting(good.id).shareCopyId, 'the good meeting is uploaded');
  assert.ok(!repo.getMeeting(bad.id).shareCopyId);
});

test('what is sent respects the server limits', async () => {
  const { repo, srv, sharing, folder } = setup();
  const m = finished(repo, folder.id);
  repo.updateMeeting(m.id, { attendees: Array.from({ length: 130 }, (_, i) => ({ name: 'N'.repeat(300) + i, email: `p${i}@x.ao` })) });
  repo.addTask(m.id, 'T', { owner: 'O'.repeat(300) });
  await sharing.shareFolder(folder.id, 'org1', { includeTranscript: true });
  const copy = srv.meetings[0];
  assert.equal(copy.attendees.length, 100);
  assert.ok(copy.attendees.every((a) => a.name.length <= 120));
  assert.ok(copy.action_items.every((a) => a.owner.length <= 120));
});

test('two syncs of the same meeting at once upload it once', async () => {
  const { repo, srv, sharing, folder } = setup();
  const m = finished(repo, folder.id);
  await sharing.shareFolder(folder.id, 'org1', {});
  repo.updateMeeting(m.id, { summary: 'Changed again' });
  const before = srv.calls.filter((c) => c === 'createCopy').length;
  await Promise.all([sharing.syncMeeting(m.id), sharing.syncMeeting(m.id)]);
  assert.equal(srv.calls.filter((c) => c === 'createCopy').length - before, 1);
});
