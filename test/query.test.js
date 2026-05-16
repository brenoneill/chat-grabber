import assert from 'node:assert';
import test from 'node:test';
import { parseQuery } from '../src/query.js';

test('parseQuery accepts valid tokens and repeated keys OR', () => {
  const spec = parseQuery(['tool:claude-code', 'branch:main', 'branch:feature/*', 'cwd:projectA', 'session:abc', 'version:0.30.0']);
  assert.strictEqual(spec.tool, 'claude-code');
  assert.deepStrictEqual(spec.branch, ['main', 'feature/*']);
  assert.deepStrictEqual(spec.cwd, ['projectA']);
  assert.deepStrictEqual(spec.session, ['abc']);
  assert.deepStrictEqual(spec.version, ['0.30.0']);
});

test('parseQuery accepts date operators', () => {
  const spec = parseQuery(['tool:claude-code', 'date:2026-05-14', 'date>=2026-05-01', 'date<2026-06-01']);
  assert.strictEqual(spec.date.eq, '2026-05-14');
  assert.strictEqual(spec.date.gte, '2026-05-01');
  assert.strictEqual(spec.date.lt, '2026-06-01');
});

test('parseQuery accepts diffs: diffs and no-diffs', () => {
  const defaultSpec = parseQuery(['tool:claude-code']);
  assert.strictEqual(defaultSpec.diffs, 'diffs');
  const noDiffsSpec = parseQuery(['tool:claude-code', 'diffs:no-diffs']);
  assert.strictEqual(noDiffsSpec.diffs, 'no-diffs');
  assert.throws(() => parseQuery(['tool:claude-code', 'diffs:nope']), {
    message: /Invalid value for diffs/,
  });
});

test('parseQuery throws for invalid token', () => {
  assert.throws(() => parseQuery(['tool:claude-code', 'branch']), {
    message: /Invalid query token: branch/,
  });
  assert.throws(() => parseQuery(['tool:claude-code', 'date!=2026-05-14']), {
    message: /Invalid query token: date!=2026-05-14/,
  });
  assert.throws(() => parseQuery(['branch:main']), {
    message: /Missing required filter: tool/,
  });
});

test('parseQuery accepts tool:cursor', () => {
  const spec = parseQuery(['tool:cursor', 'branch:main', 'cwd:projectA', 'project:projectA']);
  assert.strictEqual(spec.tool, 'cursor');
  assert.deepStrictEqual(spec.branch, ['main']);
  assert.deepStrictEqual(spec.project, ['projectA']);
});

test('parseQuery rejects unknown tools', () => {
  assert.throws(() => parseQuery(['tool:vscode']), {
    message: /Unknown tool: vscode/,
  });
});

test('parseQuery rejects version: when tool:cursor', () => {
  assert.throws(() => parseQuery(['tool:cursor', 'version:1.0.0']), {
    message: /Filter "version:" is not supported for tool:cursor/,
  });
});
