import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeImport } from '../src/renderer/lib/import-decode.mjs';

test('a browser codec failure falls back to local decoding with the original bytes intact', async () => {
  const raw = Uint8Array.from([1, 2, 3]).buffer;
  const expected = new Int16Array([12, -34]).buffer;
  const result = await decodeImport(raw, async (bytes) => {
    assert.deepEqual([...new Uint8Array(bytes)], [1, 2, 3]);
    return expected;
  }, async (copy) => {
    structuredClone(copy, { transfer: [copy] }); // decodeAudioData detaches its input
    throw new Error('Unsupported codec');
  });
  assert.equal(result, expected);
});

test('browser-readable files do not invoke the native decoder', async () => {
  const expected = new Int16Array([9]).buffer;
  assert.equal(await decodeImport(new ArrayBuffer(2), () => assert.fail('native decode'), async () => expected), expected);
});

test('cancelling while the browser is decoding never starts the fallback', async () => {
  await assert.rejects(decodeImport(new ArrayBuffer(2), () => assert.fail('native decode'), async () => { throw new Error('codec'); }, () => true), /codec/);
});
