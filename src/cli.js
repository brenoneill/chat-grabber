import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { Command } from 'commander';
import { parseQuery } from './query.js';
import { match } from './matcher.js';
import * as claudeCodeAdapter from './claude-code/scanner.js';
import { exportSession as exportClaudeCodeSession } from './claude-code/exporter.js';
import * as cursorAdapter from './cursor/scanner.js';
import { exportSession as exportCursorSession } from './cursor/exporter.js';
import { costForSession, resolveModel } from './claude-code/pricing.js';

const ADAPTERS = {
  'claude-code': {
    scan: claudeCodeAdapter.scanSessions,
    exportSession: exportClaudeCodeSession,
    defaultRoot: () => path.join(os.homedir(), '.claude', 'projects'),
    rootLabel: 'Claude Code projects root',
    supportsCost: true,
  },
  cursor: {
    scan: cursorAdapter.scanSessions,
    exportSession: exportCursorSession,
    defaultRoot: () => cursorAdapter.defaultCursorRoot(),
    rootLabel: 'Cursor user-data root',
    supportsCost: false,
  },
};

function pAll(items, fn, concurrency) {
  const results = [];
  const executing = [];
  let i = 0;

  const enqueue = async () => {
    if (i >= items.length) return;
    const item = items[i++];
    const p = Promise.resolve().then(() => fn(item));
    results.push(p);
    const e = p.then(() => executing.splice(executing.indexOf(e), 1));
    executing.push(e);
    if (executing.length >= concurrency) {
      await Promise.race(executing);
    }
    return enqueue();
  };

  return enqueue().then(() => Promise.all(results));
}

async function streamJsonlToStdout(session) {
  const stream = await fs.open(session.path, 'r');
  try {
    const reader = readline.createInterface({ input: stream.createReadStream(), crlfDelay: Infinity });
    for await (const line of reader) {
      process.stdout.write(`${line}\n`);
    }
  } finally {
    await stream.close();
  }
}

function emitCursorSessionJson(session) {
  const { _cursor, ...publicFields } = session;
  process.stdout.write(`${JSON.stringify(publicFields)}\n`);
}

