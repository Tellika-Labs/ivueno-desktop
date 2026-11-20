// The shared-folder copy engine against the REAL backend (spare port, throw-away database): two people in one organisation.
// Skipped, with a message, when the backend's virtual environment is not installed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { ApiClient } = require('../src/main/api');
const { SecureStore } = require('../src/main/secure');
const { SharingManager } = require('../src/main/sharing');
const { tmpDir, newRepo } = require('./helpers');

const BACKEND = path.resolve(__dirname, '../../backend');
const PY = path.join(BACKEND, '.venv', 'Scripts', 'python.exe');
const haveBackend = fs.existsSync(PY);

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
async function waitFor(url, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 250)); }
  throw new Error('backend did not start');
}

test('shared folders: the desktop copy engine against the real backend', { skip: haveBackend ? false : 'backend/.venv not installed' }, async (t) => {
  const port = await freePort();
  const db = path.join(tmpDir('ivuenu-db-'), 'test.db').replace(/\\/g, '/');
  const mailDir = tmpDir('ivuenu-mail-');
  const server = spawn(PY, ['-m', 'uvicorn', 'app.main:app', '--port', String(port), '--log-level', 'warning'], {
    cwd: BACKEND, stdio: 'ignore',
    env: { ...process.env, IVUENU_LLM: 'none', GROQ_API_KEY: '', IVUENU_DATABASE_URL: `sqlite:///${db}`, IVUENU_DEV_ENDPOINTS: 'true', IVUENU_ENV: 'dev', IVUENU_MAIL: 'file', IVUENU_MAIL_DIR: mailDir, IVUENU_PAYMENT_MOCK: 'true', WIPAY_ENABLED: 'false', IVUENU_TELEMETRY: 'off', APPYPAY_CHARGES_ENABLED: 'false', IVUENU_STT: 'echo' },
  });
  t.after(() => server.kill());
  const base = `http://127.0.0.1:${port}`;
  await waitFor(`${base}/health`);

  const client = () => new ApiClient({ getBase: () => base, secure: new SecureStore(path.join(tmpDir(), 'secure.bin'), null, { requireEncryption: false }), deviceName: 'test' });
  const outbox = path.join(mailDir, 'outbox.jsonl');
  async function signUp(email, name) {
    const api = client();
    await api.register({ email, password: 'uma-palavra-passe-longa', name });
    for (let i = 0; i < 40 && !fs.existsSync(outbox); i++) await new Promise((r) => setTimeout(r, 100));
    const mail = fs.readFileSync(outbox, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((m) => m.to === email && /account\/verify/.test(m.text)).at(-1);
    await api.verifyEmail((mail.text.match(/token=([A-Za-z0-9_-]+)/) || [])[1]);
    return api;
  }

  const ana = await signUp('ana@exemplo.ao', 'Ana');
  const bruno = await signUp('bruno@exemplo.ao', 'Bruno');
  const org = await ana.request('POST', '/v1/orgs', { body: { name: 'Acme' } });
  await ana.request('POST', '/v1/dev/set-plan', { body: { plan: 'team', org_id: org.id, seats: 3 } });
  const invite = await ana.request('POST', `/v1/orgs/${org.id}/invites`, { body: { email: 'bruno@exemplo.ao' } });
  await bruno.request('POST', '/v1/orgs/invites/accept', { body: { token: invite.token } });

  const { repo } = newRepo();
  const sharing = new SharingManager({ repo, api: ana, ownerName: () => 'Ana' });
  const folder = repo.createFolder('Clients');
  const m = repo.createMeeting({ title: 'Kickoff', folderId: folder.id, status: 'done', startedAt: '2026-11-19T09:00:00.000Z' });
  repo.updateMeeting(m.id, { status: 'done', endedAt: '2026-11-19T09:30:00.000Z', durationSeconds: 1800, notesState: 'ready', summary: 'We agreed the plan.' });
  repo.addSegments(m.id, [{ clientId: 'c1', text: 'Hello team', speakerKey: 'spk_me', source: 'mic', startMs: 0 }]);
  repo.addTask(m.id, 'Send the deck', { owner: 'Ana' });

  await t.test('sharing uploads a finished, marked copy that teammates can list and read', async () => {
    await sharing.shareFolder(folder.id, org.id, { includeTranscript: true, orgName: 'Acme' });
    const copyId = repo.getMeeting(m.id).shareCopyId;
    assert.ok(copyId);
    const folders = await bruno.sharedFolders();
    assert.equal(folders.length, 1);
    assert.equal(folders[0].name, 'Clients');
    assert.equal(folders[0].meeting_count, 1);
    const listed = await bruno.sharedMeetings(folders[0].id);
    assert.equal(listed.items.length, 1);
    const read = await bruno.sharedMeeting(copyId);
    assert.equal(read.title, 'Kickoff');
    assert.equal(read.status, 'done');
    assert.equal(read.summary, 'We agreed the plan.');
    assert.equal(read.share_copy, true);
    assert.deepEqual(read.action_items.map((a) => a.text), ['Send the deck']);
    const lines = await bruno.sharedSegments(copyId);
    assert.deepEqual(lines.items.map((l) => l.text), ['Hello team']);
    assert.equal(read.speakers.find((sp) => sp.key === 'spk_me').name, 'Ana');       // teammates see a name, not a key
  });

  await t.test('running the share again makes no second copy, and a changed meeting replaces its copy', async () => {
    await sharing.shareFolder(folder.id, org.id, { includeTranscript: true, orgName: 'Acme' });
    assert.equal((await ana.request('GET', '/v1/meetings', { query: { limit: 100 } })).items.length, 1);
    repo.updateMeeting(m.id, { summary: 'A better summary.' });
    await sharing.syncMeeting(m.id);
    const copyId = repo.getMeeting(m.id).shareCopyId;
    assert.equal((await bruno.sharedMeeting(copyId)).summary, 'A better summary.');
    assert.equal((await ana.request('GET', '/v1/meetings', { query: { limit: 100 } })).items.length, 1);
  });

  await t.test('a teammate cannot change or delete the copy', async () => {
    const copyId = repo.getMeeting(m.id).shareCopyId;
    await assert.rejects(() => bruno.request('DELETE', `/v1/meetings/${copyId}`), (e) => e.status === 404);
    await assert.rejects(() => bruno.request('PATCH', `/v1/meetings/${copyId}`, { body: { title: 'Mine now' } }), (e) => e.status === 404);
  });

  await t.test('unsharing ends access and deletes the copies', async () => {
    await sharing.unshareFolder(folder.id);
    assert.deepEqual(await bruno.sharedFolders(), []);
    assert.equal((await ana.request('GET', '/v1/meetings', { query: { limit: 100 } })).items.length, 0);
    assert.equal(repo.getMeeting(m.id).shareCopyId, null);
  });
});
