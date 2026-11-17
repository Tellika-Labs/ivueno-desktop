// How the app is used, never what is said in it. The main process checks every event against an allowlist before it is queued
// (main/telemetry.js) and the server checks it again (backend/app/telemetry.py): only known event names, only known property names,
// and strings that are short identifiers. So: pass names, codes and buckets here; never a title, a note, a name, a file name or a search.
import { send } from './bridge.js';

export function track(name, props) {
  try { send('telemetry:event', { name, props }); } catch { /* telemetry must never break the app */ }
}

/** "http://localhost:5173/src/renderer/screens/Home.jsx?t=12" + line 40 -> "Home.jsx:40": a file and a line, no folders. */
export function whereOf(file, line) {
  const m = /([A-Za-z0-9_.-]+\.(?:js|jsx|mjs))(?:\?|$)/.exec(String(file || ''));
  return m ? `${m[1]}:${line || 0}` : undefined;
}

export function installErrorTracking() {
  window.addEventListener('error', (e) => track('error', { source: 'renderer', name: (e.error && e.error.name) || 'Error', where: whereOf(e.filename, e.lineno) }));
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    track('error', { source: 'renderer', name: (r && typeof r.name === 'string' && r.name) || 'UnhandledRejection', code: r && typeof r.code === 'string' ? r.code : undefined });
  });
}

/** Buckets, so an exact size or length (which could identify a file) is never sent. */
const bucket = (n, edges, labels) => { const i = edges.findIndex((e) => n < e); return labels[i === -1 ? labels.length - 1 : i]; };
export const sizeBucket = (bytes) => bucket(bytes, [1e6, 5e6, 25e6, 100e6, 500e6], ['lt1mb', '1to5mb', '5to25mb', '25to100mb', '100to500mb', 'gt500mb']);
export const durBucket = (seconds) => bucket(seconds, [60, 600, 1800, 3600, 7200], ['lt1m', '1to10m', '10to30m', '30to60m', '1to2h', 'gt2h']);