function formatSummary(session) {
  return `${session.sessionId.slice(0, 8)} ${session.gitBranch ?? 'nobranch'} ${session.startedAt ?? ''} ${session.summary ?? ''}`;
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function fmtCost(usd) {
  if (!usd) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function dominantModel(tokensByModel) {
  const entries = Object.entries(tokensByModel || {});
  if (entries.length === 0) return '—';
  let best = entries[0];
  let bestSum = (best[1].input || 0) + (best[1].output || 0);
  for (const entry of entries.slice(1)) {
    const sum = (entry[1].input || 0) + (entry[1].output || 0);
    if (sum > bestSum) {
      best = entry;
      bestSum = sum;
    }
  }
  const resolved = resolveModel(best[0]);
  const label = resolved ? resolved.key : best[0];
  return entries.length > 1 ? `${label} (+${entries.length - 1})` : label;
}

function renderOutputOnly(matches) {
  const lines = ['# Session usage', ''];
  lines.push('| date | session | branch | model | input | output | cache R | cache W | cost |');
  lines.push('|---|---|---|---|---:|---:|---:|---:|---:|');

  const totals = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, cost: 0 };
  const unknown = new Set();

  for (const session of matches) {
    const tokens = session.tokens ?? { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
    const { cost, unknownModels } = costForSession(session.tokensByModel ?? {});
    for (const m of unknownModels) unknown.add(m);
    totals.input += tokens.input || 0;
    totals.output += tokens.output || 0;
    totals.cacheRead += tokens.cacheRead || 0;
    totals.cacheCreation += tokens.cacheCreation || 0;
    totals.cost += cost;
    const date = session.startedAt ? session.startedAt.slice(0, 10) : '';
    lines.push(
      `| ${date} | ${session.sessionId.slice(0, 8)} | ${session.gitBranch ?? ''} | ${dominantModel(session.tokensByModel)} | ${fmtNum(tokens.input)} | ${fmtNum(tokens.output)} | ${fmtNum(tokens.cacheRead)} | ${fmtNum(tokens.cacheCreation)} | ${fmtCost(cost)} |`,
    );
  }

  lines.push('', '## Totals', '');
  lines.push('| metric | value |');
  lines.push('|---|---:|');
  lines.push(`| sessions | ${fmtNum(matches.length)} |`);
  lines.push(`| input tokens | ${fmtNum(totals.input)} |`);
  lines.push(`| output tokens | ${fmtNum(totals.output)} |`);
  lines.push(`| cache read tokens | ${fmtNum(totals.cacheRead)} |`);
  lines.push(`| cache write tokens | ${fmtNum(totals.cacheCreation)} |`);
  lines.push(`| cost (USD) | ${fmtCost(totals.cost)} |`);

  return { text: lines.join('\n') + '\n', unknown: [...unknown] };
}

async function main() {
  const program = new Command();
  program
    .name('convoptics')
    .description('Extract Claude Code conversations by query and export Markdown transcripts.')
    .argument('[filters...]', 'filter tokens such as tool:claude-code branch:main date>=2026-05-01')
    .option('--root <path>', 'override ~/.claude/projects')
    .option('--out <dir>', 'override output directory')
    .option('--dry-run', 'list matches, do not write files')
    .option('--json', 'emit JSONL of matches to stdout instead of markdown files')
    .option('--output-only', 'print a token + cost summary table to stdout; do not write markdown files')
    .option('--limit <n>', 'stop after N matches', Number)
    .option('--full', 'do not truncate tool results')
    .option('-v, --verbose', 'show scan progress to stderr')
    .version('0.1.0');

  program.parse(process.argv);
  const filters = program.args;
  const opts = program.opts();

  let filterSpec;
  try {
    filterSpec = parseQuery(filters);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }

  const adapter = ADAPTERS[filterSpec.tool];
  if (!adapter) {
    console.error(`Error: no adapter registered for tool:${filterSpec.tool}`);
    process.exit(1);
  }

  if (opts.outputOnly && !adapter.supportsCost) {
    console.error(`Error: --output-only is not supported for tool:${filterSpec.tool} (token usage is not exported)`);
    process.exit(1);
  }

  const root = opts.root ? path.resolve(opts.root) : adapter.defaultRoot();
  try {
    const rootStat = await fs.stat(root);
    if (!rootStat.isDirectory()) {
      throw new Error('not a directory');
    }
  } catch {
    console.error(`Error: ${adapter.rootLabel} does not exist: ${root}`);
    process.exit(2);
  }

  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '');
  const outDir = opts.out
    ? path.resolve(opts.out)
    : path.join(os.homedir(), 'Downloads', `convos-${timestamp}`);
  const matches = [];
  let scanned = 0;

  for await (const session of adapter.scan(root)) {
    scanned += 1;
    if (opts.verbose) {
      console.error(`scanned ${session.path}`);
      if (session.malformedCount) {
        console.error(`  malformed lines: ${session.malformedCount}`);
      }
    }
    if (match(filterSpec, session)) {
      matches.push(session);
      if (opts.verbose) {
        console.error(`  matched ${session.sessionId}`);
      }
      if (opts.limit && matches.length >= opts.limit) break;
    }
  }

  if (opts.dryRun) {
    for (const session of matches) {
      process.stdout.write(`${session.sessionId} ${session.gitBranch ?? 'nobranch'} ${session.startedAt ?? ''} ${session.summary ?? ''}\n`);
    }
    console.error(`Found ${matches.length} matching sessions from ${scanned} scanned.`);
    process.exit(0);
  }

  if (opts.json) {
    for (const session of matches) {
      if (filterSpec.tool === 'cursor') {
        emitCursorSessionJson(session);
      } else {
        await streamJsonlToStdout(session);
      }
    }
    console.error(`Emitted JSONL for ${matches.length} matching sessions from ${scanned} scanned.`);
    process.exit(0);
  }

  if (opts.outputOnly) {
    const { text, unknown } = renderOutputOnly(matches);
    process.stdout.write(text);
    if (unknown.length) {
      console.error(`Warning: cost excludes ${unknown.length} unpriced model(s): ${unknown.join(', ')}`);
    }
    console.error(`Summarized ${matches.length} matching sessions from ${scanned} scanned.`);
    process.exit(0);
  }

  await fs.mkdir(outDir, { recursive: true });

  let exportResults;
  try {
    const exportOpts = { full: opts.full, noDiffs: filterSpec.diffs === 'no-diffs' };
    exportResults = await pAll(matches, (session) => adapter.exportSession(session, outDir, exportOpts), 8);
  } catch (error) {
    console.error(`Error exporting sessions: ${error.message}`);
    process.exit(3);
  }

  const indexLines = [
    '# Export index',
    '',
    '| filename | date | branch | summary |',
    '|---|---|---|---|',
    ...exportResults.map((result, index) => {
      const session = matches[index];
      return `| ${result.filename} | ${session.startedAt ? session.startedAt.slice(0, 10) : ''} | ${session.gitBranch ?? ''} | ${session.summary ?? ''} |`;
    }),
  ];
  await fs.writeFile(path.join(outDir, '_index.md'), indexLines.join('\n') + '\n', 'utf8');

  console.log(`Exported ${exportResults.length} of ${scanned} scanned sessions to ${outDir}`);
  process.exit(0);
}

main();
