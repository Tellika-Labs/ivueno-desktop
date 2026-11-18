const test = require('node:test');
const assert = require('node:assert/strict');
const { MeetingDetector, classify } = require('../src/main/meeting-detector');

function mk({ users = [], titles = [], settings = {}, busy = false } = {}) {
  const st = { users, titles, now: 0 };
  const d = new MeetingDetector({
    getSettings: () => settings, busy: () => busy, now: () => st.now, minActiveMs: 4000, graceMs: 20000, weakMs: 10000, titleEveryMs: 9000,
    probes: { micUsers: async () => st.users, browserTitles: async () => st.titles },
  });
  const events = [];
  d.on('detected', (e) => events.push(['detected', e.app]));
  d.on('ended', (e) => events.push(['ended', e.app]));
  const at = async (ms) => { st.now = ms; await d.tick(); };
  return { d, st, events, at };
}

test('classify: desktop apps are known by their program name', () => {
  assert.equal(classify(['c:\\users\\a\\appdata\\roaming\\zoom\\bin\\zoom.exe']).app, 'zoom');
  assert.equal(classify(['msteams_8wekyb3d8bbwe']).app, 'teams');
  assert.equal(classify(['5319275a.whatsappdesktop_cv1g1gvanyjgm']).app, 'whatsapp');
});

test('classify: a browser on the mic needs a call-like window title', () => {
  const chrome = ['c:\\program files\\google\\chrome\\application\\chrome.exe'];
  assert.equal(classify(chrome, ['Meet - abc-defg-hij - Google Chrome']).app, 'meet');
  assert.equal(classify(chrome, ['Inbox - Gmail']), null);
  assert.equal(classify([], ['Meet - abc-defg-hij']), null);          // browser not on the mic
});

test('classify: Ivueno itself and recorders are never a call', () => {
  assert.equal(classify(['c:\\program files\\ivueno\\ivueno.exe']), null);
});

test('detects after the call has lasted long enough, and only once', async () => {
  const { st, events, at } = mk({ users: ['zoom.exe'] });
  await at(0); await at(3000);
  assert.deepEqual(events, []);
  await at(5000); await at(8000); await at(11000);
  assert.deepEqual(events, [['detected', 'zoom']]);
});

test('a short drop of the mic does not make a second prompt; the end is reported after the grace time', async () => {
  const { st, events, at } = mk({ users: ['zoom.exe'] });
  await at(0); await at(5000);
  st.users = []; await at(10000);
  st.users = ['zoom.exe']; await at(15000);
  assert.deepEqual(events, [['detected', 'zoom']]);
  st.users = []; await at(16000); await at(40000);
  assert.deepEqual(events, [['detected', 'zoom'], ['ended', 'zoom']]);
});

test('a new call after the end is offered again', async () => {
  const { st, events, at } = mk({ users: ['zoom.exe'] });
  await at(0); await at(5000);
  st.users = []; await at(6000); await at(30000);
  st.users = ['zoom.exe']; await at(31000); await at(36000);
  assert.deepEqual(events.filter((e) => e[0] === 'detected').length, 2);
});

test('nothing is offered while Ivueno is already recording, or when the prompt is switched off', async () => {
  const a = mk({ users: ['zoom.exe'], busy: true });
  await a.at(0); await a.at(6000);
  const b = mk({ users: ['zoom.exe'], settings: { meetingPrompt: false } });
  await b.at(0); await b.at(6000);
  assert.deepEqual([...a.events, ...b.events], []);
});

test('"not for this app" keeps that app quiet for a while', async () => {
  const { d, st, events, at } = mk({ users: ['zoom.exe'] });
  d.snooze('zoom', 60_000);
  await at(0); await at(6000);
  assert.deepEqual(events, []);
});

test('when the computer cannot tell (probe returns null) nothing changes', async () => {
  const { st, events, at } = mk({ users: ['zoom.exe'] });
  await at(0); await at(5000);
  st.users = null; await at(60000);
  assert.deepEqual(events, [['detected', 'zoom']]);
});

test('title-only: a Meet tab with a meeting code counts even when the mic is off, after a longer wait', async () => {
  const { events, at } = mk({ users: [], titles: ['Meet - xjc-njha-qmp — Mozilla Firefox'] });
  await at(0); await at(5000);
  assert.deepEqual(events, []);
  await at(10000); await at(12000);
  assert.deepEqual(events, [['detected', 'meet']]);
});

test('title-only: the Meet home page, the lobby of nothing, and other tabs do not count', () => {
  const { classifyTitleOnly } = require('../src/main/meeting-detector');
  assert.equal(classifyTitleOnly(['Google Meet — Mozilla Firefox', 'Inbox - Gmail', 'Meet - Google Chrome']), null);
  assert.equal(classifyTitleOnly(['Zoom Meeting']).app, 'zoom');
});

test('title-only: when the window goes away the call ends', async () => {
  const { st, events, at } = mk({ users: [], titles: ['Meet - xjc-njha-qmp — Mozilla Firefox'] });
  await at(0); await at(10000); await at(12000);
  st.titles = []; await at(21000); await at(30000);
  assert.deepEqual(events, [['detected', 'meet'], ['ended', 'meet']]);
});

test('with the real settings a call on the mic is noticed within about two seconds', async () => {
  const st = { now: 0 };
  const d = new MeetingDetector({ getSettings: () => ({}), now: () => st.now, probes: { micUsers: async () => ['zoom.exe'], browserTitles: async () => [] } });
  const seen = [];
  d.on('detected', () => seen.push(st.now));
  for (const t of [0, 1000, 2000, 3000]) { st.now = t; await d.tick(); }
  assert.deepEqual(seen, [2000]);
});

test('with the real settings a Meet window with no mic is noticed within about four seconds', async () => {
  const st = { now: 0 };
  const d = new MeetingDetector({ getSettings: () => ({}), now: () => st.now, probes: { micUsers: async () => [], browserTitles: async () => ['Meet - xjc-njha-qmp — Mozilla Firefox'] } });
  const seen = [];
  d.on('detected', () => seen.push(st.now));
  for (const t of [0, 1000, 2000, 3000, 4000, 5000]) { st.now = t; await d.tick(); }
  assert.deepEqual(seen, [4000]);
});
