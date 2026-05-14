import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const BIN = path.resolve('bin/convoptics.js');

function runCli(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('--output-only prints per-session and totals tables with cost', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'convoptics-cli-'));
  const projectDir = path.join(root, '-Users-bren-projectA');
  await fs.mkdir(projectDir, { recursive: true });
  const lines = [
    JSON.stringify({
      type: 'user',
      sessionId: 's1aaaaaaa',
      timestamp: '2026-05-12T08:00:00Z',
      cwd: '/Users/bren/projectA',
      gitBranch: 'main',
      message: { role: 'user', content: 'hi' },
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-05-12T08:00:01Z',
      message: {
        role: 'assistant',
        model: 'claude-opus-4-7-20251022',
        content: 'hello',
        usage: { input_tokens: 1_000_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    }),
  ].join('\n') + '\n';
  await fs.writeFile(path.join(projectDir, 's1.jsonl'), lines, 'utf8');

  const { code, stdout, stderr } = await runCli(['--root', root, '--output-only', 'tool:claude-code']);
  assert.strictEqual(code, 0, `exit ${code}; stderr=${stderr}`);
  assert(stdout.includes('# Session usage'), 'missing usage heading');
  assert(stdout.includes('claude-opus-4-7'), 'missing resolved model name');
  assert(stdout.includes('1,000,000'), 'missing formatted input tokens');
  assert(stdout.includes('## Totals'), 'missing totals heading');
  // Opus 4-7 input is $5/MTok; 1M input tokens => $5.00
  assert(stdout.includes('$5.00'), `expected $5.00 in output, got:\n${stdout}`);
});

test('--output-only warns on unpriced models but still exits 0', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'convoptics-cli-'));
  const projectDir = path.join(root, '-Users-bren-future');
  await fs.mkdir(projectDir, { recursive: true });
  const lines = [
    JSON.stringify({
      type: 'user',
      sessionId: 'future001',
      timestamp: '2026-05-12T08:00:00Z',
      cwd: '/Users/bren/future',
      gitBranch: 'main',
      message: { role: 'user', content: 'hi' },
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-05-12T08:00:01Z',
      message: {
        role: 'assistant',
        model: 'claude-future-9000',
        content: 'hi',
        usage: { input_tokens: 100, output_tokens: 100 },
      },
    }),
  ].join('\n') + '\n';
  await fs.writeFile(path.join(projectDir, 's.jsonl'), lines, 'utf8');

  const { code, stderr } = await runCli(['--root', root, '--output-only', 'tool:claude-code']);
  assert.strictEqual(code, 0);
  assert(stderr.includes('unpriced model'), `expected warning, got:\n${stderr}`);
  assert(stderr.includes('claude-future-9000'));
});
