import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';

export function defaultCursorRoot() {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Cursor', 'User');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'Cursor', 'User');
  }
  return path.join(home, '.config', 'Cursor', 'User');
}

function fileUriToPath(uri) {
  if (typeof uri !== 'string') return null;
  if (!uri.startsWith('file://')) return uri;
  try {
    const url = new URL(uri);
    let pathname = decodeURIComponent(url.pathname);
    if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(pathname)) {
      pathname = pathname.slice(1);
    }
    return pathname;
  } catch {
    return uri;
  }
}

function isoFromMs(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
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

async function buildRegistry(workspaceStorageDir) {
  const registry = new Map();
  let entries;
  try {
    entries = await fs.readdir(workspaceStorageDir, { withFileTypes: true });
  } catch {
    return registry;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const wsPath = path.join(workspaceStorageDir, entry.name);
    const wsJsonPath = path.join(wsPath, 'workspace.json');
    const wsDbPath = path.join(wsPath, 'state.vscdb');

    let folder = null;
    try {
      const raw = await fs.readFile(wsJsonPath, 'utf8');
      const wsJson = JSON.parse(raw);
      folder = fileUriToPath(wsJson.folder);
    } catch {
      // workspace.json missing or unreadable — leave folder null
    }

    let db;
    try {
      db = new Database(wsDbPath, { readonly: true, fileMustExist: true });
    } catch {
      continue;
    }

    try {
      const row = db
        .prepare('SELECT value FROM ItemTable WHERE key = ?')
        .get('composer.composerData');
      const data = parseJsonValue(row?.value);
      if (!data || !Array.isArray(data.allComposers)) continue;
      for (const c of data.allComposers) {
        if (!c || !c.composerId) continue;
        registry.set(c.composerId, {
          cwd: folder,
          branch: c.createdOnBranch ?? null,
          name: c.name ?? null,
          subtitle: c.subtitle ?? null,
          isArchived: !!c.isArchived,
        });
      }
    } finally {
      db.close();
    }
  }

  return registry;
}

export async function* scanSessions(root) {
  const globalDbPath = path.join(root, 'globalStorage', 'state.vscdb');
  const wsDir = path.join(root, 'workspaceStorage');

  try {
    await fs.access(globalDbPath);
  } catch {
    return;
  }

  const registry = await buildRegistry(wsDir);

  const gdb = new Database(globalDbPath, { readonly: true, fileMustExist: true });
  try {
    const composerStmt = gdb.prepare(
      "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'",
    );
    const countStmt = gdb.prepare(
      'SELECT COUNT(*) AS n FROM cursorDiskKV WHERE key LIKE ?',
    );

    for (const row of composerStmt.iterate()) {
      const composerId = row.key.slice('composerData:'.length);
      if (!composerId) continue;
      const header = parseJsonValue(row.value);
      if (!header) continue;

      const meta = registry.get(composerId) ?? {};
      const { n: bubbleCount } = countStmt.get(`bubbleId:${composerId}:%`);

      const conversationOrder = Array.isArray(header.conversation)
        ? header.conversation.map((c) => c?.bubbleId).filter(Boolean)
        : [];

      yield {
        path: globalDbPath,
        sessionId: composerId,
        projectFolder: meta.cwd ? path.basename(meta.cwd) : null,
        cwd: meta.cwd ?? null,
        gitBranch: meta.branch ?? null,
        version: null,
        startedAt: isoFromMs(header.createdAt),
        endedAt: isoFromMs(header.lastUpdatedAt),
        summary: meta.name ?? header.name ?? null,
        messageCount: bubbleCount ?? 0,
        malformedCount: 0,
        tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
        tokensByModel: {},
        _cursor: {
          dbPath: globalDbPath,
          composerId,
          isArchived: !!meta.isArchived,
          subtitle: meta.subtitle ?? null,
          conversationOrder,
        },
      };
    }
  } finally {
    gdb.close();
  }
}
