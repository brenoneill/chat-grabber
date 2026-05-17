import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { scanSessions } from '../src/cursor/scanner.js';
import { buildCursorRoot } from './cursor-fixtures.js';

async function mkRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'chat-grabber-cursor-scan-'));
}

test('scanSessions joins workspace registry to global composer rows', async () => {
  const root = await mkRoot();
  await buildCursorRoot(root, {
    workspaces: [
      {
        folder: '/Users/bren/projectA',
        composers: [
          {
            composerId: 'abc12345-1111-2222-3333-444455556666',
            name: 'refactor payments',
            branch: 'feature/payments',
            createdAt: 1747400000000,
            lastUpdatedAt: 1747400060000,
          },
        ],
      },
    ],
    composers: {
      'abc12345-1111-2222-3333-444455556666': {
        header: {
          composerId: 'abc12345-1111-2222-3333-444455556666',
          name: 'refactor payments',
          createdAt: 1747400000000,
          lastUpdatedAt: 1747400060000,
          conversation: [
            { bubbleId: 'b1' },
            { bubbleId: 'b2' },
          ],
        },
        bubbles: [
          { bubbleId: 'b1', type: 1, text: 'please refactor', _v: 3 },
          { bubbleId: 'b2', type: 2, text: 'on it', _v: 3 },
        ],
      },
    },
  });

  const sessions = [];
  for await (const session of scanSessions(root)) sessions.push(session);

  assert.strictEqual(sessions.length, 1);
  const s = sessions[0];
  assert.strictEqual(s.sessionId, 'abc12345-1111-2222-3333-444455556666');
  assert.strictEqual(s.cwd, '/Users/bren/projectA');
  assert.strictEqual(s.projectFolder, 'projectA');
  assert.strictEqual(s.gitBranch, 'feature/payments');
  assert.strictEqual(s.summary, 'refactor payments');
  assert.strictEqual(s.startedAt, new Date(1747400000000).toISOString());
  assert.strictEqual(s.endedAt, new Date(1747400060000).toISOString());
  assert.strictEqual(s.version, null);
  assert.strictEqual(s.messageCount, 2);
  assert.deepStrictEqual(s.tokens, { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 });
  assert.deepStrictEqual(s._cursor.conversationOrder, ['b1', 'b2']);
});

test('scanSessions returns orphan sessions with null cwd/branch', async () => {
  const root = await mkRoot();
  await buildCursorRoot(root, {
    workspaces: [],
    orphans: {
      'orphan11-aaaa-bbbb-cccc-ddddeeeeffff': {
        header: {
          composerId: 'orphan11-aaaa-bbbb-cccc-ddddeeeeffff',
          name: 'leftover',
          createdAt: 1747400000000,
          lastUpdatedAt: 1747400000000,
          conversation: [],
        },
        bubbles: [{ bubbleId: 'b1', type: 1, text: 'hi', _v: 3 }],
      },
    },
  });

  const sessions = [];
  for await (const session of scanSessions(root)) sessions.push(session);

  assert.strictEqual(sessions.length, 1);
  assert.strictEqual(sessions[0].cwd, null);
  assert.strictEqual(sessions[0].gitBranch, null);
  assert.strictEqual(sessions[0].projectFolder, null);
});

test('scanSessions returns nothing when global DB is missing', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-grabber-cursor-empty-'));
  const sessions = [];
  for await (const session of scanSessions(root)) sessions.push(session);
  assert.strictEqual(sessions.length, 0);
});

test('scanSessions handles multiple workspaces and composers', async () => {
  const root = await mkRoot();
  await buildCursorRoot(root, {
    workspaces: [
      {
        folder: '/Users/bren/projectA',
        composers: [
          { composerId: 'c1', name: 'first', branch: 'main', createdAt: 1747400000000, lastUpdatedAt: 1747400000000 },
        ],
      },
      {
        folder: '/Users/bren/projectB',
        composers: [
          { composerId: 'c2', name: 'second', branch: 'main', createdAt: 1747500000000, lastUpdatedAt: 1747500000000 },
        ],
      },
    ],
    composers: {
      c1: { header: { composerId: 'c1', createdAt: 1747400000000, lastUpdatedAt: 1747400000000, conversation: [] }, bubbles: [] },
      c2: { header: { composerId: 'c2', createdAt: 1747500000000, lastUpdatedAt: 1747500000000, conversation: [] }, bubbles: [] },
    },
  });

  const sessions = [];
  for await (const session of scanSessions(root)) sessions.push(session);

  assert.strictEqual(sessions.length, 2);
  const byId = Object.fromEntries(sessions.map((s) => [s.sessionId, s]));
  assert.strictEqual(byId.c1.cwd, '/Users/bren/projectA');
  assert.strictEqual(byId.c2.cwd, '/Users/bren/projectB');
});
