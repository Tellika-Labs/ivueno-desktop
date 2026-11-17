const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const accounts = require('../src/main/accounts');
const { SecureStore } = require('../src/main/secure');
const { Store } = require('../src/main/store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ivueno-accounts-'));
const secureAt = (dir) => new SecureStore(path.join(dir, 'ivuenu-secure.bin'), null, { requireEncryption: false });

test('the active account pointer round-trips and rejects junk', () => {
  const root = tmp();
  assert.equal(accounts.getActive(root), null);
  accounts.setActive(root, 'usr_abc123');
  assert.equal(accounts.getActive(root), 'usr_abc123');
  fs.writeFileSync(path.join(root, 'active-account.json'), '{"id":"../../etc"}');
  assert.equal(accounts.accountDir(root, '../../etc').startsWith(path.join(root, 'accounts')), true);
  fs.writeFileSync(path.join(root, 'active-account.json'), 'not json');
  assert.equal(accounts.getActive(root), null);
});

test('an account folder can never leave the accounts folder', () => {
  const root = tmp();
  for (const id of ['../x', '..\\x', 'a/b', 'C:\\temp']) {
    const dir = accounts.accountDir(root, id);
    assert.equal(path.dirname(dir), path.join(root, 'accounts'));
  }
  assert.throws(() => accounts.accountDir(root, ''), /account id/);
});

test('old single-folder data moves into its owner folder, including audio, and is never overwritten', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'ivuenu-data.json'), 'A-DATA');
  fs.mkdirSync(path.join(root, 'audio', 'mtg_1'), { recursive: true });
  fs.writeFileSync(path.join(root, 'audio', 'mtg_1', 'mic-0.webm'), 'AUDIO');
  assert.equal(accounts.migrateLegacy(root, 'usr_a'), true);
  const dir = accounts.accountDir(root, 'usr_a');
  assert.equal(fs.readFileSync(path.join(dir, 'ivuenu-data.json'), 'utf8'), 'A-DATA');
  assert.equal(fs.readFileSync(path.join(dir, 'audio', 'mtg_1', 'mic-0.webm'), 'utf8'), 'AUDIO');
  assert.equal(fs.existsSync(path.join(root, 'ivuenu-data.json')), false);
  assert.equal(accounts.migrateLegacy(root, 'usr_a'), false);            // nothing left to move

  fs.writeFileSync(path.join(root, 'ivuenu-data.json'), 'OTHER');        // a second legacy file must not replace the account's data
  assert.equal(accounts.migrateLegacy(root, 'usr_a'), false);
  assert.equal(fs.readFileSync(path.join(dir, 'ivuenu-data.json'), 'utf8'), 'A-DATA');
});

test('two accounts keep separate meetings in separate folders', () => {
  const root = tmp();
  const a = new Store(path.join(accounts.accountDir(root, 'usr_a'), accounts.DATA_FILE));
  const b = new Store(path.join(accounts.accountDir(root, 'usr_b'), accounts.DATA_FILE));
  a.data.accountId = 'usr_a'; a.data.meetings.push({ id: 'mtg_a' }); a.flush();
  b.data.accountId = 'usr_b'; b.flush();
  const again = new Store(path.join(accounts.accountDir(root, 'usr_a'), accounts.DATA_FILE));
  assert.deepEqual(again.data.meetings.map((m) => m.id), ['mtg_a']);
  assert.equal(new Store(path.join(accounts.accountDir(root, 'usr_b'), accounts.DATA_FILE)).data.meetings.length, 0);
});

test("an account's own secrets are parked when another signs in and come back with it", () => {
  const root = tmp();
  const main = secureAt(root);
  const a = secureAt(accounts.accountDir(root, 'usr_a'));
  const b = secureAt(accounts.accountDir(root, 'usr_b'));
  main.set('tokens', { access: 'x' });
  main.set('calendarUrl', 'https://calendar.example/a.ics');
  main.set('serverUsage', 7);

  accounts.stashKeys(main, a);                       // account A leaves
  accounts.restoreKeys(main, b);                     // account B (new) arrives
  assert.equal(main.get('calendarUrl'), undefined);  // B must not see A's calendar link
  assert.equal(main.get('serverUsage'), undefined);
  assert.deepEqual(main.get('tokens'), { access: 'x' });   // the sign-in tokens are not account secrets of this kind: login replaces them
  assert.equal(a.get('calendarUrl'), 'https://calendar.example/a.ics');

  accounts.stashKeys(main, b);                       // B leaves, A comes back
  accounts.restoreKeys(main, a);
  assert.equal(main.get('calendarUrl'), 'https://calendar.example/a.ics');
  assert.equal(main.get('serverUsage'), 7);
});

test('clearing the secure store can keep the shared local data key', () => {
  const root = tmp();
  const s = secureAt(root);
  s.set('localDataKey', 'KEY'); s.set('tokens', { a: 1 }); s.set('user', { id: 'usr_a' });
  s.clear({ keep: ['localDataKey'] });
  assert.equal(s.get('localDataKey'), 'KEY');
  assert.equal(s.get('tokens'), undefined);
  assert.equal(s.get('user'), undefined);
  s.clear();
  assert.equal(s.get('localDataKey'), undefined);
});
