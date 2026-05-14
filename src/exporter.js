import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

const MAX_TOOL_RESULT = 4096;

function slugifyBranch(branch) {
  if (!branch) return 'nobranch';
  return branch
    .replace(/\//g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-');
}

function asString(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function truncateIfNeeded(text, full) {
  if (full || text.length <= MAX_TOOL_RESULT) return text;
  const truncated = text.slice(0, MAX_TOOL_RESULT);
  const remaining = text.length - MAX_TOOL_RESULT;
  return `${truncated}… [${remaining} more chars truncated]`;
}

function countLines(value) {
  if (value === null || value === undefined || value === '') return 0;
  return String(value).split('\n').length;
}

function diffStatsForToolUse(block) {
  const name = block.name || block.toolName || block.tool?.name || '';
  const input = block.input ?? block.args ?? {};
  if (!input || typeof input !== 'object') return null;
  if (name === 'Edit') {
    return { added: countLines(input.new_string), removed: countLines(input.old_string) };
  }
  if (name === 'MultiEdit' && Array.isArray(input.edits)) {
    let added = 0;
    let removed = 0;
    for (const edit of input.edits) {
      added += countLines(edit?.new_string);
      removed += countLines(edit?.old_string);
    }
    return { added, removed };
  }
  if (name === 'Write') {
    return { added: countLines(input.content), removed: 0 };
  }
  if (name === 'NotebookEdit') {
    return { added: countLines(input.new_source), removed: countLines(input.old_source) };
  }
  return null;
}

function renderBlock(block, opts) {
  if (typeof block === 'string') {
    return block;
  }

  if (block.type === 'text') {
    return block.text || '';
  }

  if (block.type === 'tool_use') {
    const name = block.name || block.toolName || block.tool?.name || 'unknown';
    if (opts.noDiffs) {
      const stats = diffStatsForToolUse(block);
      if (stats) {
        const body = `[diff redacted: ${stats.added} lines added, ${stats.removed} lines removed]`;
        return ['', '```tool:' + name, body, '```', ''].join('\n');
      }
    }
    const input = asString(block.input ?? block.args ?? block.payload ?? block.content ?? '');
    return ['','```tool:' + name, input, '```', ''].join('\n');
  }

  if (block.type === 'tool_result') {
    let output = block.output ?? block.result ?? block.text ?? block.content ?? '';
    output = asString(output);
    output = truncateIfNeeded(output, opts.full);
    return ['','```result', output, '```', ''].join('\n');
  }

  return asString(block.text ?? block.content ?? block);
}

function renderMessage(message, opts) {
  const lines = [];
  if (message.isSidechain) {
    lines.push('### sidechain', '');
  }

  const content = message.content;
  if (typeof content === 'string') {
    lines.push(content);
  } else if (Array.isArray(content)) {
    for (const block of content) {
      lines.push(renderBlock(block, opts));
    }
  } else {
    lines.push(asString(content));
  }

  return lines.join('\n').trim() + '\n';
}

async function resolveFilename(session, outDir) {
  const date = session.startedAt ? session.startedAt.slice(0, 10) : 'unknown-date';
  const prefix = session.sessionId.slice(0, 8);
  const branchSlug = slugifyBranch(session.gitBranch);
  const base = `${date}_${prefix}_${branchSlug}`;
  let candidate = `${base}.md`;
  let suffix = 1;
  while (true) {
    const fullPath = path.join(outDir, candidate);
    try {
      await fs.access(fullPath);
      suffix += 1;
      candidate = `${base}_${suffix}.md`;
      continue;
    } catch {
      return candidate;
    }
  }
}

function yamlQuote(value) {
  if (value === null || value === undefined) return '""';
  const str = String(value);
  return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export async function exportSession(session, outDir, opts = {}) {
  const filename = await resolveFilename(session, outDir);
  const tempPath = path.join(outDir, `${filename}.tmp`);
  const finalPath = path.join(outDir, filename);
  const stream = await fs.open(tempPath, 'w');
  let readStream = null;
  let succeeded = false;
  try {
    const tokens = session.tokens ?? { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
    const frontmatter = [
      '---',
      `sessionId: ${yamlQuote(session.sessionId)}`,
      `cwd: ${yamlQuote(session.cwd ?? '')}`,
      `gitBranch: ${yamlQuote(session.gitBranch ?? '')}`,
      `version: ${yamlQuote(session.version ?? '')}`,
      `startedAt: ${yamlQuote(session.startedAt ?? '')}`,
      `endedAt: ${yamlQuote(session.endedAt ?? '')}`,
      `summary: ${yamlQuote(session.summary ?? '')}`,
      `tokensInput: ${tokens.input ?? 0}`,
      `tokensOutput: ${tokens.output ?? 0}`,
      `tokensCacheCreation: ${tokens.cacheCreation ?? 0}`,
      `tokensCacheRead: ${tokens.cacheRead ?? 0}`,
      '---',
      '',
    ].join('\n');
    await stream.write(frontmatter);

    readStream = await fs.open(session.path, 'r');
    const lines = readline.createInterface({ input: readStream.createReadStream(), crlfDelay: Infinity });
    let lastRole = null;

    for await (const line of lines) {
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (!record.message || !record.message.role) continue;
      const role = record.message.role;
      const heading = role === 'user' ? '## User' : role === 'assistant' ? '## Assistant' : `## ${role}`;
      if (heading !== lastRole) {
        await stream.write(`${heading}\n\n`);
        lastRole = heading;
      }
      await stream.write(renderMessage(record.message, opts));
      await stream.write('\n');
    }

    succeeded = true;
  } finally {
    if (readStream) await readStream.close().catch(() => {});
    await stream.close().catch(() => {});
    if (!succeeded) await fs.unlink(tempPath).catch(() => {});
  }

  await fs.rename(tempPath, finalPath);
  const { size: bytes } = await fs.stat(finalPath);
  return { filename, bytes };
}
