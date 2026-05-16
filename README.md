# convoptics

[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Convoptics scans your local Claude Code and Cursor history, filters sessions
with a small `key:value` query language, and exports the matches as clean
Markdown transcripts.

## Quick start

```bash
# Run directly from the repo
node bin/convoptics.js tool:claude-code branch:feature/payments
node bin/convoptics.js tool:cursor branch:feature/payments

# Or link it once and use the global command
npm link
convoptics tool:claude-code branch:feature/payments
convoptics tool:cursor cwd:projectA
```

Output (defaults to your Downloads folder):

```text
~/Downloads/convos-2026-05-14T143000/
  ├── 2026-05-12_a3f9c1d0_feature-payments.md
  ├── 2026-05-13_b7c2e840_feature-payments.md
  └── _index.md
```

> On macOS, the first time your terminal app writes to `~/Downloads` the OS
> shows a one-time prompt ("Terminal would like to access files in your
> Downloads folder"). Click Allow once; it won't ask again. Linux and Windows
> don't prompt. Reading from `~/.claude/projects/` never triggers a prompt.

## Installation

Requires Node.js 18 or newer.

```bash
git clone <repo> && cd convoptics
npm install
npm link        # optional: exposes `convoptics` globally
```

Runtime dependencies:
- [`commander`](https://www.npmjs.com/package/commander) for argv parsing.
- [`better-sqlite3`](https://www.npmjs.com/package/better-sqlite3) to read
  Cursor's SQLite databases. This is a native module; `npm install` will
  download a prebuilt binary for common platforms or compile from source if
  needed (which requires Python + a C++ toolchain).

## Usage

```bash
convoptics [filters...] [options]
```

A `tool:` filter is required; everything else is optional.

### Filters

| Key       | Operator(s)            | Meaning                                                                 |
|-----------|------------------------|-------------------------------------------------------------------------|
| `tool`    | `:` `=`                | Required. One of `claude-code` or `cursor`.                             |
| `branch`  | `:` `=`                | Exact branch name or glob (`*` matches one path segment, `**` matches across `/`). Case-insensitive. For Cursor this is the branch when the session was created; it does not track later branch switches. |
| `cwd`     | `:` `=`                | Case-insensitive substring of the session's working directory.          |
| `project` | `:` `=`                | Exact project folder match. **Claude Code:** the encoded directory under `~/.claude/projects` (e.g. `-Users-bren-projectA`). **Cursor:** the basename of the workspace folder (e.g. `projectA`). |
| `session` | `:` `=`                | Session-id prefix match.                                                |
| `version` | `:` `=`                | Exact Claude Code version string. Not supported for `tool:cursor` (no per-session client version is recorded). |
| `date`    | `:` `=` `>` `>=` `<` `<=` | ISO date (`YYYY-MM-DD`). Comparisons use the session's `startedAt`.  |
| `diffs`   | `:` `=`                | `diffs` (default) keeps full file-edit content; `no-diffs` redacts file edits to a placeholder so transcripts can be shared without leaking source. For Claude Code this targets `Edit`/`MultiEdit`/`Write`/`NotebookEdit` tool inputs; for Cursor it targets the per-bubble `editTrailContexts`, `fileDiffTrajectories`, `gitDiffs`, `humanChanges`, `diffsSinceLastApply`, and `assistantSuggestedDiffs` fields. |

Repeating a key creates an OR: `branch:main branch:feature/*` matches sessions on
either branch. Different keys combine with AND.

### Options

| Flag                | Description                                              |
|---------------------|----------------------------------------------------------|
| `--root <path>`     | Override the tool's data root. Default for `tool:claude-code` is `~/.claude/projects`. Default for `tool:cursor` is `~/Library/Application Support/Cursor/User` on macOS, `~/.config/Cursor/User` on Linux, `%APPDATA%/Cursor/User` on Windows. |
| `--out <dir>`       | Override the output directory (default: `~/Downloads/convos-<timestamp>`). |
| `--dry-run`         | List matches without writing files.                      |
| `--json`            | Emit raw session data to stdout instead of Markdown. For Claude Code, the original JSONL; for Cursor, one JSON object per line with session metadata. |
| `--limit <n>`       | Stop after N matches.                                    |
| `--full`            | Do not truncate large tool results in the Markdown output. |
| `--output-only`     | Print a Markdown token + cost summary table to stdout. Skips writing transcripts. **Claude Code only** — Cursor sessions do not record reliable token counts, so this flag is rejected with `tool:cursor`. |
| `-v`, `--verbose`   | Show scan progress on stderr.                            |

### Examples

```bash
# Everything on `working` in the last 2 days (today = 2026-05-14)
convoptics tool:claude-code branch:working date>=2026-05-12

# All feature branches, a single day
convoptics tool:claude-code 'branch:feature/*' date:2026-05-12

# A specific session prefix, full tool output, custom out dir
convoptics tool:claude-code session:a1b2 --full --out ./payments-debug

# Preview without writing anything
convoptics tool:claude-code branch:main --dry-run -v

# Pipe raw JSONL to another tool
convoptics tool:claude-code branch:working --json | jq '.message.role'

# Share a session externally without exposing source code
convoptics tool:claude-code session:a1b2 diffs:no-diffs

# Just see how many tokens / how much money a query covers (no files written)
convoptics tool:claude-code branch:working date>=2026-05-12 --output-only

# All Cursor sessions for a project, with secrets in edits redacted
convoptics tool:cursor cwd:projectA diffs:no-diffs
```

> **Shell quoting.** Quote glob patterns (`'branch:feature/*'`) so the shell
> does not expand `*`. Quote any token using `>`, `>=`, `<`, or `<=` (e.g.
> `'date>=2026-05-12'`) — otherwise zsh/bash treat it as an output redirection.
> Tokens using `:` or `=` are safe unquoted.

## How it works

Each tool has its own scanner + exporter under `src/<tool>/`. The CLI parses
the query, picks the adapter based on `tool:`, and pipes sessions through a
shared matcher into the adapter's exporter.

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ scanner  │ -> │  query   │ -> │ matcher  │ -> │ exporter │
│ (per     │    │          │    │          │    │ (per     │
│  tool)   │    │ parse    │    │ filter   │    │  tool)   │
└──────────┘    │ argv     │    │ spec     │    └──────────┘
                │ into     │    │ applied  │       per-session
                │ a spec   │    │ to each  │       Markdown +
                └──────────┘    │ session  │       index
                                └──────────┘
```

**Claude Code** writes one `.jsonl` file per session into
`~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`. The Claude Code scanner
streams those files line-by-line, extracting metadata only; the exporter
re-streams them to render Markdown.

**Cursor** stores sessions across SQLite databases: a global
`globalStorage/state.vscdb` holds session headers (`composerData:<uuid>`) and
individual message bubbles (`bubbleId:<uuid>:<bubbleId>`), and one
`workspaceStorage/<hash>/state.vscdb` per workspace holds the registry that
joins each composer to its `cwd` (via the sibling `workspace.json`) and
`createdOnBranch`. The Cursor scanner reads the workspace registries first to
build that lookup, then walks the global DB; the exporter re-opens the global
DB to load bubbles in conversation order. See
[docs/cursor-schema.md](docs/cursor-schema.md) for the on-disk layout this
adapter is pinned against.

### Modules

- [src/cli.js](src/cli.js) — argv parsing, adapter dispatch, output. Uses a
  small in-process concurrency limiter (`pAll`, default 8) to export sessions
  in parallel.
- [src/query.js](src/query.js) — `parseQuery(argv)` turns tokens like
  `branch:main` and `date>=2026-05-01` into a structured filter spec. Repeated
  keys accumulate into arrays (OR). Validates keys, operators, the required
  `tool` filter, and rejects per-tool-incompatible keys.
- [src/matcher.js](src/matcher.js) — `match(filter, session)` applies the spec.
  Tool-agnostic: operates on the common session shape that every adapter
  yields. Branch globs are compiled to anchored, case-insensitive regexes:
  `*` becomes `[^/]*`, `**` becomes `.*`, and regex metacharacters in the rest
  of the pattern are escaped.
- [src/claude-code/scanner.js](src/claude-code/scanner.js) — async generator.
  Streams every `.jsonl` under `~/.claude/projects` with `readline`, extracting
  only metadata (`sessionId`, `cwd`, `gitBranch`, `version`, `startedAt`,
  `endedAt`, `summary`, `messageCount`, `malformedCount`, plus per-model token
  usage). Full message content is never buffered.
- [src/claude-code/exporter.js](src/claude-code/exporter.js) — for each match,
  re-streams the JSONL and writes a Markdown transcript. Writes go to a `.tmp`
  file first and are renamed atomically on success, so an interrupted run
  never leaves partial exports.
- [src/claude-code/pricing.js](src/claude-code/pricing.js) — USD-per-million
  pricing table for `--output-only` (Claude Code only).
- [src/cursor/scanner.js](src/cursor/scanner.js) — opens each
  `workspaceStorage/<hash>/state.vscdb` read-only with `better-sqlite3`, builds
  a `composerId → {cwd, branch, name}` registry, then streams
  `composerData:<uuid>` rows from the global DB. Token counts are emitted as
  zero — Cursor's per-bubble `tokenCount` is unreliable (~96% report zero).
- [src/cursor/exporter.js](src/cursor/exporter.js) — re-opens the global DB,
  loads `bubbleId:<sessionId>:*` rows for the session, orders them by the
  header's `conversation[]` cache (with leftover bubbles appended), and
  renders each `type:1`/`type:2` bubble as Markdown. Same atomic
  `.tmp` → rename pattern as the Claude Code exporter. Warns to stderr if any
  bubble has an unexpected schema version (`_v` ≠ 3).

### Filename scheme

Each export is named `<YYYY-MM-DD>_<sessionId[:8]>_<branch-slug>.md`.
Branch slugs lowercase the branch and replace `/` with `-`. If the same name
already exists, a numeric suffix (`_2`, `_3`, …) is appended.

### Output format

Each Markdown file starts with quoted YAML frontmatter, followed by the
conversation grouped by role:

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

Token counts are summed across every assistant turn that reports a `usage`
block in the source JSONL.

### Token usage and cost (`--output-only`)

> **Claude Code only.** Cursor stores per-bubble `tokenCount` values that are
> `{0,0}` for ~96% of assistant bubbles, so cost reporting would be misleading.
> The flag is rejected with `tool:cursor` until this changes upstream.

`--output-only` skips writing Markdown and instead prints a Markdown report to
stdout: one row per matching session, followed by a totals table.

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

The `model` column shows each session's *dominant* model — the one with the
most input + output tokens — and appends `(+N)` if other models also appeared
in that session. Cost is computed per-model and summed.

Redirect to a file for sharing: `convoptics ... --output-only > usage.md`.

#### Pricing table

Rates live in [src/pricing.js](src/pricing.js) as USD per million tokens.
Model resolution does a longest-prefix match, so dated variants like
`claude-opus-4-7-20251022` map to the `claude-opus-4-7` row. If a session's
model isn't in the table, its tokens are still reported but its cost is
excluded and a warning is printed to stderr. Add new models by appending to
the `PRICING` object.

### Redacting diffs

Use `diffs:no-diffs` to share a transcript without leaking the source you
edited. File-edit tool calls (`Edit`, `MultiEdit`, `Write`, `NotebookEdit`)
have their inputs replaced by a one-line summary:

````markdown
```tool:Edit
[diff redacted: 4 lines added, 3 lines removed]
```
````

Other tool calls and their results are unchanged. Token totals in the
frontmatter are still emitted.

Tool use and tool results render as fenced blocks:

````markdown
```tool:git
{
  "command": "status"
}
```

```result
All tests passed.
```
````

Sidechain messages are prefixed with a `### sidechain` heading. Consecutive
messages from the same role share a single role heading.

### Truncation

Tool results longer than 4 KB are truncated with a trailing
`… [N more chars truncated]` marker. Pass `--full` to disable this.

### Index file

Every run also writes `_index.md` with a table of `filename | date | branch |
summary` rows in match order.

### Errors and resilience

- Missing projects root → exit code `2` with a clear message.
- Export failure → exit code `3`; the partial `.tmp` file is removed.
- Invalid query tokens → exit code `1` with the offending token in the message.
- Malformed JSONL lines are counted (`malformedCount`) and skipped; `--verbose`
  prints the per-file count.

## Project layout

```
bin/convoptics.js               # entry point shim
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

## Running the tests

```bash
npm test
```

The suite uses Node's built-in `node:test` runner against fixtures under
[test/fixtures/projects/](test/fixtures/projects/).

## Adding support for other tools

The `tool:` key dispatches to an adapter under `src/<tool>/`. Each adapter
ships its own `scanner.js` (an async generator yielding the common session
shape — see the Modules section) and `exporter.js` (writing Markdown for one
session into the output directory). Register the adapter in the `ADAPTERS`
map in [src/cli.js](src/cli.js), add the tool name to `VALID_TOOLS` in
[src/query.js](src/query.js), and declare any per-tool incompatible filter
keys in `TOOL_UNSUPPORTED_KEYS`. The matcher and query layers are
tool-agnostic and don't need changes.

Two adapters ship today: `claude-code` (JSONL files under `~/.claude/projects`)
and `cursor` (SQLite databases under Cursor's user-data directory).

## License

MIT — see [LICENSE](LICENSE).
