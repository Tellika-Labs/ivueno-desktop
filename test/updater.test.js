const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Updater } = require('../src/main/updater');

function fake() {
  const u = new EventEmitter();
  u.checks = 0; u.installed = null; u.failNext = false;
  u.checkForUpdates = async () => { u.checks += 1; if (u.failNext) throw new Error('offline'); };
  u.quitAndInstall = (silent, run) => { u.installed = { silent, run }; };
  return u;
}
const make = (opts = {}) => {
  const u = fake(); const events = []; const timers = [];
  const up = new Updater({ autoUpdater: u, emit: (c, s) => events.push([c, s.phase]), enabled: true, setTimer: (fn, ms) => { timers.push({ fn, ms }); return { unref() {} }; }, clearTimer: () => {}, ...opts });
  return { u, up, events, timers };
};

test('a development run (not enabled) never touches the updater', async () => {
  const up = new Updater({ autoUpdater: null, enabled: false });
  up.start();
  assert.deepEqual(await up.check(), up.state);
  assert.equal(up.install(), false);
  assert.equal(up.status().enabled, false);
});

test('it configures quiet downloads and schedules a first check', () => {
  const { u, up, timers } = make();
  up.start(); up.start();                                    // starting twice changes nothing
  assert.equal(u.autoDownload, true);
  assert.equal(u.autoInstallOnAppQuit, true);
  assert.equal(u.allowDowngrade, false);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 45 * 1000);
});

test('the phases follow the updater events and the banner only appears when it is ready', () => {
  const { u, up, events } = make();
  up.start();
  u.emit('checking-for-update');
  u.emit('update-available', { version: '0.2.0' });
  u.emit('download-progress', { percent: 41.6 });
  assert.equal(up.state.phase, 'downloading'); assert.equal(up.state.percent, 42); assert.equal(up.state.version, '0.2.0');
  assert.equal(up.install(), false);                        // nothing is ready yet: installing does nothing
  u.emit('update-downloaded', { version: '0.2.0' });
  assert.equal(up.state.phase, 'ready');
  assert.deepEqual(events.map((e) => e[1]), ['checking', 'downloading', 'downloading', 'ready']);
});

test('install runs the downloaded installer only when it is ready, and restarts the app after it', () => {
  const { u, up } = make();
  up.start();
  u.emit('update-downloaded', { version: '0.2.0' });
  assert.equal(up.install(), true);
  assert.deepEqual(u.installed, { silent: false, run: true });
});

test('no update found goes back to idle; a failed check is an error, never a crash, and a ready update survives an error', async () => {
  const { u, up } = make();
  up.start();
  u.emit('update-not-available');
  assert.equal(up.state.phase, 'idle');
  u.failNext = true;
  await up.check();
  assert.equal(up.state.phase, 'error'); assert.match(up.state.error, /offline/);
  u.failNext = false;
  u.emit('update-downloaded', { version: '0.2.0' });
  u.emit('error', new Error('later network blip'));
  assert.equal(up.state.phase, 'ready');
});

test('it does not check again while a download or a ready update is pending, and re-schedules every few hours', async () => {
  const { u, up, timers } = make();
  up.start();
  u.emit('update-available', { version: '0.2.0' });
  await up.check();
  assert.equal(u.checks, 0);
  u.emit('update-not-available');
  await timers[0].fn();                                     // the scheduled check runs and arms the next one
  await new Promise((r) => setImmediate(r));
  assert.equal(u.checks, 1);
  assert.equal(timers[1].ms, 4 * 60 * 60 * 1000);
});
