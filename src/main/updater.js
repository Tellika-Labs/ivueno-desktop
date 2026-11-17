/**
 * Keeps an installed copy up to date. electron-updater reads latest.yml from the address in build.publish (package.json), downloads the new installer in the
 * background, checks its hash and its publisher signature, and installs it when the person restarts (or when the app is closed).
 *
 * This file only holds the state and the schedule, so it can be tested with a stand-in `autoUpdater`. It never throws: an update that cannot be checked
 * (offline, server down) is simply tried again later, and must never get in the way of a meeting.
 *
 * state.phase: idle | checking | downloading | ready | error      (state.version = the new version once known)
 */
const HOUR = 60 * 60 * 1000;

class Updater {
  constructor({ autoUpdater, emit = () => {}, enabled = false, firstCheckMs = 45 * 1000, everyMs = 4 * HOUR, setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.u = autoUpdater; this.emit = emit; this.enabled = enabled;
    this.firstCheckMs = firstCheckMs; this.everyMs = everyMs; this.setTimer = setTimer; this.clearTimer = clearTimer;
    this.timer = null; this.started = false;
    this.state = { phase: 'idle', version: null, percent: 0, error: '' };
  }

  _set(patch) { this.state = { ...this.state, ...patch }; this.emit('update:state', this.state); }

  start() {
    if (!this.enabled || this.started) return;
    this.started = true;
    const u = this.u;
    u.autoDownload = true;               // download quietly; installing waits for the person
    u.autoInstallOnAppQuit = true;       // and if they just close the app, the update installs then
    u.allowPrerelease = false;
    u.allowDowngrade = false;
    u.on('checking-for-update', () => this._set({ phase: 'checking', error: '' }));
    u.on('update-available', (info) => this._set({ phase: 'downloading', version: info && info.version ? String(info.version) : null, percent: 0 }));
    u.on('update-not-available', () => this._set({ phase: 'idle', percent: 0 }));
    u.on('download-progress', (p) => this._set({ phase: 'downloading', percent: Math.round((p && p.percent) || 0) }));
    u.on('update-downloaded', (info) => this._set({ phase: 'ready', version: info && info.version ? String(info.version) : this.state.version, percent: 100 }));
    u.on('error', (error) => this._set({ phase: this.state.phase === 'ready' ? 'ready' : 'error', error: String((error && error.message) || error || '').slice(0, 300) }));
    this._schedule(this.firstCheckMs);
  }

  _schedule(ms) {
    if (this.timer) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => { this.check().finally(() => this._schedule(this.everyMs)); }, ms);
    if (this.timer && this.timer.unref) this.timer.unref();
  }

  /** Looks for a new version now. Does nothing while one is already downloading or ready. */
  async check() {
    if (!this.enabled || this.state.phase === 'checking' || this.state.phase === 'downloading' || this.state.phase === 'ready') return this.state;
    try { await this.u.checkForUpdates(); } catch (error) { this._set({ phase: 'error', error: String((error && error.message) || error).slice(0, 300) }); }
    return this.state;
  }

  /** Closes the app and runs the downloaded installer. Returns false when there is nothing ready. */
  install() {
    if (this.state.phase !== 'ready') return false;
    this.u.quitAndInstall(false, true);        // not silent (the person sees the installer), and start the app again afterwards
    return true;
  }

  status() { return { enabled: this.enabled, ...this.state }; }
}

module.exports = { Updater };
