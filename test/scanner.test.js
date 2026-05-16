import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { scanSessions } from '../src/claude-code/scanner.js';

test('scanSessions aggregates token usage across assistant turns', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'convoptics-scan-'));
  const projectDir = path.join(root, '-Users-bren-tokens');
  await fs.mkdir(projectDir, { recursive: true });
  const lines = [
    JSON.stringify({
      type: 'user',
      sessionId: 'tok00001',
      version: '0.30.0',
      timestamp: '2026-05-14T10:00:00Z',
      cwd: '/Users/bren/tokens',
      gitBranch: 'main',
      message: { role: 'user', content: 'hi' },
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-05-14T10:00:01Z',
      message: {
        role: 'assistant',
        content: 'hello',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 10,
          cache_read_input_tokens: 20,
        },
      },
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-05-14T10:00:02Z',
      message: {
        role: 'assistant',
        content: 'more',
        usage: { input_tokens: 5, output_tokens: 7 },
      },
    }),
  ].join('\n') + '\n';
  await fs.writeFile(path.join(projectDir, 'session.jsonl'), lines, 'utf8');

  const sessions = [];
  for await (const session of scanSessions(root)) sessions.push(session);
  assert.strictEqual(sessions.length, 1);
  assert.deepStrictEqual(sessions[0].tokens, {
    input: 105,
    output: 57,
    cacheCreation: 10,
    cacheRead: 20,
  });
});
