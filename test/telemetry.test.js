const test = require('node:test');
const assert = require('node:assert/strict');
const { Telemetry, cleanProps, sizeBucket, durBucket, where } = require('../src/main/telemetry');

function make(overrides = {}) {
  const secureData = {};
  const sent = [];
  const api = {
    signedIn: () => !!overrides.signedIn,
    async request(method, path, { body }) { sent.push({ via: 'request', path, body }); return overrides.reply || { accepted: body.events.length, dropped: 0, disabled: false }; },
    async _send(method, path, { body, auth }) { sent.push({ via: 'anonymous', auth, path, body }); if (overrides.fail) throw overrides.fail; return overrides.reply || { accepted: body.events.length, dropped: 0, disabled: false }; },
  };
  const store = { data: {}, flush() {} };
  const secure = { get: (k) => secureData[k], set: (k, v) => { if (v == null) delete secureData[k]; else secureData[k] = v; } };
  let t = 1_000_000;
  const tel = new Telemetry({ api, store, secure, version: '0.1.0', platform: 'win32', packaged: true, getLocale: () => 'pt', now: () => t, ...overrides.options });
  return { tel, sent, secureData, store, advance: (ms) => { t += ms; } };
}

test('only known properties of the right kind survive, and a string must be a short identifier', () => {
  assert.deepEqual(cleanProps({ screen: 'home', ms: 12, ok: true, code: 'offline' }), { screen: 'home', ms: 12, ok: true, code: 'offline' });
  assert.deepEqual(cleanProps({ screen: 'Reunião com o Banco', name: 'joao@exemplo.ao', value: 'uma frase com espaços', title: 'x', transcript: 'x', ms: '12', ok: 1, count: 1.5 }), {});
  assert.deepEqual(cleanProps({ value: 'x'.repeat(200) }), {});
  assert.equal(cleanProps({ ms: 5e12 }).ms, 1e9);
});

test('an event that is not on the list is never queued', () => {
  const { tel } = make();
  tel.track('keylog', { screen: 'home' });
  tel.track('screen_view', { screen: 'home', note: 'secret' });
  assert.equal(tel.queue.length, 1);
  assert.deepEqual(tel.queue[0].props, { screen: 'home' });
});

test('a handler call records the channel, how long and whether it worked, never the arguments', () => {
  const { tel } = make();
  tel.call('meetings:delete', 41.6, false, 'recording');
  assert.deepEqual(tel.queue[0].props, { channel: 'meetings:delete', ms: 42, ok: false, code: 'recording' });
});

test('routine fast reads are not recorded, but slow or failing ones are', () => {
  const { tel } = make();
  tel.call('folders:list', 3, true);
  tel.call('auth:status', 5, true);
  tel.call('calendar:upcoming', 1800, true);
  tel.call('billing:summary', 40, false, 'offline');
  tel.call('export:file', 40, true);
  assert.deepEqual(tel.queue.map((e) => e.props.channel), ['calendar:upcoming', 'billing:summary', 'export:file']);
});

test('a channel called over and over is sampled instead of flooding the queue', () => {
  const { tel } = make();
  for (let i = 0; i < 200; i++) tel.call('rec:levels', 1, true);
  assert.equal(tel.queue.length, 12);
});

test('an error keeps the name, a code and a file with a line, but no folder (which holds the user name) and no message', () => {
  const { tel } = make();
  const err = Object.assign(new TypeError('Cannot read the title "Reunião secreta"'), { code: 'E_X' });
  err.stack = 'TypeError: Cannot read the title "Reunião secreta"\n    at run (C:\\Users\\Ana\\AppData\\Local\\ivuenu\\app\\handlers.js:123:7)';
  tel.error('main', err);
  assert.deepEqual(tel.queue[0].props, { source: 'main', name: 'TypeError', code: 'E_X', where: 'handlers.js:123' });
  assert.equal(where('at x (/home/ana/app/foo.mjs:9:1)'), 'foo.mjs:9');
});

test('sizes and lengths are sent as buckets, never exact', () => {
  assert.equal(sizeBucket(23_078_241), '5to25mb');
  assert.equal(durBucket(2693), '30to60m');
});

test('events are sent in a batch with a random install id, signed in or not, and leave the queue', async () => {
  const anon = make();
  anon.tel.track('app_open', { signed_in: false });
  await anon.tel.flush();
  assert.equal(anon.sent[0].via, 'anonymous');
  assert.equal(anon.sent[0].auth, false);
  assert.match(anon.sent[0].body.install_id, /^[0-9a-f-]{36}$/);
  assert.deepEqual({ v: anon.sent[0].body.app_version, c: anon.sent[0].body.channel, p: anon.sent[0].body.platform }, { v: '0.1.0', c: 'release', p: 'win32' });
  assert.equal(anon.tel.queue.length, 0);
  assert.equal(anon.store.data.installId, anon.sent[0].body.install_id);
  const signed = make({ signedIn: true });
  signed.tel.track('app_open', {});
  await signed.tel.flush();
  assert.equal(signed.sent[0].via, 'request');
  assert.equal(JSON.stringify(signed.sent[0].body).includes('user'), false, 'the app never says who it is: the server reads that from the token');
});

test('with no connection the events wait, survive a restart and go out later', async () => {
  const a = make({ fail: Object.assign(new Error('offline'), { code: 'offline' }) });
  a.tel.track('screen_view', { screen: 'home' });
  await a.tel.flush();
  assert.equal(a.tel.queue.length, 1);
  assert.equal(a.secureData.telemetryQueue.length, 1, 'kept in the encrypted store');
  const b = new Telemetry({ api: { signedIn: () => false, _send: async (m, p, { body }) => ({ accepted: body.events.length, disabled: false }) }, store: a.store, secure: { get: (k) => a.secureData[k], set: () => {} }, version: '0.1.0', platform: 'win32', packaged: true });
  assert.equal(b.queue.length, 1);
  await b.flush();
  assert.equal(b.queue.length, 0);
});

test('a batch the server refuses for good is dropped, not retried forever', async () => {
  const { tel } = make({ fail: Object.assign(new Error('bad'), { code: 'invalid_telemetry', status: 422 }) });
  tel.track('app_open', {});
  await tel.flush();
  assert.equal(tel.queue.length, 0);
});

test('when the server says telemetry is off (a company without cloud), the queue is cleared and nothing is sent for hours', async () => {
  const { tel, sent, advance } = make({ reply: { accepted: 0, dropped: 1, disabled: true } });
  tel.track('app_open', {});
  await tel.flush();
  assert.equal(tel.queue.length, 0);
  tel.track('app_open', {});
  await tel.flush();
  assert.equal(sent.length, 1, 'paused');
  advance(7 * 3600 * 1000);
  await tel.flush();
  assert.equal(sent.length, 2);
});

test('switched off, it records and sends nothing', async () => {
  const { tel, sent } = make({ options: { enabled: false } });
  tel.track('app_open', {});
  tel.call('x:y', 1, true);
  await tel.flush();
  assert.equal(tel.queue.length, 0);
  assert.equal(sent.length, 0);
});

test('the queue is capped so a long time offline cannot grow without limit', () => {
  const { tel } = make({ options: { enabled: true } });
  tel.flush = async () => {};
  for (let i = 0; i < 700; i++) tel.track('feature', { name: 'x', count: i });
  assert.equal(tel.queue.length, 500);
  assert.equal(tel.queue[0].props.count, 200, 'the oldest go first');
});
