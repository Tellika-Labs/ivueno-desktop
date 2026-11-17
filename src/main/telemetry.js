const crypto = require('crypto');

/**
 * Usage telemetry: how the app is used, never what is said in it (see backend/app/telemetry.py, which enforces the same rules again).
 * Events are small and structured: a screen opened, a feature used and how long it took, an error code, a payment step.
 * Only the properties below exist, and a string may only be a short identifier (letters, digits and _ . : / -), so a title, a sentence,
 * an email address or a file name cannot be sent even by mistake. Meeting content never goes through here.
 *
 * Events wait in a small queue (kept in the encrypted store, so a restart or a lost connection loses nothing) and are sent in batches.
 */
const SAFE = /^[A-Za-z0-9_.:/-]+$/;
const EVENTS = new Set(['app_open', 'app_close', 'screen_view', 'screen_time', 'api_call', 'feature', 'error', 'perf', 'payment']);
const PROPS = {
  screen: ['s', 24], from: ['s', 24], channel: ['s', 48], name: ['s', 48], code: ['s', 48], source: ['s', 16], where: ['s', 80], stage: ['s', 24],
  ext: ['s', 8], size: ['s', 12], dur: ['s', 12], value: ['s', 48], method: ['s', 24], plan: ['s', 16], status: ['s', 24], reason: ['s', 48],
  place: ['s', 16], template: ['s', 24], consent: ['s', 16], action: ['s', 48], target: ['s', 48], provider: ['s', 16], format: ['s', 12],
  tour: ['s', 24], lang: ['s', 8], theme: ['s', 8],
  ms: ['i'], count: ['i'], step: ['i'], session_s: ['i'],
  ok: ['b'], signed_in: ['b'], onboarded: ['b'], first_run: ['b'], packaged: ['b'],
};
const QUIET_READS = /:(get|status|list|state|overview|methods|waiting|summary|info|history|attempt|poll)$/;
const MAX_QUEUE = 500, BATCH = 100, PAUSE_MS = 6 * 3600 * 1000;

function cleanProps(props) {
  const out = {};
  for (const [key, value] of Object.entries(props || {})) {
    const spec = PROPS[key];
    if (!spec) continue;
    if (spec[0] === 'b' && typeof value === 'boolean') out[key] = value;
    else if (spec[0] === 'i' && Number.isInteger(value)) out[key] = Math.max(-1, Math.min(value, 1e9));
    else if (spec[0] === 's' && typeof value === 'string' && value.length > 0 && value.length <= spec[1] && SAFE.test(value)) out[key] = value;
  }
  return out;
}

/** A bucket for a size or a length, so the exact number (which could identify a file) is never sent. */
const bucket = (n, edges, labels) => labels[edges.findIndex((e) => n < e) === -1 ? labels.length - 1 : edges.findIndex((e) => n < e)];
const sizeBucket = (bytes) => bucket(bytes, [1e6, 5e6, 25e6, 100e6, 500e6], ['lt1mb', '1to5mb', '5to25mb', '25to100mb', '100to500mb', 'gt500mb']);
const durBucket = (seconds) => bucket(seconds, [60, 600, 1800, 3600, 7200], ['lt1m', '1to10m', '10to30m', '30to60m', '1to2h', 'gt2h']);

/** "C:\\Users\\Ana\\app\\handlers.js:123:7" -> "handlers.js:123": a file name and a line, never a folder (which holds the person's user name). */
function where(stack) {
  const m = /([A-Za-z0-9_.-]+\.(?:js|jsx|mjs|cjs)):(\d+)/.exec(String(stack || ''));
  return m ? `${m[1]}:${m[2]}` : undefined;
}

class Telemetry {
  constructor({ api, store, secure, version, platform, packaged, getLocale = () => undefined, enabled = true, now = () => Date.now(), flushMs = 60000, timeoutMs = 8000 }) {
    Object.assign(this, { api, store, secure, version, platform, packaged, getLocale, enabled, now, flushMs, timeoutMs });
    this.sessionId = crypto.randomUUID();
    this.startedAt = now();
    this.queue = enabled ? (secure.get('telemetryQueue') || []) : [];
    this.pausedUntil = Number(secure.get('telemetryPausedUntil')) || 0;
    this.sending = null;
    this.timer = null;
    this.windows = new Map();                                  // channel -> [window start, count], so a chatty channel is sampled instead of flooding
  }

  get installId() {
    if (!this.store.data.installId) { this.store.data.installId = crypto.randomUUID(); this.store.flush(); }
    return this.store.data.installId;
  }

  track(name, props = {}) {
    if (!this.enabled || !EVENTS.has(name)) return;
    this.queue.push({ name, ts: this.now(), props: cleanProps(props) });
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);      // the oldest go first
    if (this.queue.length >= BATCH / 2) this.flush().catch(() => {});
  }

  /** One handler call: which one, how long, did it work. Never the arguments or the result. Channels called very often are sampled. */
  call(channel, ms, ok, code) {
    if (ok && ms < 1000 && QUIET_READS.test(channel)) return;        // routine fast reads say nothing; slow or failing ones are kept
    const t = this.now();
    const w = this.windows.get(channel);
    if (!w || t - w[0] > 60000) this.windows.set(channel, [t, 1]);
    else if (++w[1] > 12) return;
    this.track('api_call', { channel, ms: Math.round(ms), ok, code: ok ? undefined : code });
  }

  error(source, err, extra = {}) {
    const name = err && typeof err.name === 'string' ? err.name : 'Error';
    this.track('error', { source, name, code: err && typeof err.code === 'string' ? err.code : undefined, where: where(err && err.stack), ...extra });
  }

  persist() { try { this.secure.set('telemetryQueue', this.queue.length ? this.queue : null); } catch { /* secure storage unavailable: the queue stays in memory */ } }

  async flush() {
    if (!this.enabled || this.sending || !this.queue.length || this.now() < this.pausedUntil) return this.sending;
    this.sending = (async () => {
      const batch = this.queue.slice(0, BATCH);
      const body = { install_id: this.installId, session_id: this.sessionId, app_version: this.version, platform: this.platform, channel: this.packaged ? 'release' : 'dev', locale: this.getLocale(), events: batch };
      try {
        const send = this.api.signedIn() ? this.api.request('POST', '/v1/telemetry/events', { body }) : this.api._send('POST', '/v1/telemetry/events', { auth: false, body });
        const res = await Promise.race([send, new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'offline' })), this.timeoutMs))]);
        this.queue.splice(0, batch.length);
        if (res && res.disabled) { this.queue = []; this.pausedUntil = this.now() + PAUSE_MS; this.secure.set('telemetryPausedUntil', this.pausedUntil); }   // a company that keeps the cloud off, or the server switched it off
      } catch (err) {
        if (!(err.code === 'offline' || err.status >= 500 || err.status === 429 || err.status === 401)) this.queue.splice(0, batch.length);     // refused for good: drop this batch
      }
      this.persist();
    })().finally(() => { this.sending = null; });
    return this.sending;
  }

  start() {
    if (!this.enabled || this.timer) return;
    this.timer = setInterval(() => this.flush().catch(() => {}), this.flushMs);
    if (this.timer.unref) this.timer.unref();
    this.flush().catch(() => {});                              // whatever was waiting from last time
  }

  /** Called as the app quits: remember what is still waiting; the next start sends it. */
  stop() { clearInterval(this.timer); this.timer = null; this.persist(); }
}

module.exports = { Telemetry, cleanProps, sizeBucket, durBucket, where, EVENTS, PROPS };
