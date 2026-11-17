const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createHandlers } = require('../src/main/handlers');
const { Session } = require('../src/main/session');
const { DemoEngine } = require('../src/main/engine/demo');
const { SecureStore } = require('../src/main/secure');
const { newRepo, tmpDir } = require('./helpers');

function setup({ plan = 'free', limit = 10, state = 'ok', features = [] } = {}) {
  const { repo } = newRepo();
  const engine = new DemoEngine({ stepMs: 10 });
  const session = new Session({ repo, engine, doneLingerMs: 10 });
  const secure = new SecureStore(path.join(tmpDir(), 's.bin'), null, { requireEncryption: false });
  secure.set('user', { name: 'Ana Silva', email: 'ana@exemplo.ao' });
  const calls = { opened: [], saved: [], clip: [] };
  const licence = { status: () => ({ state, plan, features, meetingsPerMonth: limit, canRecord: state === 'ok' || state === 'renew' }), clear() {}, refresh: async () => {} };
  const api = { signedIn: () => true };
  const services = {
    gpuInfo: async () => ({ hasDiscreteGpu: false }), freeDiskBytes: async () => 48e9,
    openExternal: async (u) => calls.opened.push(u), saveFile: async (n, b) => { calls.saved.push([n, b.length]); return { saved: true, name: n }; },
    writeClipboard: async (t) => calls.clip.push(t), printPdf: async () => Buffer.from('%PDF'), fetchText: async () => '',
    wipeLocal: async () => {}, setTheme() {}, setIsland() {}, applyHotkeys() {}, hotkeyStatus: () => ({}),
  };
  const sync = { status: async () => ({ enabled: false, hasKey: false, lastRun: null, lastError: '', pending: 0, synced: 0 }) };
  const h = createHandlers({ repo, session, engine, api, licence, secure, services, sync, version: '0.1.0' });
  return { h, repo, session, calls, secure };
}

test('recording is refused with no licence, an expired one, or at the monthly limit', async () => {
  await assert.rejects(() => setup({ state: 'none' }).h['rec:start']({ consent: 'confirmed' }), (e) => e.code === 'licence_missing');
  await assert.rejects(() => setup({ state: 'expired' }).h['rec:start']({ consent: 'confirmed' }), (e) => e.code === 'licence_expired');
  const { h, repo } = setup({ limit: 2 });
  for (let i = 0; i < 2; i++) repo.createMeeting({ startedAt: new Date().toISOString(), status: 'done' });
  await assert.rejects(() => h['rec:start']({ consent: 'confirmed' }), (e) => e.code === 'limit_reached' && e.limit === 2);
});

test('the paid helps and own recipes are locked on Free and open on Pro', async () => {
  const free = setup();
  const m = free.repo.createMeeting({});
  await assert.rejects(() => free.h['recipes:run']({ id: m.id, recipeId: 'blind-spots' }), (e) => e.code === 'plan_required');
  await assert.rejects(() => free.h['recipes:save']({ name: 'x', prompt: 'y' }), (e) => e.code === 'plan_required');
  const pro = setup({ plan: 'pro', limit: null });
  const m2 = pro.repo.createMeeting({});
  pro.repo.addSegments(m2.id, [{ text: 'Vamos decidir isto.', speakerKey: 'spk_2' }]);
  assert.match((await pro.h['recipes:run']({ id: m2.id, recipeId: 'blind-spots' })).text, /motor de IA/);
  assert.equal((await pro.h['recipes:save']({ name: 'Proposta', prompt: 'Escreve uma proposta' })).length, 1);
});

test('a meeting view carries speaker names, colours and initials', async () => {
  const { h, repo } = setup();
  const m = repo.createMeeting({});
  repo.addSegments(m.id, [{ text: 'olá', speakerKey: 'spk_2' }]);
  await h['speakers:rename']({ id: m.id, key: 'spk_2', name: 'Bruno Fernandes' });
  const v = await h['meetings:get'](m.id);
  assert.deepEqual(v.speakers.map((s) => [s.display, s.initials]), [['Tu', 'AS'], ['Bruno Fernandes', 'BF']]);
  assert.equal(v.segments[0].who, 'Bruno Fernandes');
});

