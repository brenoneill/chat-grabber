import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

async function* walkJsonl(root) {
  const rootDir = await fs.opendir(root);
  for await (const entry of rootDir) {
    if (!entry.isDirectory()) continue;
    const projectDir = await fs.opendir(path.join(root, entry.name));
    for await (const file of projectDir) {
      if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;
      yield path.join(root, entry.name, file.name);
    }
  }
}

export async function* scanSessions(root) {
  for await (const filePath of walkJsonl(root)) {
    const fd = await fs.open(filePath, 'r');
    try {
      const stream = fd.createReadStream();
      const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
      let cwd = null;
      let gitBranch = null;
      let sessionId = null;
      let version = null;
      let startedAt = null;
      let endedAt = null;
      let summary = null;
      let messageCount = 0;
      let malformed = 0;
      const tokens = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
      const tokensByModel = {};

      for await (const line of lines) {
        if (!line.trim()) continue;

        let record;
        try {
          record = JSON.parse(line);
        } catch {
          malformed += 1;
          continue;
        }

        messageCount += 1;

        if (!startedAt && record.timestamp) startedAt = record.timestamp;
        if (cwd === null && record.cwd) cwd = record.cwd;
        if (gitBranch === null && record.gitBranch) gitBranch = record.gitBranch;
        if (sessionId === null && record.sessionId) sessionId = record.sessionId;
        if (version === null && record.version) version = record.version;
        if (summary === null && record.type === 'summary' && record.summary) {
          summary = record.summary;
        }

        if (record.timestamp) endedAt = record.timestamp;

        const usage = record.message && record.message.usage;
        if (usage) {
          const inp = usage.input_tokens ?? 0;
          const out = usage.output_tokens ?? 0;
          const cw = usage.cache_creation_input_tokens ?? 0;
          const cr = usage.cache_read_input_tokens ?? 0;
          tokens.input += inp;
          tokens.output += out;
          tokens.cacheCreation += cw;
          tokens.cacheRead += cr;
          const model = (record.message.model && String(record.message.model)) || 'unknown';
          if (!tokensByModel[model]) {
            tokensByModel[model] = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
          }
          tokensByModel[model].input += inp;
          tokensByModel[model].output += out;
          tokensByModel[model].cacheCreation += cw;
          tokensByModel[model].cacheRead += cr;
        }
      }

      const projectFolder = path.basename(path.dirname(filePath));
      yield {
        path: filePath,
        sessionId: sessionId || path.basename(filePath, '.jsonl'),
        projectFolder,
        cwd,
        gitBranch,
        version,
        startedAt,
        endedAt,
        summary,
        messageCount,
        malformedCount: malformed,
        tokens,
        tokensByModel,
      };
    } finally {
      await fd.close();
    }
  }
}
