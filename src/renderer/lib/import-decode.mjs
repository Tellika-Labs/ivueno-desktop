import { webmToPcm16 } from './pcm.mjs';

/** Try the browser first; its codec support varies by platform and container. */
export async function decodeImport(raw, nativeDecode, browserDecode = webmToPcm16, isCancelled = () => false) {
  try { return await browserDecode(raw.slice(0)); }
  catch (error) {
    if (isCancelled()) throw error;
    return nativeDecode(raw);
  }
}
