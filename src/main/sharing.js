const crypto = require('crypto');
const { toMarkdown } = require('./export');

const BATCH = 100;                                   // transcript lines per upload (the server's limit)
const isOffline = (err) => !!err && (err.code === 'offline' || err.status === 0);
const isGone = (err) => !!err && err.status === 404;
const cut = (value, n) => String(value == null ? '' : value).slice(0, n);

/**
 * Shared folders. The person shares a local folder with an organisation; the server then holds a readable COPY of each finished
 * meeting in it (the encrypted sync copy cannot be read by teammates). This class keeps those copies in step with the local meetings:
 * uploads new and changed ones, removes the copy when a meeting leaves the folder or is deleted, and removes them all on unshare.
 *
 * A copy is replaced, never patched: delete the old one and upload the new one with the same client id (the local meeting id).
 * Offline is never an error here: what could not be done stays pending (`syncPending`), and deletes that could not be sent are remembered.
 * What a meeting looked like when its copy was made is a fingerprint of everything the copy contains (`_stamp`), so edits that do not
 * touch the meeting's version (notes, tasks, speaker names) still reach the copy.
 */
class SharingManager {
  constructor({ repo, api, emit = () => {}, ownerName = () => '' }) {
    this.repo = repo;
    this.api = api;
    this.emit = emit;
    this.ownerName = ownerName;                     // what teammates see for the owner's own voice
    this.timers = new Map();
    this.locks = new Map();
    this.interval = null;
  }

  /** A meeting changed: look at it again in a moment (many quick changes make one upload). */
  schedule(id, ms = 4000) {
    clearTimeout(this.timers.get(id));
    this.timers.set(id, setTimeout(() => {
      this.timers.delete(id);
      this.syncMeeting(id).catch((err) => this.emit('share:error', { id, code: err.code, message: err.message }));
    }, ms));
  }

  /** Retry what is pending now and then (offline, restarts). */
  start(everyMs = 5 * 60 * 1000) {
    if (this.interval) return;
    this.syncPending().catch(() => {});
    this.interval = setInterval(() => this.syncPending().catch(() => {}), everyMs);
  }

