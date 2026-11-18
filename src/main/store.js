const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  // The production API that an installed app talks to. Temporary address until api.ivueno.ao is live: change it here only.
  // For a local backend while developing, set IVUENU_API_BASE=http://127.0.0.1:8000 in desktop/.env.local.
  apiBase: 'https://2-29-200-22.sslip.io',
  appLanguage: 'pt',
  theme: 'system',            // system | light | dark
  micId: '',
  captureSystem: true,
  language: 'auto',           // spoken language: auto | pt | en | fr | es
  template: 'auto',
  keepTranscript: true,
  redact: true,
  island: true,
  launchAtLogin: true,        // start with the computer, hidden in the tray, so calls can be noticed (see applyLogin in index.js)
  meetingPrompt: true,        // offer to take notes when a call (Zoom, Teams, Meet, WhatsApp...) starts: see meeting-detector.js
  dictation: true,
  hotkeyDictation: 'Control+Space',   // press to start, press again to stop
  hotkeyIsland: 'CommandOrControl+Shift+I',
  dataMode: 'cloud',          // kept for old settings files: everything runs in the cloud now
  engine: 'demo',
  recentSearches: [],
  audioKeep: '7d',            // how long the audio of a meeting stays on this computer: off | final (until the accurate pass is done) | 7d | 30d
  refineMode: 'voices',       // what happens to the kept audio after a meeting: voices (tell the people apart, the transcript stays) | text (also transcribe it again) | off
  glossary: '',               // the person's own terms and names, sent to the speech service as a short hint (empty = no hint)
  meetingPlace: 'both',       // who is where: room (everybody here) | online (a call) | both
  syncPrompted: false,        // the "turn on sync" question was shown once (paid plans)
  toursSeen: [],              // the tutorials already shown (ids), so each one runs by itself only once
  autoTours: true,            // tutorials start by themselves the first time a screen appears
  telemetryNoticeSeen: false, // the one-time note about the usage data the app sends was shown
};

const DEFAULT_DATA = () => ({
  v: 1,
  onboarded: false,
  settings: { ...DEFAULT_SETTINGS },
  meetings: [],
  folders: [],
  recipes: [],
  sync: { enabled: false, userId: null, cursor: 0, items: {}, lastRun: null, lastError: '' },
});

/**
 * One JSON file, written atomically (temp file + rename) and debounced. Good enough for the first versions; the
 * move to SQLite is planned when the engine arrives (docs/ENGINE.md). Corrupt or missing files start empty and the
 * bad file is kept next to it as *.corrupt so nothing is silently lost.
 */
class Store {
  constructor(file, { debounceMs = 300, cipher = null } = {}) {
    this.file = file;
    this.cipher = cipher;
    this.debounceMs = debounceMs;
    this.timer = null;
    this.data = this._load();
    if (this.cipher && fs.existsSync(this.file)) this.flush();
  }

  _load() {
    try {
      const bytes = fs.readFileSync(this.file);
      const raw = (this.cipher ? this.cipher.open(bytes, 'meetings-store') : bytes).toString('utf8');
      const parsed = JSON.parse(raw);
      const base = DEFAULT_DATA();
      return { ...base, ...parsed, settings: { ...base.settings, ...(parsed.settings || {}) } };
    } catch (err) {
      if (this.cipher && err.code !== 'ENOENT') throw err;
      if (err.code !== 'ENOENT') {
        try { fs.renameSync(this.file, `${this.file}.corrupt`); } catch { /* keep going with an empty store */ }
      }
      return DEFAULT_DATA();
    }
  }

  mutate(fn) {
    const result = fn(this.data);
    this._schedule();
    return result;
  }

  _schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, this.debounceMs);
    if (this.timer.unref) this.timer.unref();
  }

  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    const bytes = Buffer.from(JSON.stringify(this.data));
    fs.writeFileSync(tmp, this.cipher ? this.cipher.seal(bytes, 'meetings-store') : bytes, { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  /** Delete everything on this computer (account deletion). */
  wipe() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.data = DEFAULT_DATA();
    try { fs.rmSync(this.file, { force: true }); } catch { /* already gone */ }
  }
}

module.exports = { Store, DEFAULT_SETTINGS };
