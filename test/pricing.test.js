import assert from 'node:assert';
import test from 'node:test';
import { PRICING, resolveModel, costForTokens, costForSession } from '../src/claude-code/pricing.js';

test('resolveModel returns exact match when present', () => {
  const r = resolveModel('claude-opus-4-7');
  assert.strictEqual(r.key, 'claude-opus-4-7');
  assert.strictEqual(r.rates, PRICING['claude-opus-4-7']);
});

test('resolveModel does longest-prefix match for dated variants', () => {
  assert.strictEqual(resolveModel('claude-opus-4-7-20251022').key, 'claude-opus-4-7');
  assert.strictEqual(resolveModel('claude-opus-4-1-20250620').key, 'claude-opus-4-1');
  assert.strictEqual(resolveModel('claude-opus-4-20240620').key, 'claude-opus-4');
  assert.strictEqual(resolveModel('claude-haiku-4-5-20251001').key, 'claude-haiku-4-5');
});

test('resolveModel returns null for unknown models', () => {
  assert.strictEqual(resolveModel('gpt-4'), null);
  assert.strictEqual(resolveModel(''), null);
  assert.strictEqual(resolveModel(null), null);
});

test('costForTokens uses USD per million tokens', () => {
  // Opus 4-7: input $5/M, output $25/M, cacheRead $0.5/M, cacheWrite $6.25/M
  const rates = PRICING['claude-opus-4-7'];
  const cost = costForTokens(
    { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheCreation: 1_000_000 },
    rates,
  );
  // 5 + 25 + 0.5 + 6.25 = 36.75
  assert.strictEqual(Number(cost.toFixed(4)), 36.75);
});

test('costForSession sums across models and reports unknown ones', () => {
  const tokensByModel = {
    'claude-opus-4-7-20251022': { input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0 },
    'claude-sonnet-4-6-20251022': { input: 0, output: 1_000_000, cacheRead: 0, cacheCreation: 0 },
    'some-future-model': { input: 1000, output: 1000, cacheRead: 0, cacheCreation: 0 },
  };
  const { cost, unknownModels } = costForSession(tokensByModel);
  // Opus: 1M input * $5 = $5; Sonnet: 1M output * $15 = $15; total $20
  assert.strictEqual(Number(cost.toFixed(4)), 20);
  assert.deepStrictEqual(unknownModels, ['some-future-model']);
});

test('costForSession ignores unknown models with zero tokens', () => {
  const { unknownModels } = costForSession({
    'phantom-model': { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
  });
  assert.deepStrictEqual(unknownModels, []);
});
