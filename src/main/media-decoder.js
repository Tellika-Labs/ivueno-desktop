const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const fail = (code) => Object.assign(new Error(code), { code });
const MAX_BYTES = 1.5e9;

function binaryPath() {
  const bundled = require('ffmpeg-static');
  if (!bundled) throw fail('media_decoder_missing');
  // Executables cannot run from an Electron ASAR archive.
  return bundled.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
}

/** Local-only import fallback. No renderer-provided paths, commands or network protocols. */
class MediaDecoder {
  constructor({ binary, tmpDir = os.tmpdir(), maxSeconds = 4 * 3600, timeoutMs = 10 * 60 * 1000 } = {}) {
    this.binary = binary; this.tmpDir = tmpDir; this.maxSeconds = maxSeconds; this.timeoutMs = timeoutMs;
    this.active = null;
  }

  cancel() {
    if (this.active) { this.active.cancelled = true; this.active.child?.kill(); }
  }

  async decode(data) {
    if (this.active) throw fail('media_decode_busy');
    if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) throw fail('invalid_audio');
    const bytes = data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    if (!bytes.length || bytes.length > MAX_BYTES) throw fail('invalid_audio');
    const job = { child: null, cancelled: false };
    this.active = job;
    let directory;
    try {
      directory = await fs.mkdtemp(path.join(this.tmpDir, 'ivueno-decode-'));
      const input = path.join(directory, 'input.media');
      const output = path.join(directory, 'audio.pcm');
      await fs.writeFile(input, bytes, { mode: 0o600 });
      if (job.cancelled) throw fail('media_decode_cancelled');
      await new Promise((resolve, reject) => {
        let child;
        try {
          child = spawn(this.binary || binaryPath(), [
            '-nostdin', '-hide_banner', '-loglevel', 'error',
            '-protocol_whitelist', 'file,pipe',
            '-format_whitelist', 'mov,mp3,wav,ogg,flac,matroska,webm,aac',
            '-i', input, '-map', '0:a:0', '-vn', '-sn', '-dn',
            '-threads', '1', '-t', String(this.maxSeconds + 1),
            '-ac', '1', '-ar', '16000', '-f', 's16le', output,
          ], { windowsHide: true, stdio: 'ignore' });
        } catch { reject(fail('media_decoder_missing')); return; }
        job.child = child;
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; child.kill(); }, this.timeoutMs);
        child.once('error', () => { clearTimeout(timer); reject(fail('media_decoder_missing')); });
        child.once('close', (code) => {
          clearTimeout(timer);
          if (job.cancelled) reject(fail('media_decode_cancelled'));
          else if (timedOut) reject(fail('media_decode_timeout'));
          else if (code !== 0) reject(fail('invalid_audio'));
          else resolve();
        });
      });
      const { size } = await fs.stat(output);
      if (size > this.maxSeconds * 32000) throw fail('audio_too_long');
      if (!size || size % 2) throw fail('invalid_audio');
      if (job.cancelled) throw fail('media_decode_cancelled');
      const pcm = await fs.readFile(output);
      return pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength);
    } finally {
      // Only this newly created temporary directory is ever removed.
      try { if (directory) await fs.rm(directory, { recursive: true, force: true }); }
      finally { if (this.active === job) this.active = null; }
    }
  }
}

module.exports = { MediaDecoder, binaryPath };