test('renaming a speaker updates every past and future phrase, search and exports, and persists per meeting', async () => {
  const { h, repo, calls } = setup();
  const m = repo.createMeeting({ title: 'Speaker rename' });
  const other = repo.createMeeting({ title: 'Another meeting' });
  repo.addSegments(m.id, [
    { text: 'First phrase.', speakerKey: 'spk_1' },
    { text: 'Another person.', speakerKey: 'spk_2' },
    { text: 'Second phrase.', speakerKey: 'spk_1' },
  ]);
  repo.addSegments(other.id, [{ text: 'A different meeting.', speakerKey: 'spk_1' }]);
  const before = repo.getMeeting(m.id).segments.map(({ id, speakerKey, text }) => ({ id, speakerKey, text }));
  const renamed = await h['speakers:rename']({ id: m.id, key: 'spk_1', name: '  Carlos Silva  ' });
  assert.deepEqual(renamed.segments.map((s) => s.who), ['Carlos Silva', 'Orador 2', 'Carlos Silva']);
  assert.deepEqual(repo.getMeeting(m.id).segments.map(({ id, speakerKey, text }) => ({ id, speakerKey, text })), before);
  repo.addSegments(m.id, [{ text: 'Future phrase.', speakerKey: 'spk_1' }]);
  assert.equal((await h['meetings:get'](m.id)).segments.at(-1).who, 'Carlos Silva');
  assert.equal((await h['meetings:get'](other.id)).segments[0].who, 'Orador 1');
  assert.equal(repo.search('First phrase').results[0].hits[0].speaker, 'Carlos Silva');
  await h['export:run']({ id: m.id, format: 'copy', includeTranscript: true });
  assert.match(calls.clip[0], /Carlos Silva/);
  assert.doesNotMatch(calls.clip[0], /Orador 1/);
  repo.store.flush();
  const { Store } = require('../src/main/store');
  const { Repo } = require('../src/main/repo');
  const reloaded = new Repo(new Store(repo.store.file));
  assert.equal(reloaded.speakerName(reloaded.getMeeting(m.id), 'spk_1'), 'Carlos Silva');
  const cleared = await h['speakers:rename']({ id: m.id, key: 'spk_1', name: '   ' });
  assert.ok(cleared.segments.filter((s) => s.speakerKey === 'spk_1').every((s) => s.who === 'Orador 1'));
});

test('export: copy, markdown, docx, pdf go through the injected services; tasks open a mail draft only', async () => {
  const { h, repo, calls } = setup();
  const m = repo.createMeeting({ title: 'Revisão: Q4/2026?', attendees: [{ name: 'Domingos', email: 'd@exemplo.ao' }] });
  repo.addTask(m.id, 'Enviar lista');
  await h['export:run']({ id: m.id, format: 'copy' });
  assert.match(calls.clip[0], /Revisão/);
  assert.equal((await h['export:run']({ id: m.id, format: 'docx' })).name, 'Revisão Q4 2026.docx');
  assert.equal((await h['export:run']({ id: m.id, format: 'pdf' })).saved, true);
  await h['export:run']({ id: m.id, format: 'tasks-mail' });
  assert.match(calls.opened[0], /^mailto:d@exemplo\.ao\?subject=/);
  await assert.rejects(() => h['export:run']({ id: m.id, format: 'exe' }), (e) => e.code === 'invalid');
});

test('sync is offered only to the plans that include it, and is never on by itself', async () => {
  const free = await setup({ plan: 'free', features: ['local_engine', 'cloud_notes'] }).h['sync:status']();
  assert.equal(free.eligible, false);
  const pro = await setup({ plan: 'pro', features: ['local_engine', 'sync', 'cloud_notes'] }).h['sync:status']();
  assert.equal(pro.eligible, true);
  assert.equal(pro.enabled, false, 'turning it on needs the person: they choose the passphrase');
});

test('only https and mailto links may be opened', async () => {
  const { h, calls } = setup();
  await h['shell:openExternal']('https://ivuenu.example/planos');
  await assert.rejects(() => h['shell:openExternal']('file:///C:/Windows/System32/calc.exe'), (e) => e.code === 'blocked');
  await assert.rejects(() => h['shell:openExternal']('javascript:alert(1)'), (e) => e.code === 'blocked');
  assert.deepEqual(calls.opened, ['https://ivuenu.example/planos']);
});

test('a hosted checkout opens only when it is a page on the WiPay host', async () => {
  const { h, calls } = setup();
  await h['billing:openCheckout']({ url: 'https://hosted.wipay.ao/?id=abc&nonce=1' });
  await h['billing:openCheckout']({ url: 'https://pay.wiza.ao/?id=abc&nonce=1' });       // the sandbox answers with this host
  for (const bad of ['https://evil.example/?id=abc', 'http://hosted.wipay.ao/?id=abc', 'https://hosted.wipay.ao.evil.example/', 'https://pay.wiza.ao.evil.example/', 'http://pay.wiza.ao/', 'https://name@hosted.wipay.ao/?id=abc', 'https://hosted.wipay.ao:444/?id=abc', 'https://hosted.wipay.ao/', 'https://hosted.wipay.ao/?id=' + 'x'.repeat(81), 'https://hosted.wipay.ao/?id=abc&nonce=' + 'x'.repeat(500), 'file:///C:/Windows/System32/calc.exe', 'not a url', '']) {
    await assert.rejects(() => h['billing:openCheckout']({ url: bad }), (e) => e.code === 'blocked', bad);
    await assert.rejects(() => h['billing:checkoutPage']({ url: bad }), (e) => e.code === 'blocked', bad);
  }
  assert.deepEqual(calls.opened, ['https://hosted.wipay.ao/?id=abc&nonce=1', 'https://pay.wiza.ao/?id=abc&nonce=1']);
});

