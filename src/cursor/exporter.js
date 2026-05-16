import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';

const MAX_TOOL_RESULT = 4096;
const EXPECTED_SCHEMA_VERSION = 3;
const DIFF_FIELDS = [
  'editTrailContexts',
  'fileDiffTrajectories',
  'gitDiffs',
  'humanChanges',
  'diffsSinceLastApply',
  'assistantSuggestedDiffs',
];

function slugifyBranch(branch) {
  if (!branch) return 'nobranch';
  return branch
    .replace(/\//g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-');
}

function yamlQuote(value) {
  if (value === null || value === undefined) return '""';
  const str = String(value);
  return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function truncateIfNeeded(text, full) {
  if (full || text.length <= MAX_TOOL_RESULT) return text;
  const truncated = text.slice(0, MAX_TOOL_RESULT);
  const remaining = text.length - MAX_TOOL_RESULT;
  return `${truncated}… [${remaining} more chars truncated]`;
}

function asJsonBlock(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseJsonValue(value) {
  if (value === null || value === undefined) return null;
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function fenced(lang, body) {
  return ['', '```' + lang, body, '```', ''].join('\n');
}

function roleForBubble(bubble) {
  if (bubble.type === 1) return 'user';
  if (bubble.type === 2) return 'assistant';
  return null;
}

function collectThinking(bubble) {
  const parts = [];
  if (typeof bubble.thinking === 'string' && bubble.thinking.trim()) {
    parts.push(bubble.thinking);
  } else if (bubble.thinking && typeof bubble.thinking === 'object') {
    parts.push(asJsonBlock(bubble.thinking));
  }
  if (Array.isArray(bubble.allThinkingBlocks)) {
    for (const block of bubble.allThinkingBlocks) {
      if (typeof block === 'string') parts.push(block);
      else if (block && typeof block.text === 'string') parts.push(block.text);
      else if (block) parts.push(asJsonBlock(block));
    }
  }
  return parts.join('\n\n').trim();
}

function hasContent(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some(hasContent);
  if (typeof value === 'object') return Object.values(value).some(hasContent);
  if (typeof value === 'string') return value.length > 0;
  return true;
}

function hasAnyDiffField(bubble) {
  return DIFF_FIELDS.some((field) => hasContent(bubble[field]));
}

function renderBubble(bubble, opts) {
  const out = [];
  const text = typeof bubble.text === 'string' ? bubble.text.trim() : '';
  if (text) out.push(text);

  const thinking = collectThinking(bubble);
  if (thinking) out.push(fenced('thinking', thinking));

  const hasCapabilityPayload =
    hasContent(bubble.capabilities) ||
    hasContent(bubble.capabilityContexts) ||
    hasContent(bubble.capabilityStatuses);
  if (hasCapabilityPayload) {
    const capabilityName =
      (Array.isArray(bubble.capabilities) && bubble.capabilities[0]?.name) ||
      bubble.capabilityType ||
      'capability';
    const payload = {};
    if (bubble.capabilityType !== undefined) payload.capabilityType = bubble.capabilityType;
    if (hasContent(bubble.capabilities)) payload.capabilities = bubble.capabilities;
    if (hasContent(bubble.capabilityContexts)) payload.capabilityContexts = bubble.capabilityContexts;
    if (hasContent(bubble.capabilityStatuses)) payload.capabilityStatuses = bubble.capabilityStatuses;
    out.push(fenced(`tool:${capabilityName}`, asJsonBlock(payload)));
  }

  if (Array.isArray(bubble.toolResults) && bubble.toolResults.length > 0) {
    const body = truncateIfNeeded(asJsonBlock(bubble.toolResults), opts.full);
    out.push(fenced('result', body));
  }

  if (hasAnyDiffField(bubble)) {
    if (opts.noDiffs) {
      out.push(fenced('diff', '[diffs redacted]'));
    } else {
      const payload = {};
      for (const field of DIFF_FIELDS) {
        if (bubble[field] !== undefined && bubble[field] !== null) {
          payload[field] = bubble[field];
        }
      }
      const body = truncateIfNeeded(asJsonBlock(payload), opts.full);
      out.push(fenced('diff', body));
    }
  }

  return out.join('\n').trim();
}

async function resolveFilename(session, outDir) {
  const date = session.startedAt ? session.startedAt.slice(0, 10) : 'unknown-date';
  const prefix = session.sessionId.slice(0, 8);
  const branchSlug = slugifyBranch(session.gitBranch);
  const base = `${date}_${prefix}_${branchSlug}`;
  let candidate = `${base}.md`;
  let suffix = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const fullPath = path.join(outDir, candidate);
    try {
      await fs.access(fullPath);
      suffix += 1;
      candidate = `${base}_${suffix}.md`;
    } catch {
      return candidate;
    }
  }
}

function loadBubbles(dbPath, composerId) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db
      .prepare('SELECT key, value FROM cursorDiskKV WHERE key LIKE ? ORDER BY key')
      .all(`bubbleId:${composerId}:%`);
    const byId = new Map();
    for (const row of rows) {
      const bubble = parseJsonValue(row.value);
      if (!bubble) continue;
      const id = bubble.bubbleId || row.key.slice(`bubbleId:${composerId}:`.length);
      byId.set(id, bubble);
    }
    return byId;
  } finally {
    db.close();
  }
}

export async function exportSession(session, outDir, opts = {}) {
  const cursor = session._cursor;
  if (!cursor || !cursor.dbPath) {
    throw new Error('cursor exporter requires session._cursor.dbPath');
  }

  const filename = await resolveFilename(session, outDir);
  const tempPath = path.join(outDir, `${filename}.tmp`);
  const finalPath = path.join(outDir, filename);
  const stream = await fs.open(tempPath, 'w');
  let succeeded = false;

  try {
    const frontmatter = [
      '---',
      `sessionId: ${yamlQuote(session.sessionId)}`,
      `cwd: ${yamlQuote(session.cwd ?? '')}`,
      `gitBranch: ${yamlQuote(session.gitBranch ?? '')}`,
      `version: ${yamlQuote(session.version ?? '')}`,
      `startedAt: ${yamlQuote(session.startedAt ?? '')}`,
      `endedAt: ${yamlQuote(session.endedAt ?? '')}`,
      `summary: ${yamlQuote(session.summary ?? '')}`,
      'tokensInput: 0',
      'tokensOutput: 0',
      'tokensCacheCreation: 0',
      'tokensCacheRead: 0',
      '---',
      '',
    ].join('\n');
    await stream.write(frontmatter);

    const bubbles = loadBubbles(cursor.dbPath, cursor.composerId);
    const orderedIds = [...(cursor.conversationOrder ?? [])];
    const seen = new Set();
    const orderedBubbles = [];
    for (const id of orderedIds) {
      if (seen.has(id)) continue;
      const bubble = bubbles.get(id);
      if (!bubble) continue;
      seen.add(id);
      orderedBubbles.push(bubble);
    }
    for (const [id, bubble] of bubbles) {
      if (seen.has(id)) continue;
      orderedBubbles.push(bubble);
    }

    const schemaWarnings = new Set();
    let lastRole = null;
    for (const bubble of orderedBubbles) {
      if (typeof bubble._v === 'number' && bubble._v !== EXPECTED_SCHEMA_VERSION) {
        schemaWarnings.add(bubble._v);
      }
      const role = roleForBubble(bubble);
      if (!role) continue;
      const body = renderBubble(bubble, opts);
      if (!body) continue;

      const heading = role === 'user' ? '## User' : '## Assistant';
      if (heading !== lastRole) {
        await stream.write(`${heading}\n\n`);
        lastRole = heading;
      }
      await stream.write(`${body}\n\n`);
    }

    if (schemaWarnings.size > 0) {
      const versions = [...schemaWarnings].join(', ');
      process.stderr.write(
        `Warning: cursor session ${session.sessionId} contains bubbles with unexpected _v values: ${versions}\n`,
      );
    }

    succeeded = true;
  } finally {
    await stream.close().catch(() => {});
    if (!succeeded) await fs.unlink(tempPath).catch(() => {});
  }

  await fs.rename(tempPath, finalPath);
  const { size: bytes } = await fs.stat(finalPath);
  return { filename, bytes };
}