  stop() {
    clearInterval(this.interval); this.interval = null;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  /** Share a local folder with an organisation and upload its finished meetings. Errors other than "offline" reach the caller (plan, policy...). */
  async shareFolder(localFolderId, orgId, { includeTranscript = false, orgName = '' } = {}) {
    const folder = this.repo.getFolder(localFolderId);
    if (!folder) { const e = new Error('folder_not_found'); e.code = 'not_found'; throw e; }
    const serverFolderId = (folder.share && folder.share.serverFolderId) || await this._serverFolder(folder.name);
    await this.api.shareServerFolder(serverFolderId, orgId);
    this.repo.setFolderShare(localFolderId, { serverFolderId, orgId, orgName, includeTranscript: !!includeTranscript });
    for (const m of this._inFolder(localFolderId)) await this.syncMeeting(m.id);
    this.emit('share', localFolderId);
  }

  /** Stop sharing: the server removes its copies; every local mark of a copy is cleared. Needs the network (access ends on the server). */
  async unshareFolder(localFolderId) {
    const folder = this.repo.getFolder(localFolderId);
    if (!folder || !folder.share) return;
    await this.api.unshareServerFolder(folder.share.serverFolderId);
    for (const m of this._inFolder(localFolderId)) { this.repo.setShareCopy(m.id, null); this.repo.setShareAttempt(m.id, null); }
    this.repo.setFolderShare(localFolderId, null);
    this.emit('share', localFolderId);
  }

  /**
   * Call before a local folder is deleted. A shared folder is un-shared first (the server removes the copies and the share). If that cannot
   * be done now (offline), the folder is deleted anyway and its meetings' copies are removed later. Returns the meetings to look at again.
   */
  async folderWillBeDeleted(localFolderId) {
    const folder = this.repo.getFolder(localFolderId);
    if (!folder || !folder.share) return [];
    const ids = this._inFolder(localFolderId).filter((m) => m.shareCopyId || m.shareAttempt).map((m) => m.id);
    try { await this.unshareFolder(localFolderId); return []; } catch { return ids; }
  }

  /**
   * Bring one meeting's copy up to date: upload, replace, or remove it, depending on where the meeting is now.
   * Offline is not an error (the meeting stays pending). Returns true when something was done. One meeting is handled one at a time.
   */
  syncMeeting(id) {
    const run = (this.locks.get(id) || Promise.resolve()).then(async () => {
      try { return await this._sync(id); } catch (err) { if (isOffline(err)) return false; throw err; }
    });
    const tail = run.catch(() => {});
    this.locks.set(id, tail);
    tail.then(() => { if (this.locks.get(id) === tail) this.locks.delete(id); });
    return run;
  }

  /** The person deleted or is deleting a meeting: its copy goes too (remembered when it cannot be done now). */
  async removeMeetingCopy(id) {
    const m = this.repo.getMeeting(id);
    if (m && (m.shareCopyId || m.shareAttempt)) await this._recover(m);
    const again = this.repo.getMeeting(id);
    if (again && again.shareCopyId) await this._drop(again, { remember: true });
  }

  /** Everything that was left undone (offline, restart): deletes first, then uploads. One refused meeting never blocks the others. Returns how many things were brought up to date. */
  async syncPending() {
    let done = 0;
    for (const copyId of this.repo.shareTombstones()) {
      try {
        try { await this.api.deleteCopy(copyId); } catch (err) { if (!isGone(err)) throw err; }
        this.repo.clearShareTombstone(copyId);
        done += 1;
      } catch (err) {
        if (isOffline(err)) return done;
        this.emit('share:error', { id: copyId, code: err.code, message: err.message });
      }
    }
    for (const m of this.repo.d.meetings.slice()) {
      const folder = m.folderId ? this.repo.getFolder(m.folderId) : null;
      const share = folder && folder.share;
      const stale = share
        ? (m.status === 'done' && m.notesState !== 'writing' && (!m.shareCopyId || m.shareSyncedVersion !== this._stamp(m, share)))
        : !!(m.shareCopyId || m.shareAttempt);
      if (!stale) continue;
      try {
        if (await this.syncMeeting(m.id)) done += 1;
      } catch (err) {
        this.emit('share:error', { id: m.id, code: err.code, message: err.message });
      }
    }
    return done;
  }

  // --- internals -------------------------------------------------------------------------------

  async _sync(id) {
    let m = this.repo.getMeeting(id);
    if (!m) return false;
    if (!m.shareCopyId && m.shareAttempt) { await this._recover(m); m = this.repo.getMeeting(id); }
    const folder = m.folderId ? this.repo.getFolder(m.folderId) : null;
    const share = folder && folder.share;
    if (!share) { if (m.shareCopyId) { await this._drop(m, { remember: true }); return true; } return false; }
    if (m.status !== 'done' || m.notesState === 'writing') return false;         // not finished yet: later
    const stamp = this._stamp(m, share);
    if (m.shareCopyId && m.shareSyncedVersion === stamp) return false;           // nothing changed
    if (m.shareCopyId) await this._drop(m, { remember: false });
    this.repo.setShareAttempt(id, share.serverFolderId);                         // if the reply is lost, this is how the copy is found again
    const copy = await this.api.createCopy(this._body(m, share));
    this.repo.setShareCopy(id, { copyId: copy.id, version: null });              // remembered at once: a failed upload below is retried, not duplicated
    this.repo.setShareAttempt(id, null);
    if (share.includeTranscript) await this._lines(copy.id, m);
    this.repo.setShareCopy(id, { copyId: copy.id, version: stamp });
    return true;
  }

  /** An upload whose reply never came: ask the server again (it answers with the same copy) so the copy can be tracked, replaced or removed. */
  async _recover(m) {
    if (m.shareCopyId || !m.shareAttempt) return;
    const copy = await this.api.createCopy(this._body(m, { serverFolderId: m.shareAttempt, includeTranscript: false }));
    this.repo.setShareCopy(m.id, { copyId: copy.id, version: null });
    this.repo.setShareAttempt(m.id, null);
  }

  _inFolder(folderId) { return this.repo.d.meetings.filter((m) => m.folderId === folderId); }

  /** The server folder for this name: create it, or reuse the one that already has the name. */
  async _serverFolder(name) {
    try {
      return (await this.api.createServerFolder(name)).id;
    } catch (err) {
      if (err.code !== 'folder_exists') throw err;
      const hit = (await this.api.serverFolders()).find((f) => f.name === name);
      if (!hit) throw err;
      return hit.id;
    }
  }

  /**
   * Remove the server copy of a meeting. `remember`: the copy is not wanted any more and the meeting may be gone, so any failure other than
   * "not there" is kept as a pending delete. Without it (a copy about to be replaced) only a lost connection is remembered; other errors reach the caller.
   */
  async _drop(m, { remember = false } = {}) {
    const copyId = m.shareCopyId;
    try {
      await this.api.deleteCopy(copyId);
    } catch (err) {
      if (isGone(err)) { /* already gone */ }
      else if (isOffline(err) || remember) this.repo.addShareTombstone(copyId);
      else throw err;
    }
    this.repo.setShareCopy(m.id, null);
  }

  _names(m) {
    const out = {};
    for (const key of new Set(m.segments.map((x) => x.speakerKey))) {
      const sp = m.speakers[key] || {};
      const name = sp.isMe && !sp.name ? this.ownerName() : this.repo.speakerName(m, key);
      if (name) out[key] = cut(name, 80);
    }
    return out;
  }

  async _lines(copyId, m) {
    const rows = m.segments.map((s) => ({
      client_id: cut(s.clientId || `seg_${s.id}`, 64), speaker_key: cut(s.speakerKey, 30), source: s.source === 'mic' ? 'mic' : 'system', text: cut(s.text, 4000),
      language: s.language ? cut(s.language, 10) : null, translation: s.translation ? cut(s.translation, 4000) : null, start_ms: s.startMs || 0, end_ms: s.startMs || 0,
    }));
    for (let i = 0; i < rows.length; i += BATCH) await this.api.addCopySegments(copyId, { segments: rows.slice(i, i + BATCH) });
    for (const [key, name] of Object.entries(this._names(m))) await this.api.nameCopySpeaker(copyId, key, name);   // teammates see names, not keys
  }

  /** A fingerprint of everything the copy contains: when it changes, the copy is replaced. */
  _stamp(m, share) {
    const content = { body: this._body(m, share), lines: share.includeTranscript ? m.segments.map((s) => [s.clientId, s.text, s.translation]) : null, names: share.includeTranscript ? this._names(m) : null };
    return crypto.createHash('sha1').update(JSON.stringify(content)).digest('hex');
  }

  /** What the server needs to show this meeting to teammates as finished, in one call. Fields are cut to the server's limits. */
  _body(m, share) {
    const aiNotes = (m.aiBlocks || []).some((b) => b.add) || (m.aiExtra || []).length
      ? toMarkdown(m, { include: { summary: false, mine: false, tasks: false, transcript: false }, nameOf: (k) => this.repo.speakerName(m, k) }) : '';
    return {
      title: cut(m.title, 200),
      folder_id: share.serverFolderId,
      source: 'local',
      share_copy: true,
      client_id: cut(m.id, 64),
      status: 'done',
      started_at: m.startedAt,
      ended_at: m.endedAt,
      summary: cut(m.summary, 2000),
      user_notes: cut(m.myNotes, 50000),
      ai_notes: aiNotes.slice(0, 50000),
      action_items: (m.tasks || []).filter((t) => !t.hidden).slice(0, 100).map((t) => ({ text: cut(t.text, 500), owner: cut(t.owner, 120), due: cut(t.due, 40), done: !!t.done })),
      keep_transcript: !!share.includeTranscript,
      redact: !!m.redact,
      language: m.language ? cut(m.language, 10) : null,
      attendees: (m.attendees || []).slice(0, 100).map((a) => ({ name: cut(a.name, 120), email: cut(a.email, 254) })),
    };
  }
}

module.exports = { SharingManager };