test('embedding validates the checkout without opening the browser', async () => {
  const { h, calls } = setup();
  for (const host of ['hosted.wipay.ao', 'pay.wiza.ao']) {
    const url = `https://${host}/?id=abc&nonce=1`;
    assert.deepEqual(await h['billing:checkoutPage']({ url }), { url });
  }
  assert.deepEqual(calls.opened, []);
});

test('remote frames stay on WiPay while browser-return pages and foreign destinations are blocked', () => {
  const { isHostedFrameUrl } = require('../src/main/payment-pages');
  assert.equal(isHostedFrameUrl('https://pay.wiza.ao/?id=abc'), true);
  assert.equal(isHostedFrameUrl('https://hosted.wipay.ao/choose-method'), true);
  for (const url of ['https://api.example.test/account/payment/success', 'https://evil.example/',
    'https://pay.wiza.ao.evil.example/', 'https://pay.wiza.ao:444/', 'http://pay.wiza.ao/', 'not a url']) {
    assert.equal(isHostedFrameUrl(url), false, url);
  }
});

test('payment verification frames require an uninterrupted WiPay ancestor chain', () => {
  const { isAllowedPaymentFrame } = require('../src/main/payment-pages');
  const challenge = 'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/turnstile/test';
  const checkout = 'https://pay.wiza.ao/?id=payment';
  const app = 'file:///app/index.html';
  assert.equal(isAllowedPaymentFrame(challenge, [checkout, app]), true);
  assert.equal(isAllowedPaymentFrame(challenge, [challenge, checkout, app]), true);
  assert.equal(isAllowedPaymentFrame(challenge, [app]), false);
  assert.equal(isAllowedPaymentFrame(challenge, ['https://evil.example/', checkout]), false);
  assert.equal(isAllowedPaymentFrame('https://challenges.cloudflare.com.evil.example/', [checkout]), false);
  assert.equal(isAllowedPaymentFrame('http://challenges.cloudflare.com/', [checkout]), false);
  assert.equal(isAllowedPaymentFrame('https://challenges.cloudflare.com:444/', [checkout]), false);
  assert.equal(isAllowedPaymentFrame(checkout, [app]), true);
});

test('the calendar address is never returned, only whether it is connected and its host', async () => {
  const { h, secure } = setup();
  const { available, ...off } = await h['calendar:status']();
  assert.deepEqual(off, { connected: false, provider: null, host: '' });
  secure.set('calendarUrl', 'webcal://calendar.exemplo.ao/private/abcdef/basic.ics');
  const { available: _a, ...s } = await h['calendar:status']();
  assert.deepEqual(s, { connected: true, provider: 'ics', host: 'calendar.exemplo.ao' });
  secure.set('calendarAuth', { provider: 'google', refreshToken: 'secret-token' });
  const g = await h['calendar:status']();
  assert.equal(g.provider, 'google');
  assert.ok(!JSON.stringify(g).includes('secret-token'), 'the token never leaves the main process');
  await assert.rejects(() => h['calendar:connect']('google'), (e) => e.code === 'invalid', 'refuses when no client id is configured');
  await assert.rejects(() => h['calendar:set']('http://insecure.example/x.ics'), (e) => e.code === 'invalid');
});

test('system check reports a slow machine honestly', async () => {
  const { h } = setup();
  const checks = await h['system:check']();
  assert.equal(checks.find((c) => c.id === 'gpu').state, 'warn');
  assert.equal(checks.find((c) => c.id === 'disk').state, 'ok');
});

test('account deletion and logout are refused while recording', async () => {
  const { h } = setup();
  await h['rec:start']({ input: {}, consent: 'confirmed' });
  await assert.rejects(() => h['auth:deleteAccount'](), (e) => e.code === 'recording');
  await assert.rejects(() => h['auth:logout'](), (e) => e.code === 'recording');
  const live = (await h['rec:state']()).meetingId;
  await assert.rejects(() => h['meetings:delete'](live), (e) => e.code === 'recording');
  await h['rec:stop']();
});

test('chat answers from the meeting and stores the exchange', async () => {
  const { h, repo } = setup();
  const m = repo.createMeeting({});
  repo.addSegments(m.id, [{ text: 'Os cancelamentos subiram dois por cento.', speakerKey: 'spk_2', startMs: 4000 }]);
  const v = await h['chat:ask']({ id: m.id, question: 'O que aconteceu com os cancelamentos?' });
  assert.deepEqual(v.chat.map((c) => c.role), ['user', 'assistant']);
  assert.equal(v.chat[1].cite, '00:00:04');
});
