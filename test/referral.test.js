const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { ApiClient } = require('../src/main/api');
const { createHandlers } = require('../src/main/handlers');
const { Session } = require('../src/main/session');
const { DemoEngine } = require('../src/main/engine/demo');
const { SecureStore } = require('../src/main/secure');
const { newRepo, tmpDir } = require('./helpers');

const secureAt = () => new SecureStore(path.join(tmpDir(), 's.bin'), null, { requireEncryption: false });

test('register sends the invite code only when one is given', async () => {
  const api = new ApiClient({ getBase: () => 'https://api.example.test', secure: secureAt() });
  const sent = [];
  api._send = async (method, url, options = {}) => { sent.push({ method, url, body: options.body }); return { access_token: 'a', refresh_token: 'r' }; };
  api.me = async () => ({ id: 'u1' });
  await api.register({ email: 'a@b.ao', password: 'correct horse battery', name: 'A', referralCode: 'ABCD2345' });
  assert.equal(sent[0].url, '/v1/auth/register');
  assert.equal(sent[0].body.referral_code, 'ABCD2345');
  await api.register({ email: 'a@b.ao', password: 'correct horse battery', name: 'A' });
  assert.equal(sent.filter((s) => s.url === '/v1/auth/register')[1].body.referral_code, undefined);
});

test('the referral calls go to the right endpoints', async () => {
  const api = new ApiClient({ getBase: () => 'https://api.example.test', secure: secureAt() });
  const asked = [];
  api.request = async (method, url, options = {}) => { asked.push([method, url, options]); return { ok: true }; };
  await api.referralMe();
  await api.referralCheck('ABCD2345');
  await api.referralApply('ABCD2345');
  assert.deepEqual(asked[0].slice(0, 2), ['GET', '/v1/referrals/me']);
  assert.deepEqual(asked[1].slice(0, 2), ['GET', '/v1/referrals/check']);
  assert.deepEqual(asked[1][2].query, { code: 'ABCD2345' });
  assert.equal(asked[1][2].auth, false);                       // the sign-up screen asks before there is an account
  assert.deepEqual(asked[2].slice(0, 2), ['POST', '/v1/referrals/apply']);
  assert.deepEqual(asked[2][2].body, { code: 'ABCD2345' });
});

function handlersWith(api) {
  const { repo } = newRepo();
  const engine = new DemoEngine({ stepMs: 10 });
  const session = new Session({ repo, engine, doneLingerMs: 10 });
  const secure = secureAt();
  const licence = { status: () => ({ state: 'ok', plan: 'free', features: [], canRecord: true }), clear() {}, refresh: async () => ({}) };
  const services = { wipeLocal: async () => {}, setTheme() {}, setIsland() {}, applyHotkeys() {}, hotkeyStatus: () => ({}) };
  const sync = { status: async () => ({ enabled: false }) };
  return createHandlers({ repo, session, engine, api: { signedIn: () => true, ...api }, licence, secure, services, sync, version: '0.1.0' });
}

test('referral handlers pass through to the api', async () => {
  const seen = [];
  const h = handlersWith({
    referralMe: async () => ({ code: 'ABCD2345', qualified: 1 }),
    referralCheck: async (code) => { seen.push(['check', code]); return { valid: true, discount_pct: 5 }; },
    referralApply: async (code) => { seen.push(['apply', code]); return { applied: true }; },
  });
  assert.deepEqual(await h['referral:me'](), { code: 'ABCD2345', qualified: 1 });
  assert.deepEqual(await h['referral:check']({ code: 'ABCD2345' }), { valid: true, discount_pct: 5 });
  assert.deepEqual(await h['referral:apply']({ code: 'ABCD2345' }), { applied: true });
  assert.deepEqual(seen, [['check', 'ABCD2345'], ['apply', 'ABCD2345']]);
});

test('auth:register hands the invite code to the api', async () => {
  const got = [];
  const h = handlersWith({ register: async (args) => { got.push(args); return { id: 'u1', email: 'a@b.ao' }; } });
  await h['auth:register']({ email: 'a@b.ao', password: 'correct horse battery', name: 'A', referralCode: 'ABCD2345' });
  assert.equal(got[0].referralCode, 'ABCD2345');
});
