import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';

function createDb(dbPath) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ItemTable    (key TEXT UNIQUE, value BLOB);
    CREATE TABLE IF NOT EXISTS cursorDiskKV (key TEXT UNIQUE, value BLOB);
  `);
  return db;
}

function jsonBlob(value) {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

/**
 * @param {string} root the cursor user-data root to populate
 * @param {object} spec { workspaces: [{ folder, composers: [...] }], composers: { [id]: { header, bubbles } }, orphans: { [id]: { header, bubbles } } }
 */
export async function buildCursorRoot(root, spec) {
  await fs.mkdir(path.join(root, 'globalStorage'), { recursive: true });
  const wsRoot = path.join(root, 'workspaceStorage');
  await fs.mkdir(wsRoot, { recursive: true });

  const composerEntries = new Map(); // composerId -> { header, bubbles }
  for (const [id, body] of Object.entries(spec.composers ?? {})) {
    composerEntries.set(id, body);
  }
  for (const [id, body] of Object.entries(spec.orphans ?? {})) {
    composerEntries.set(id, body);
  }

  for (let i = 0; i < (spec.workspaces ?? []).length; i++) {
    const ws = spec.workspaces[i];
    const hash = ws.hash || `ws${String(i).padStart(8, '0')}`;
    const wsDir = path.join(wsRoot, hash);
    await fs.mkdir(wsDir, { recursive: true });
    if (ws.folder) {
      await fs.writeFile(
        path.join(wsDir, 'workspace.json'),
        JSON.stringify({ folder: `file://${ws.folder}` }),
        'utf8',
      );
    }
    const wsDb = createDb(path.join(wsDir, 'state.vscdb'));
    try {
      const registryValue = {
        allComposers: (ws.composers ?? []).map((c) => ({
          composerId: c.composerId,
          type: 'head',
          name: c.name ?? null,
          subtitle: c.subtitle ?? null,
          createdAt: c.createdAt ?? Date.now(),
          lastUpdatedAt: c.lastUpdatedAt ?? Date.now(),
          createdOnBranch: c.branch ?? null,
          isArchived: !!c.isArchived,
        })),
        selectedComposerIds: [],
        lastFocusedComposerIds: [],
      };
      wsDb.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)').run(
        'composer.composerData',
        jsonBlob(registryValue),
      );
    } finally {
      wsDb.close();
    }
  }

  const globalDb = createDb(path.join(root, 'globalStorage', 'state.vscdb'));
  try {
    const insert = globalDb.prepare(
      'INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)',
    );
    for (const [id, body] of composerEntries) {
      insert.run(`composerData:${id}`, jsonBlob(body.header));
      for (const bubble of body.bubbles ?? []) {
        const bubbleId = bubble.bubbleId;
        if (!bubbleId) throw new Error('bubble must have bubbleId');
        insert.run(`bubbleId:${id}:${bubbleId}`, jsonBlob(bubble));
      }
    }
  } finally {
    globalDb.close();
  }
}
