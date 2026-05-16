import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { buildCursorRoot } from './cursor-fixtures.js';

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

test('cursor: exports markdown for matching sessions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'convoptics-cli-cursor-'));
  await buildCursorRoot(root, {
    workspaces: [
      {
        folder: '/Users/bren/projectA',
        composers: [
          {
            composerId: 'clic1',
            name: 'cli test',
            branch: 'main',
            createdAt: 1747400000000,
            lastUpdatedAt: 1747400060000,
          },
        ],
      },
    ],
    composers: {
      clic1: {
        header: {
          composerId: 'clic1',
          createdAt: 1747400000000,
          lastUpdatedAt: 1747400060000,
          conversation: [{ bubbleId: 'b1' }, { bubbleId: 'b2' }],
        },
        bubbles: [
          { bubbleId: 'b1', type: 1, text: 'hi', _v: 3 },
          { bubbleId: 'b2', type: 2, text: 'hello', _v: 3 },
        ],
      },
    },
  });
  const outDir = path.join(root, 'out');
  const { code, stderr } = await runCli([
    '--root', root, '--out', outDir, 'tool:cursor', 'branch:main',
  ]);
  assert.strictEqual(code, 0, `exit ${code}; stderr=${stderr}`);
  const files = (await fs.readdir(outDir)).filter((f) => f.endsWith('.md'));
  assert.strictEqual(files.length, 2, `expected 1 session + _index.md, got ${files.join(', ')}`);
  assert(files.includes('_index.md'));
  const session = files.find((f) => f !== '_index.md');
  const contents = await fs.readFile(path.join(outDir, session), 'utf8');
  assert(contents.includes('sessionId: "clic1"'));
  assert(contents.includes('hello'));
});

test('cursor: --output-only is rejected', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'convoptics-cli-cursor-rej-'));
  await buildCursorRoot(root, { workspaces: [] });
  const { code, stderr } = await runCli(['--root', root, '--output-only', 'tool:cursor']);
  assert.strictEqual(code, 1);
  assert(stderr.includes('--output-only is not supported for tool:cursor'));
});

test('cursor: project: filter matches workspace folder basename', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'convoptics-cli-cursor-proj-'));
  await buildCursorRoot(root, {
    workspaces: [
      {
        folder: '/Users/bren/projectA',
        composers: [{ composerId: 'pA1', branch: 'main', createdAt: 1747400000000, lastUpdatedAt: 1747400000000 }],
      },
      {
        folder: '/Users/bren/projectB',
        composers: [{ composerId: 'pB1', branch: 'main', createdAt: 1747400000000, lastUpdatedAt: 1747400000000 }],
      },
    ],
    composers: {
      pA1: { header: { composerId: 'pA1', createdAt: 1747400000000, lastUpdatedAt: 1747400000000, conversation: [] }, bubbles: [] },
      pB1: { header: { composerId: 'pB1', createdAt: 1747400000000, lastUpdatedAt: 1747400000000, conversation: [] }, bubbles: [] },
    },
  });
  const { code, stdout } = await runCli([
    '--root', root, '--dry-run', 'tool:cursor', 'project:projectA',
  ]);
  assert.strictEqual(code, 0);
  assert(stdout.includes('pA1'));
  assert(!stdout.includes('pB1'));
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
