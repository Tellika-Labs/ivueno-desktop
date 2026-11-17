const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { LocalCipher } = require('../src/main/local-cipher');
const { Store } = require('../src/main/store');
const { AudioArchive } = require('../src/main/audio-archive');
const { isAppPage, validApiBase } = require('../src/main/origins');
const { tmpDir, newRepo } = require('./helpers');
const { SyncManager, encryptItem } = require('../src/main/sync');
const crypto = require('crypto');
const { createHandlers } = require('../src/main/handlers');

function cipher() {
  const values = new Map();
  return new LocalCipher({ get: (name) => values.get(name), set: (name, value) => values.set(name, value) });
}

test('local notes migrate to encrypted storage and tampering never replaces them', () => {
  const directory = tmpDir();
  const file = path.join(directory, 'meetings.json');
  const protection = cipher();
  fs.writeFileSync(file, JSON.stringify({ meetings: [{ title: 'CONFIDENTIAL-MEETING' }] }));
  const store = new Store(file, { cipher: protection });
  assert.equal(store.data.meetings[0].title, 'CONFIDENTIAL-MEETING');
  assert.equal(fs.readFileSync(file).includes(Buffer.from('CONFIDENTIAL-MEETING')), false);
  assert.equal(new Store(file, { cipher: protection }).data.meetings[0].title, 'CONFIDENTIAL-MEETING');
  const damaged = fs.readFileSync(file);
  damaged[damaged.length - 1] ^= 1;
  fs.writeFileSync(file, damaged);
  assert.throws(() => new Store(file, { cipher: protection }));
  assert.deepEqual(fs.readFileSync(file), damaged);
});

test('retained audio is encrypted, migrated, and bound to its meeting', () => {
  const directory = tmpDir();
  const protection = cipher();
  const legacy = new AudioArchive({ dir: directory });
  const meeting = 'mtg_abcdefgh';
  const audio = Buffer.from('PRIVATE-AUDIO-CONTENT');
  legacy.add(meeting, { source: 'mic', startMs: 0, seconds: 1, data: audio });
  const archive = new AudioArchive({ dir: directory, cipher: protection });
  archive.migrate();
  const filename = archive.blocks(meeting)[0].file;
  const encrypted = fs.readFileSync(path.join(directory, meeting, filename));
  assert.equal(encrypted.includes(audio), false);
  assert.deepEqual(archive.read(meeting, filename), audio);
  assert.throws(() => protection.open(encrypted, `audio:mtg_different:${filename}`));
});

test('IPC pages use exact URLs and remote API endpoints require TLS', () => {
  const page = pathToFileURL(path.resolve(__dirname, '../dist/renderer/index.html')).href;
  assert.equal(isAppPage(page, ''), true);
  assert.equal(isAppPage(pathToFileURL(path.resolve(tmpDir(), 'dist/renderer/index.html')).href, ''), false);
  assert.equal(isAppPage('http://localhost:5173/index.html', 'http://localhost:5173'), true);
  assert.equal(isAppPage('http://localhost:5173.evil.example/index.html', 'http://localhost:5173'), false);
  assert.equal(validApiBase('https://api.example.com'), true);
  assert.equal(validApiBase('http://127.0.0.1:8000'), true);
  assert.equal(validApiBase('http://api.example.com'), false);
  assert.equal(validApiBase('https://user:password@api.example.com'), false);
});

test('an in-flight download cannot restore private notes after sync is disabled', async () => {
  const { repo, store } = newRepo();
  const key = crypto.randomBytes(32);
  let complete;
  const response = new Promise((resolve) => { complete = resolve; });
  const manager = new SyncManager({ repo, store, api: { syncGet: () => response }, secure: { get: () => null, set() {} } });
  store.data.sync.enabled = true;
  const pending = manager._applyRemote(key, { id: 'mtg_private123', version: 1 });
  await manager.disable();
  complete({ data: encryptItem(key, 'mtg_private123', { title: 'PRIVATE', status: 'done' }), version: 1 });
  await pending;
  assert.equal(repo.getMeeting('mtg_private123'), null);
});

test('signed-out preferences hide private searches and reject unknown settings', async () => {
  const { repo } = newRepo();
  repo.patchSettings({ glossary: 'PRIVATE-NAMES', recentSearches: ['PRIVATE-QUERY'] });
  const handlers = createHandlers({ repo, api: { signedIn: () => false } });
  const settings = await handlers['settings:get']();
  assert.equal(settings.glossary, '');
  assert.deepEqual(settings.recentSearches, []);
  await assert.rejects(() => handlers['settings:patch'](JSON.parse('{"__proto__":{"apiBase":"https://evil.example"}}')), (error) => error.code === 'invalid');
});
