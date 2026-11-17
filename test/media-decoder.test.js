const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { MediaDecoder, binaryPath } = require('../src/main/media-decoder');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ivueno-media-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'WhatsApp Audio.mp4');
  execFileSync(binaryPath(), ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'aac', input], { windowsHide: true });
  return { directory, data: await fs.readFile(input) };
}

test('MP4 AAC with its index at the end decodes locally to 16 kHz mono PCM and cleans temporary audio', async (t) => {
  const { directory, data } = await fixture(t);
  const pcm = new Int16Array(await new MediaDecoder({ tmpDir: directory }).decode(data));
  assert.ok(pcm.length >= 32000 && pcm.length < 35000, `samples: ${pcm.length}`);
  assert.ok(pcm.some(value => Math.abs(value) > 100));
  assert.deepEqual(await fs.readdir(directory), ['WhatsApp Audio.mp4']);
});

test('decode accepts an IPC ArrayBuffer and rejects recordings exceeding the duration limit', async (t) => {
  const { directory, data } = await fixture(t);
  const raw = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const decoder = new MediaDecoder({ tmpDir: directory, maxSeconds: 1 });
  await assert.rejects(decoder.decode(raw), { code: 'audio_too_long' });
  assert.equal(decoder.active, null);
  assert.deepEqual(await fs.readdir(directory), ['WhatsApp Audio.mp4']);
});

test('invalid audio and playlist inputs fail without leaving temporary files', async (t) => {
  const { directory } = await fixture(t);
  const decoder = new MediaDecoder({ tmpDir: directory });
  for (const data of [Buffer.from('not audio'), Buffer.from('#EXTM3U\nhttps://example.com/audio.mp3\n')]) {
    await assert.rejects(decoder.decode(data), { code: 'invalid_audio' });
    assert.equal(decoder.active, null);
  }
  assert.deepEqual(await fs.readdir(directory), ['WhatsApp Audio.mp4']);
});

test('cancelling during preparation stops decoding and removes the private input', async (t) => {
  const { directory, data } = await fixture(t);
  const decoder = new MediaDecoder({ tmpDir: directory });
  const pending = decoder.decode(data);
  await assert.rejects(decoder.decode(data), { code: 'media_decode_busy' });
  decoder.cancel();
  await assert.rejects(pending, { code: 'media_decode_cancelled' });
  assert.equal(decoder.active, null);
  assert.deepEqual(await fs.readdir(directory), ['WhatsApp Audio.mp4']);
});

test('missing decoder is actionable and cleans up its input', async (t) => {
  const { directory, data } = await fixture(t);
  await assert.rejects(new MediaDecoder({ tmpDir: directory, binary: path.join(directory, 'missing.exe') }).decode(data), { code: 'media_decoder_missing' });
  assert.deepEqual(await fs.readdir(directory), ['WhatsApp Audio.mp4']);
});
