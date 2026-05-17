# chat-grabber

[![npm version](https://img.shields.io/npm/v/chat-grabber.svg)](https://www.npmjs.com/package/chat-grabber)
[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

A CLI for pulling Claude Code and Cursor chat history out of your machine and into clean Markdown transcripts you can grep, share, or feed back into an LLM.

---

## What it is

`chat-grabber` reads the local history that Claude Code and Cursor already keep on disk, filters it with a tiny `key:value` query language, and writes one Markdown file per matching session.

You point it at one of the two tools, narrow down with filters like `branch:` / `project:` / `date>=`, and it drops the matches into `~/Downloads/`.

## How it works

There are three moving parts:

```
scanner  →  matcher  →  exporter
(per-tool)              (per-tool)
```

The **scanner** walks the tool's on-disk history and yields lightweight session metadata. The **matcher** keeps the sessions your query asked for. The **exporter** re-reads each matching session and writes it as Markdown.

### Your first query

Grab every Claude Code session started on or after May 12th, 2026:

```bash
npx chat-grabber tool:claude-code date>=2026-05-12
```

That writes one Markdown file per session into a fresh `~/Downloads/chats-<timestamp>/` directory, plus an `_index.md` listing them.

> **Quote the `>=`.** Shells treat `>` as redirection, so wrap any token using `>`, `>=`, `<`, or `<=` in quotes: `'date>=2026-05-12'`. Tokens using `:` or `=` are safe unquoted.

---

## Install

Requires Node.js 18+.

```bash
# Run once without installing
npx chat-grabber --help

# Or install globally
npm install -g chat-grabber
chat-grabber --help
```

`better-sqlite3` (used to read Cursor) is a native module. `npm install` downloads a prebuilt binary for common platforms, or compiles from source (needs Python + a C++ toolchain) if no prebuilt is available.

> **macOS Downloads prompt.** The first time your terminal writes to `~/Downloads`, macOS asks "Terminal would like to access files in your Downloads folder." Click Allow once. Reading from `~/.claude/projects/` never triggers a prompt.

---

## Queryable properties

Every query is a series of `key:value` (or `key=value`) tokens. One `tool:` token is required; everything else narrows the result set.

| Key       | Operators                 | Claude Code | Cursor | What it matches |
|-----------|---------------------------|:-----------:|:------:|-----------------|
| `tool`    | `:` `=`                   | yes         | yes    | Required. `claude-code` or `cursor`. |
| `date`    | `:` `=` `>` `>=` `<` `<=` | yes         | yes    | ISO date (`YYYY-MM-DD`), compared against the session's `startedAt`. |
| `project` | `:` `=`                   | yes         | yes    | Exact match of the project folder basename (last segment of `cwd`, e.g. `projectA`). |
| `cwd`     | `:` `=`                   | yes         | yes    | Case-insensitive substring of the full working directory path. |
| `branch`  | `:` `=`                   | yes         | yes*   | Exact branch name or glob (`*` = one path segment, `**` = across `/`). Case-insensitive. <br>*Cursor records the branch at session creation only — later switches aren't tracked.* |
| `session` | `:` `=`                   | yes         | yes    | Session-id prefix match. |
| `version` | `:` `=`                   | yes         | —      | Exact Claude Code version string. Cursor doesn't record a per-session client version. |
| `diffs`   | `:` `=`                   | yes         | yes    | `diffs` (default) keeps file edits; `no-diffs` redacts edits to a placeholder so transcripts can be shared without leaking source. |

**Combining tokens.** Repeating the same key creates an OR (`branch:main branch:feature/*`). Different keys combine with AND.

---

## Building a query, step by step

Each step below adds one filter to the last. Use them in any order — they all combine with AND.

### 1. Pick a tool (required)

```bash
chat-grabber tool:claude-code
chat-grabber tool:cursor
```

With nothing else, you get every session the tool has on disk. That's usually too many — start adding filters.

### 2. Narrow by date

`date` is the most useful first filter. All six operators work:

```bash
# On exactly May 12th
chat-grabber tool:claude-code date:2026-05-12

# After May 12th (inclusive)
chat-grabber tool:claude-code 'date>=2026-05-12'

# Before May 12th (exclusive)
chat-grabber tool:claude-code 'date<2026-05-12'

# A two-week window
chat-grabber tool:claude-code 'date>=2026-05-01' 'date<=2026-05-14'
```

### 3. Add a project

`project:` matches the folder name your session ran in. If your repo lives at `~/code/projectA`, then `project:projectA` matches sessions started there:

```bash
chat-grabber tool:claude-code 'date>=2026-05-12' project:projectA
```

Need a looser match (e.g. anything under `~/code/`)? Use `cwd:`, which does a case-insensitive substring match on the full path:

```bash
chat-grabber tool:claude-code 'date>=2026-05-12' cwd:code/
```

### 4. Add a branch

```bash
chat-grabber tool:claude-code 'date>=2026-05-12' project:projectA branch:main
```

Globs work too. Quote them so the shell doesn't expand `*`:

```bash
# Any feature branch
chat-grabber tool:claude-code project:projectA 'branch:feature/*'

# Any nested branch under release/
chat-grabber tool:claude-code project:projectA 'branch:release/**'
```

### 5. Combine multiple values with OR

Repeating a key ORs the values. This grabs anything on `main` *or* any feature branch:

```bash
chat-grabber tool:claude-code project:projectA branch:main 'branch:feature/*'
```

### 6. Same workflow for Cursor

```bash
chat-grabber tool:cursor 'date>=2026-05-12' project:projectA
```

A few keys behave slightly differently for Cursor — see the [Queryable properties](#queryable-properties) table.

---

## Output

By default, output goes to `~/Downloads/chats-<timestamp>/`:

```
~/Downloads/chats-2026-05-14T143000/
  ├── 2026-05-12_a3f9c1d0_feature-payments.md
  ├── 2026-05-13_b7c2e840_feature-payments.md
  └── _index.md
```

Filenames are `<YYYY-MM-DD>_<sessionId[:8]>_<branch-slug>.md`. Branch slugs lowercase the branch and replace `/` with `-`.

Each Markdown file starts with quoted YAML frontmatter, followed by the conversation grouped by role:

```markdown
---
sessionId: "a1b2c3d4"
cwd: "/Users/bren/projectA"
gitBranch: "feature/payments"
version: "0.30.0"
startedAt: "2026-05-12T08:00:00Z"
endedAt: "2026-05-12T08:00:02Z"
summary: "payments-refactor"
tokensInput: 12345
tokensOutput: 6789
tokensCacheCreation: 1024
tokensCacheRead: 4096
---

## User

Please refactor the payment handler.

## Assistant

Sure, I will update the handler.
```

Tool calls render as fenced blocks:

````markdown
```tool:git
{ "command": "status" }
```

```result
All tests passed.
```
````

Tool results longer than 4 KB are truncated with a `… [N more chars truncated]` marker — pass `--full` to keep them. Sidechain messages get a `### sidechain` heading. Consecutive same-role messages share one heading.

`_index.md` is a table of every file in match order (filename, date, branch, summary).

---

## Options

| Flag                | Description                                              |
|---------------------|----------------------------------------------------------|
| `--out <dir>`       | Override the output directory. Default: `~/Downloads/chats-<timestamp>`. |
| `--root <path>`     | Override the tool's data root. Default for `tool:claude-code` is `~/.claude/projects`. For `tool:cursor`: `~/Library/Application Support/Cursor/User` (macOS), `~/.config/Cursor/User` (Linux), `%APPDATA%/Cursor/User` (Windows). |
| `--dry-run`         | List matches without writing files. |
| `--json`            | Emit raw session data to stdout instead of Markdown. Claude Code: original JSONL. Cursor: one JSON object per line. |
| `--limit <n>`       | Stop after N matches. |
| `--full`            | Don't truncate large tool results. |
| `--output-only`     | Print a Markdown token + cost summary table to stdout. Skips writing transcripts. **Claude Code only.** |
| `-v`, `--verbose`   | Show scan progress on stderr. |

---

## Advanced

### Redacting diffs before sharing

`diffs:no-diffs` replaces file-edit tool inputs (`Edit`, `MultiEdit`, `Write`, `NotebookEdit` for Claude Code; `editTrailContexts`, `fileDiffTrajectories`, `gitDiffs`, `humanChanges`, `diffsSinceLastApply`, `assistantSuggestedDiffs` for Cursor) with a one-line summary so you can share a transcript without leaking source code:

```bash
chat-grabber tool:claude-code session:a1b2 diffs:no-diffs
```

````markdown
```tool:Edit
[diff redacted: 4 lines added, 3 lines removed]
```
````

Other tool calls and results are unchanged. Token totals still appear in the frontmatter.

### Token and cost reports (`--output-only`)

> **Claude Code only.** Cursor's per-bubble `tokenCount` is `{0,0}` for ~96% of assistant bubbles, so cost reporting would be misleading and the flag is rejected with `tool:cursor`.

```bash
chat-grabber tool:claude-code 'date>=2026-05-12' --output-only
```

Skips writing Markdown and prints a Markdown report instead — one row per session, plus totals:

```text
# Session usage

| date | session | branch | model | input | output | cache R | cache W | cost |
|---|---|---|---|---:|---:|---:|---:|---:|
| 2026-05-12 | a1b2c3d4 | feature/payments | claude-opus-4-7 | 12,345 | 6,789 | 4,096 | 1,024 | $0.45 |
| 2026-05-13 | b7c2e840 | feature/payments | claude-sonnet-4-6 | 20,000 | 10,000 | 0 | 0 | $0.21 |

## Totals

| metric | value |
|---|---:|
| sessions | 2 |
| input tokens | 32,345 |
| ... | ... |
| cost (USD) | $0.66 |
```

The `model` column shows each session's *dominant* model — the one with the most input + output tokens — and appends `(+N)` if other models also appeared. Cost is computed per-model and summed.

Redirect to a file for sharing: `chat-grabber ... --output-only > usage.md`.

Rates live in [src/claude-code/pricing.js](src/claude-code/pricing.js) as USD per million tokens. Model resolution does a longest-prefix match, so dated variants like `claude-opus-4-7-20251022` map to the `claude-opus-4-7` row. Unknown models still report tokens but their cost is excluded and a stderr warning is printed.

### Piping raw data

```bash
# JSONL for Claude Code
chat-grabber tool:claude-code branch:working --json | jq '.message.role'
```

### Preview without writing

```bash
chat-grabber tool:claude-code branch:main --dry-run -v
```

---

## Architecture (for contributors)

Each tool has its own scanner + exporter under `src/<tool>/`. The CLI parses the query, picks the adapter based on `tool:`, and pipes sessions through a shared matcher into the adapter's exporter.

**Claude Code** writes one `.jsonl` file per session into `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`. The scanner streams those files line-by-line, extracting metadata only; the exporter re-streams them to render Markdown.

**Cursor** stores sessions across SQLite databases: a global `globalStorage/state.vscdb` holds session headers (`composerData:<uuid>`) and individual message bubbles (`bubbleId:<uuid>:<bubbleId>`); one `workspaceStorage/<hash>/state.vscdb` per workspace holds the registry that joins each composer to its `cwd` and `createdOnBranch`. The Cursor scanner reads workspace registries first to build that lookup, then walks the global DB; the exporter re-opens the global DB to load bubbles in conversation order. See [docs/cursor-schema.md](docs/cursor-schema.md) for the on-disk layout.

### Modules

- [src/cli.js](src/cli.js) — argv parsing, adapter dispatch, output. In-process concurrency limiter (`pAll`, default 8) for parallel export.
- [src/query.js](src/query.js) — `parseQuery(argv)` turns tokens into a structured filter spec. Repeated keys accumulate into arrays (OR). Validates keys, operators, the required `tool` filter, and per-tool-incompatible keys.
- [src/matcher.js](src/matcher.js) — `match(filter, session)` applies the spec. Tool-agnostic; operates on the common session shape every adapter yields. Branch globs compile to anchored, case-insensitive regexes: `*` → `[^/]*`, `**` → `.*`.
- [src/claude-code/scanner.js](src/claude-code/scanner.js) — async generator. Streams every `.jsonl` under `~/.claude/projects` with `readline`, extracting only metadata. Full message content is never buffered.
- [src/claude-code/exporter.js](src/claude-code/exporter.js) — for each match, re-streams the JSONL and writes Markdown. Writes go to `.tmp` first and are renamed atomically — an interrupted run never leaves partial exports.
- [src/claude-code/pricing.js](src/claude-code/pricing.js) — USD-per-million pricing table for `--output-only`.
- [src/cursor/scanner.js](src/cursor/scanner.js) — opens each `workspaceStorage/<hash>/state.vscdb` read-only with `better-sqlite3`, builds a `composerId → {cwd, branch, name}` registry, then streams `composerData:<uuid>` rows from the global DB. Token counts are emitted as zero.
- [src/cursor/exporter.js](src/cursor/exporter.js) — re-opens the global DB, loads `bubbleId:<sessionId>:*` rows, orders them by the header's `conversation[]` cache, renders each `type:1`/`type:2` bubble as Markdown. Same atomic `.tmp` → rename pattern. Warns to stderr if any bubble has `_v` ≠ 3.

### Adding a new tool adapter

Create `src/<tool>/scanner.js` (async generator yielding the common session shape) and `src/<tool>/exporter.js` (writes Markdown for one session). Register the adapter in the `ADAPTERS` map in [src/cli.js](src/cli.js), add the tool name to `VALID_TOOLS` in [src/query.js](src/query.js), and declare any per-tool incompatible filter keys in `TOOL_UNSUPPORTED_KEYS`. The matcher and query layers are tool-agnostic.

### From source

```bash
git clone https://github.com/brenoneill/chat-grabber.git && cd chat-grabber
npm install
npm link        # optional: exposes `chat-grabber` globally from your checkout
npm test
```

The test suite uses Node's built-in `node:test` runner against fixtures under [test/fixtures/projects/](test/fixtures/projects/).

### Errors and exit codes

| Code | Meaning |
|------|---------|
| `1`  | Invalid query token. |
| `2`  | Missing projects/data root. |
| `3`  | Export failure (partial `.tmp` is removed). |

Malformed JSONL lines are counted (`malformedCount`) and skipped; `--verbose` prints the per-file count.

### Project layout

```
bin/chat-grabber.js             # entry point shim
src/cli.js                      # argv → adapter dispatch
src/query.js                    # parseQuery
src/matcher.js                  # tool-agnostic match + glob compilation
src/claude-code/scanner.js      # walkJsonl + scanSessions (async generators)
src/claude-code/exporter.js     # exportSession + Markdown rendering
src/claude-code/pricing.js      # USD-per-million pricing for --output-only
src/cursor/scanner.js           # SQLite-backed scanSessions + defaultCursorRoot
src/cursor/exporter.js          # exportSession (bubble rendering)
docs/cursor-schema.md           # Cursor on-disk schema reference
test/                           # node:test suites + fixtures
.github/workflows/ci.yml        # Node 18 + 20 matrix
```

---

## License

MIT — see [LICENSE](LICENSE).
