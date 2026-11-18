// Notices when the person is in a call (Zoom, Teams, Google Meet, WhatsApp...) so the app can offer to take notes.
//
// How: Windows records which programs have the microphone open (CapabilityAccessManager in the registry). A program that holds
// it with no "stop" time is using it right now. That is the signal; the name of the program says which kind of call it is.
// A browser only says "a tab uses the mic", so its window titles decide whether it is Meet / Teams / Zoom / WhatsApp Web.
// Only the program name and window title are read. Never audio, never the page.
//
// The detector is a plain event emitter: it knows nothing about Electron. index.js shows the notification.
//   'detected' { key, app, label }   a call has been going on for `minActiveMs` and nobody has answered it yet
//   'ended'    { key, app }          the call is over (the mic was free for `graceMs`)

const { EventEmitter } = require('events');
const { execFile } = require('child_process');

const APPS = [
  // match is tested against the lower-cased program name (the exe or package name).
  { id: 'zoom',     label: 'Zoom',            match: /zoom/ },
  { id: 'teams',    label: 'Microsoft Teams', match: /(ms-?teams|msteams|teams\.exe|\\teams\\|#teams#)/ },
  { id: 'whatsapp', label: 'WhatsApp',        match: /whatsapp/ },
  { id: 'webex',    label: 'Webex',           match: /(webex|ciscocollab)/ },
  { id: 'slack',    label: 'Slack huddle',    match: /slack/ },
  { id: 'discord',  label: 'Discord',         match: /discord/ },
  { id: 'skype',    label: 'Skype',           match: /skype/ },
];
const BROWSER = /(chrome|msedge|firefox|brave|opera|vivaldi|arc)(\.exe|#|$)/;
// A browser tab becomes a known call by its window title.
const TITLES = [
  { id: 'meet',     label: 'Google Meet',     re: /(^|\s)meet\s[-–—]\s|meet\.google\.com/i },
  { id: 'teams',    label: 'Microsoft Teams', re: /microsoft teams|teams\.microsoft|teams\.live/i },
  { id: 'zoom',     label: 'Zoom',            re: /zoom meeting|zoom\.us|^zoom/i },
  { id: 'whatsapp', label: 'WhatsApp',        re: /whatsapp/i },
  { id: 'webex',    label: 'Webex',           re: /webex/i },
];
// Calls where the mic is off (joined muted, or only listening) never show up on the mic. Their window gives them away instead: Meet titles its
// tab "Meet - abc-defg-hij" and Zoom calls its call window "Zoom Meeting". Only these exact shapes count, and they wait longer (weakMs).
const STRICT_TITLES = [
  { id: 'meet', label: 'Google Meet', re: /^Meet\s[-–—]\s[a-z]{3}-[a-z]{4}-[a-z]{3}\b/i },
  { id: 'zoom', label: 'Zoom',        re: /^Zoom Meeting$/i },
];
// Never offered notes for: this app itself and tools that open the mic without a call.
const IGNORE = /(ivueno|ivuenu|obs64|audacity|discord-updater|voicemeeter|nvidia|realtek|steelseries)/;

const run = (cmd, args, timeout = 6000) => new Promise((resolve) => {
  // `reg query /s` exits non-zero when some parent key has no such value, yet still prints the ones that do: keep the output.
  execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 4_000_000 }, (err, stdout) => resolve(stdout ? String(stdout) : ''));
});

/** Windows: programs that hold the microphone right now -> ['c:\\...\\zoom.exe', 'msteams_8wekyb3d8bbwe', ...]. */
async function windowsMicUsers() {
  const base = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';
  const out = await run('reg', ['query', base, '/s', '/v', 'LastUsedTimeStop']);
  if (!out) return null;                      // the key is missing or reg failed: say "unknown", not "nobody"
  const users = [];
  let key = '';
  for (const line of out.split(/\r?\n/)) {
    if (/^HKEY_/i.test(line)) { key = line.slice(line.lastIndexOf('\\') + 1); continue; }
    const m = line.match(/LastUsedTimeStop\s+REG_QWORD\s+(0x[0-9a-f]+)/i);
    if (m && key && Number(m[1]) === 0) users.push(key.replace(/#/g, '\\').toLowerCase());     // 0 = not stopped yet = in use
  }
  return users;
}

/** Windows: titles of the open windows of the given browser programs. */
async function windowsBrowserTitles() {
  const ps = "Get-Process | Where-Object { $_.MainWindowTitle -and $_.ProcessName -match 'chrome|msedge|firefox|brave|opera|vivaldi|arc|zoom' } | ForEach-Object { $_.MainWindowTitle }";
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], 8000);
  return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

/** The default probes for this computer. macOS needs a native helper (CoreAudio kAudioDevicePropertyDeviceIsRunningSomewhere): until it is added, it reports "unknown". */
function defaultProbes(platform = process.platform) {
  if (platform === 'win32') return { micUsers: windowsMicUsers, browserTitles: windowsBrowserTitles };
  return { micUsers: async () => null, browserTitles: async () => [] };
}

/** Turns the programs on the mic into one call, or null. `titles` are browser window titles. */
function classify(users, titles = []) {
  for (const u of users) {
    if (IGNORE.test(u)) continue;
    const app = APPS.find((a) => a.match.test(u));
    if (app) return { app: app.id, label: app.label };
  }
  if (users.some((u) => BROWSER.test(u) && !IGNORE.test(u))) {
    for (const t of titles) {
      const hit = TITLES.find((x) => x.re.test(t));
      if (hit) return { app: hit.id, label: hit.label };
    }
  }
  return null;
}

/** A call known only by its window title (no mic). */
function classifyTitleOnly(titles = []) {
  for (const t of titles) {
    const hit = STRICT_TITLES.find((x) => x.re.test(t.replace(/\s[-–—]\s(Mozilla Firefox|Google Chrome|Microsoft.? Edge|Brave|Opera|Vivaldi)$/i, '')));
    if (hit) return { app: hit.id, label: hit.label, weak: true };
  }
  return null;
}

class MeetingDetector extends EventEmitter {
  /**
   * @param {object} o
   * @param {() => object} o.getSettings     reads settings.meetingPrompt (true by default)
   * @param {() => boolean} [o.busy]         true while Ivueno is already recording: nothing is offered then
   * @param {object} [o.probes]              { micUsers(), browserTitles() }; defaults to this computer's
   */
  constructor({ getSettings, busy = () => false, probes, now = Date.now, pollMs = 1000, minActiveMs = 1500, graceMs = 20000, snoozeMs = 60 * 60 * 1000, weakMs = 3000, titleEveryMs = 4000 } = {}) {
    super();
    Object.assign(this, { getSettings, busy, now, pollMs, minActiveMs, graceMs, snoozeMs, weakMs, titleEveryMs });
    this.lastTitleCheck = -Infinity;
    this.probes = probes || defaultProbes();
    this.timer = null;
    this.polling = false;
    this.call = null;            // { key, app, label, since, lastSeen, announced }
    this.snoozed = new Map();    // app id -> time until which it is not offered
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { this.tick().catch(() => {}); }, this.pollMs);
    if (this.timer.unref) this.timer.unref();
  }
  stop() { clearInterval(this.timer); this.timer = null; this.call = null; }

  /** "Not now": this call is not asked about again. "Not for this app": that app is left alone for a while. */
  dismiss() { if (this.call) this.call.announced = true; }
  snooze(app, ms = this.snoozeMs) { this.snoozed.set(app, this.now() + ms); this.dismiss(); }

  enabled() { const s = this.getSettings() || {}; return s.meetingPrompt !== false; }

  /** One look at the computer. Public so tests (and a "check now") can drive it. */
  async tick() {
    if (this.polling) return;
    this.polling = true;
    try {
      if (!this.enabled()) { this.call = null; return; }
      const users = await this.probes.micUsers();
      if (users === null) return;                     // unknown: change nothing
      const needTitles = users.some((u) => BROWSER.test(u)) && !users.some((u) => APPS.some((a) => a.match.test(u)));
      let found = classify(users, needTitles ? await this.probes.browserTitles() : []);
      if (!found && this.now() - this.lastTitleCheck >= this.titleEveryMs) {        // no mic: look for a call window, but not every tick (it starts a process)
        this.lastTitleCheck = this.now();
        found = classifyTitleOnly(await this.probes.browserTitles());
        if (!found && this.call && this.call.weak) this.call.lastSeen = Math.min(this.call.lastSeen, this.now() - this.graceMs);   // its window is gone
      }
      this.observe(found);
    } finally { this.polling = false; }
  }

  observe(found) {
    const t = this.now();
    const c = this.call;
    if (!found) {
      if (c && t - c.lastSeen >= this.graceMs) { this.call = null; this.emit('ended', { key: c.key, app: c.app }); }
      return;
    }
    if (c && c.app === found.app) {
      c.lastSeen = t; if (!found.weak) c.weak = false;                                  // the same call goes on (a short mute or mic hand-over does not start a new one)
    } else {
      if (c) this.emit('ended', { key: c.key, app: c.app });
      this.call = { key: `${found.app}:${t}`, app: found.app, label: found.label, weak: !!found.weak, since: t, lastSeen: t, announced: false };
    }
    const call = this.call;
    if (call.announced || t - call.since < (call.weak ? this.weakMs : this.minActiveMs)) return;
    if (this.busy() || (this.snoozed.get(call.app) || 0) > t) { call.announced = true; return; }
    call.announced = true;
    this.emit('detected', { key: call.key, app: call.app, label: call.label });
  }
}

module.exports = { MeetingDetector, classify, classifyTitleOnly, windowsMicUsers, defaultProbes };
