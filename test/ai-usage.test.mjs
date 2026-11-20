import test from 'node:test';
import assert from 'node:assert/strict';
import { aiMeterRows, AI_ACTION_LABELS } from '../src/renderer/lib/ai-usage.mjs';

const usage = {
  plan: 'free', scope: 'user',
  actions: { regenerate: { used: 2, limit: 5 }, chat: { used: 20, limit: 20 }, recipe: { used: 0, limit: 10 }, summary: { used: 1, limit: 10 }, email: { used: 0, limit: 5 } },
  ask_total: { used: 21, limit: 30 },
};

test('the combined cap comes first, then each action in a fixed order, with what is left', () => {
  const rows = aiMeterRows(usage);
  assert.deepEqual(rows.map((r) => r.key), ['ask_total', 'chat', 'recipe', 'summary', 'email', 'regenerate']);
  assert.deepEqual(rows[0], { key: 'ask_total', used: 21, limit: 30, left: 9, full: false, unlimited: false });
  assert.equal(rows.find((r) => r.key === 'chat').full, true);
  assert.equal(rows.find((r) => r.key === 'chat').left, 0);
});

test('no cap means unlimited, never a division or a negative number', () => {
  const rows = aiMeterRows({ plan: 'enterprise', scope: 'org', actions: { chat: { used: 40, limit: null } }, ask_total: { used: 40, limit: 1500 } });
  const chat = rows.find((r) => r.key === 'chat');
  assert.equal(chat.unlimited, true);
  assert.equal(chat.left, null);
  assert.equal(chat.full, false);
});

test('missing or older server answers give no rows instead of an error', () => {
  assert.deepEqual(aiMeterRows(undefined), []);
  assert.deepEqual(aiMeterRows({}), []);
});

test('every action has a Portuguese label to be translated', () => {
  for (const key of ['ask_total', 'chat', 'recipe', 'summary', 'email', 'regenerate']) assert.ok(AI_ACTION_LABELS[key], key);
});

import { aiLimitRows } from '../src/renderer/lib/ai-usage.mjs';

test('a plan card lists each action limit in the same order, null meaning no cap', () => {
  const rows = aiLimitRows({ chat: 20, ask_total: 30, regenerate: 5, email: null });
  assert.deepEqual(rows, [{ key: 'ask_total', limit: 30 }, { key: 'chat', limit: 20 }, { key: 'email', limit: null }, { key: 'regenerate', limit: 5 }]);
  assert.deepEqual(aiLimitRows(undefined), []);
});
