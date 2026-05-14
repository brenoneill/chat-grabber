import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { exportSession } from '../src/exporter.js';

const fixturePath = path.join('test', 'fixtures', 'projects', '-Users-bren-projectA', 'session-a1b2.jsonl');

test('exportSession renders markdown transcript and writes file', async () => {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'convoptics-export-'));
  const meta = {
    path: path.resolve(fixturePath),
    sessionId: 'a1b2c3d4',
    projectFolder: 'projectA',
    cwd: '/Users/bren/projectA',
    gitBranch: 'feature/payments',
    version: '0.30.0',
    startedAt: '2026-05-12T08:00:00Z',
    endedAt: '2026-05-12T08:00:02Z',
    summary: 'payments-refactor',
  };
  const result = await exportSession(meta, outDir, { full: true });
  const contents = await fs.readFile(path.join(outDir, result.filename), 'utf8');
  assert(contents.includes('sessionId: "a1b2c3d4"'));
  assert(contents.includes('## User'));
  assert(contents.includes('Please refactor the payment handler.'));
  assert(contents.includes('## Assistant'));
});

test('exportSession truncates tool results over 4KB unless full is true', async () => {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'convoptics-export-'));
  const huge = 'x'.repeat(5000);
  const jsonl = JSON.stringify({
    type: 'assistant',
    sessionId: 'bigtool1',
    timestamp: '2026-05-14T12:00:00Z',
    message: { role: 'assistant', content: [{ type: 'tool_result', output: huge }] },
  }) + '\n';
  const filePath = path.join(outDir, 'huge.jsonl');
  await fs.writeFile(filePath, jsonl, 'utf8');

  const meta = {
    path: filePath,
    sessionId: 'bigtool1',
    projectFolder: 'projectA',
    cwd: '/Users/bren/projectA',
    gitBranch: 'feature/payments',
    version: '0.30.0',
    startedAt: '2026-05-14T12:00:00Z',
    endedAt: '2026-05-14T12:00:00Z',
    summary: 'huge-result',
  };

  const result = await exportSession(meta, outDir, { full: false });
  const contents = await fs.readFile(path.join(outDir, result.filename), 'utf8');
  assert(contents.includes('more chars truncated'));
});

test('exportSession redacts Edit/Write tool inputs when noDiffs is true', async () => {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'convoptics-export-'));
  const oldString = 'line1\nline2\nline3';
  const newString = 'line1\nLINE2\nline3\nline4';
  const secret = 'SECRET_API_KEY=hunter2';
  const jsonl = [
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-05-14T12:00:00Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', name: 'Edit', input: { old_string: oldString, new_string: newString } },
          { type: 'tool_use', name: 'Write', input: { content: `${secret}\nfoo\nbar` } },
        ],
      },
    }),
  ].join('\n') + '\n';
  const filePath = path.join(outDir, 'redact.jsonl');
  await fs.writeFile(filePath, jsonl, 'utf8');

  const meta = {
    path: filePath,
    sessionId: 'redact01',
    projectFolder: 'projectA',
    cwd: '/Users/bren/projectA',
    gitBranch: 'main',
    version: '0.30.0',
    startedAt: '2026-05-14T12:00:00Z',
    endedAt: '2026-05-14T12:00:00Z',
    summary: 'redaction',
    tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
  };
  const result = await exportSession(meta, outDir, { full: true, noDiffs: true });
  const contents = await fs.readFile(path.join(outDir, result.filename), 'utf8');
  assert(!contents.includes(oldString), 'old_string content leaked');
  assert(!contents.includes('LINE2'), 'new_string content leaked');
  assert(!contents.includes(secret), 'Write content leaked');
  assert(contents.includes('[diff redacted: 4 lines added, 3 lines removed]'));
  assert(contents.includes('[diff redacted: 3 lines added, 0 lines removed]'));
});

test('exportSession writes token totals to frontmatter', async () => {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'convoptics-export-'));
  const meta = {
    path: path.resolve(fixturePath),
    sessionId: 'tok00001',
    projectFolder: 'projectA',
    cwd: '/Users/bren/projectA',
    gitBranch: 'feature/payments',
    version: '0.30.0',
    startedAt: '2026-05-12T08:00:00Z',
    endedAt: '2026-05-12T08:00:02Z',
    summary: 'payments-refactor',
    tokens: { input: 123, output: 456, cacheCreation: 7, cacheRead: 89 },
  };
  const result = await exportSession(meta, outDir, { full: true });
  const contents = await fs.readFile(path.join(outDir, result.filename), 'utf8');
  assert(contents.includes('tokensInput: 123'));
  assert(contents.includes('tokensOutput: 456'));
  assert(contents.includes('tokensCacheCreation: 7'));
  assert(contents.includes('tokensCacheRead: 89'));
});

test('exportSession appends suffix for filename collisions', async () => {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'convoptics-export-'));
  const meta1 = {
    path: path.resolve(fixturePath),
    sessionId: 'abcd1234aaaa',
    projectFolder: 'projectA',
    cwd: '/Users/bren/projectA',
    gitBranch: 'feature/payments',
    version: '0.30.0',
    startedAt: '2026-05-12T08:00:00Z',
    endedAt: '2026-05-12T08:00:02Z',
    summary: 'first',
  };
  const meta2 = { ...meta1, path: path.resolve(fixturePath), sessionId: 'abcd1234bbbb', summary: 'second' };
  const result1 = await exportSession(meta1, outDir, { full: true });
  const result2 = await exportSession(meta2, outDir, { full: true });
  assert.strictEqual(result1.filename.endsWith('.md'), true);
  assert.strictEqual(result2.filename.includes('_2.md'), true);
});
