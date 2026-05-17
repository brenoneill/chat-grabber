import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { exportSession } from '../src/cursor/exporter.js';
import { scanSessions } from '../src/cursor/scanner.js';
import { buildCursorRoot } from './cursor-fixtures.js';

async function buildAndScan(spec) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-grabber-cursor-export-'));
  await buildCursorRoot(root, spec);
  const sessions = [];
  for await (const session of scanSessions(root)) sessions.push(session);
  return { root, sessions };
}

test('exportSession renders bubbles grouped by role into markdown', async () => {
  const { sessions } = await buildAndScan({
    workspaces: [
      {
        folder: '/Users/bren/projectA',
        composers: [
          {
            composerId: 'render01',
            name: 'rendering',
            branch: 'main',
            createdAt: 1747400000000,
            lastUpdatedAt: 1747400060000,
          },
        ],
      },
    ],
    composers: {
      render01: {
        header: {
          composerId: 'render01',
          name: 'rendering',
          createdAt: 1747400000000,
          lastUpdatedAt: 1747400060000,
          conversation: [
            { bubbleId: 'b1' },
            { bubbleId: 'b2' },
            { bubbleId: 'b3' },
          ],
        },
        bubbles: [
          { bubbleId: 'b1', type: 1, text: 'please refactor', _v: 3 },
          { bubbleId: 'b2', type: 2, text: 'thinking it through', _v: 3 },
          { bubbleId: 'b3', type: 2, text: 'done', _v: 3 },
        ],
      },
    },
  });

  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-grabber-cursor-out-'));
  const result = await exportSession(sessions[0], outDir, { full: true });
  const contents = await fs.readFile(path.join(outDir, result.filename), 'utf8');

  assert(contents.includes('sessionId: "render01"'));
  assert(contents.includes('gitBranch: "main"'));
  assert(contents.includes('tokensInput: 0'));
  assert(contents.includes('## User'));
  assert(contents.includes('please refactor'));
  assert(contents.includes('## Assistant'));
  assert(contents.includes('thinking it through'));
  assert(contents.includes('done'));
  assert.strictEqual(
    contents.match(/## Assistant/g).length,
    1,
    'consecutive assistant bubbles should share one heading',
  );
});

test('exportSession redacts diff fields when noDiffs is true', async () => {
  const secret = 'SECRET_API_KEY=hunter2';
  const { sessions } = await buildAndScan({
    workspaces: [
      {
        folder: '/Users/bren/projectA',
        composers: [
          {
            composerId: 'redact01',
            name: 'redaction',
            branch: 'main',
            createdAt: 1747400000000,
            lastUpdatedAt: 1747400060000,
          },
        ],
      },
    ],
    composers: {
      redact01: {
        header: {
          composerId: 'redact01',
          createdAt: 1747400000000,
          lastUpdatedAt: 1747400060000,
          conversation: [{ bubbleId: 'b1' }],
        },
        bubbles: [
          {
            bubbleId: 'b1',
            type: 2,
            text: 'edited file',
            _v: 3,
            gitDiffs: [
              { path: 'config.js', patch: `+ ${secret}\n` },
            ],
            assistantSuggestedDiffs: [{ snippet: secret }],
          },
        ],
      },
    },
  });

  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-grabber-cursor-out-'));
  const result = await exportSession(sessions[0], outDir, { full: true, noDiffs: true });
  const contents = await fs.readFile(path.join(outDir, result.filename), 'utf8');

  assert(!contents.includes(secret), 'redacted body leaked secret');
  assert(contents.includes('[diffs redacted]'));
});

test('exportSession includes diff JSON when noDiffs is false', async () => {
  const { sessions } = await buildAndScan({
    workspaces: [
      {
        folder: '/Users/bren/projectA',
        composers: [
          {
            composerId: 'difffull1',
            branch: 'main',
            createdAt: 1747400000000,
            lastUpdatedAt: 1747400060000,
          },
        ],
      },
    ],
    composers: {
      difffull1: {
        header: {
          composerId: 'difffull1',
          createdAt: 1747400000000,
          lastUpdatedAt: 1747400060000,
          conversation: [{ bubbleId: 'b1' }],
        },
        bubbles: [
          {
            bubbleId: 'b1',
            type: 2,
            text: 'edit',
            _v: 3,
            gitDiffs: [{ path: 'app.js', patch: '+ console.log("hi")' }],
          },
        ],
      },
    },
  });

  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-grabber-cursor-out-'));
  const result = await exportSession(sessions[0], outDir, { full: true });
  const contents = await fs.readFile(path.join(outDir, result.filename), 'utf8');

  assert(contents.includes('app.js'));
  assert(contents.includes('console.log'));
  assert(!contents.includes('[diffs redacted]'));
});

test('exportSession warns on unexpected _v values', async () => {
  const { sessions } = await buildAndScan({
    workspaces: [
      {
        folder: '/Users/bren/projectA',
        composers: [
          {
            composerId: 'verdrift1',
            branch: 'main',
            createdAt: 1747400000000,
            lastUpdatedAt: 1747400060000,
          },
        ],
      },
    ],
    composers: {
      verdrift1: {
        header: {
          composerId: 'verdrift1',
          createdAt: 1747400000000,
          lastUpdatedAt: 1747400060000,
          conversation: [{ bubbleId: 'b1' }],
        },
        bubbles: [
          { bubbleId: 'b1', type: 2, text: 'hi from the future', _v: 4 },
        ],
      },
    },
  });

  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-grabber-cursor-out-'));
  const originalWrite = process.stderr.write.bind(process.stderr);
  let captured = '';
  process.stderr.write = (chunk) => {
    captured += typeof chunk === 'string' ? chunk : chunk.toString();
    return true;
  };
  try {
    await exportSession(sessions[0], outDir, { full: true });
  } finally {
    process.stderr.write = originalWrite;
  }
  assert(captured.includes('unexpected _v values'));
  assert(captured.includes('4'));
});
