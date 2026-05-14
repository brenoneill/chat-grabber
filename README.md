# convoptics

[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Convoptics scans your local Claude Code history, filters sessions with a small
`key:value` query language, and exports the matches as clean Markdown
transcripts.

## Quick start

```bash
# Run directly from the repo
node bin/convoptics.js tool:claude-code branch:feature/payments

# Or link it once and use the global command
npm link
convoptics tool:claude-code branch:feature/payments
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

There is one runtime dependency: [`commander`](https://www.npmjs.com/package/commander).

## Usage

```bash
convoptics [filters...] [options]
```

A `tool:` filter is required; everything else is optional.

### Filters

| Key       | Operator(s)            | Meaning                                                                 |
|-----------|------------------------|-------------------------------------------------------------------------|
| `tool`    | `:` `=`                | Required. Currently only `claude-code`.                                 |
| `branch`  | `:` `=`                | Exact branch name or glob (`*` matches one path segment, `**` matches across `/`). Case-insensitive. |
| `cwd`     | `:` `=`                | Case-insensitive substring of the session's working directory.          |
| `project` | `:` `=`                | Exact project folder name (the encoded directory under `~/.claude/projects`). |
| `session` | `:` `=`                | Session-id prefix match.                                                |
| `version` | `:` `=`                | Exact Claude Code version string.                                       |
| `date`    | `:` `=` `>` `>=` `<` `<=` | ISO date (`YYYY-MM-DD`). Comparisons use the session's `startedAt`.  |
| `diffs`   | `:` `=`                | `diffs` (default) keeps full file-edit content; `no-diffs` redacts `Edit`, `MultiEdit`, `Write`, and `NotebookEdit` inputs to a line-count summary so transcripts can be shared without leaking source. |

Repeating a key creates an OR: `branch:main branch:feature/*` matches sessions on
either branch. Different keys combine with AND.

### Options

| Flag                | Description                                              |
|---------------------|----------------------------------------------------------|
| `--root <path>`     | Override the Claude Code projects root (default `~/.claude/projects`). |
| `--out <dir>`       | Override the output directory (default: `~/Downloads/convos-<timestamp>`). |
| `--dry-run`         | List matches without writing files.                      |
| `--json`            | Emit raw JSONL of matching sessions to stdout instead of Markdown. |
| `--limit <n>`       | Stop after N matches.                                    |
| `--full`            | Do not truncate large tool results in the Markdown output. |
| `--output-only`     | Print a Markdown token + cost summary table to stdout. Skips writing transcripts. |
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
```

> **Shell quoting.** Quote glob patterns (`'branch:feature/*'`) so the shell
> does not expand `*`. Quote any token using `>`, `>=`, `<`, or `<=` (e.g.
> `'date>=2026-05-12'`) — otherwise zsh/bash treat it as an output redirection.
> Tokens using `:` or `=` are safe unquoted.

## How it works

Claude Code writes one `.jsonl` file per session into
`~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`. Each line is a JSON
record: a user turn, an assistant turn, or a `summary` row. Convoptics is a
streaming pipeline over those files.

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ scanner  │ -> │  query   │ -> │ matcher  │ -> │ exporter │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
   walk           parse argv      filter spec       per-session
   *.jsonl        into a spec     applied to        Markdown +
   extract                        each session      index
   metadata
```

### Modules

- [src/cli.js](src/cli.js) — argv parsing, wiring of the pipeline, output. Uses
  a small in-process concurrency limiter (`pAll`, default 8) to export
  sessions in parallel.
- [src/query.js](src/query.js) — `parseQuery(argv)` turns tokens like
  `branch:main` and `date>=2026-05-01` into a structured filter spec. Repeated
  keys accumulate into arrays (OR). Validates keys, operators, and the
  required `tool` filter.
- [src/scanner.js](src/scanner.js) — async generator. Streams every `.jsonl`
  under the root with `readline`, extracting only metadata
  (`sessionId`, `cwd`, `gitBranch`, `version`, `startedAt`, `endedAt`,
  `summary`, `messageCount`, `malformedCount`). The full message content is
  never buffered.
- [src/matcher.js](src/matcher.js) — `match(filter, session)` applies the spec.
  Branch globs are compiled to anchored, case-insensitive regexes:
  `*` becomes `[^/]*`, `**` becomes `.*`, and regex metacharacters in the rest
  of the pattern are escaped.
- [src/exporter.js](src/exporter.js) — for each match, re-streams the JSONL
  and writes a Markdown transcript. Writes go to a `.tmp` file first and are
  renamed atomically on success, so an interrupted run never leaves partial
  exports.

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
bin/convoptics.js         # entry point shim
src/cli.js                # argv → pipeline
src/query.js              # parseQuery
src/scanner.js            # walkJsonl + scanSessions (async generators)
src/matcher.js            # match + glob compilation
src/exporter.js           # exportSession + Markdown rendering
test/                     # node:test suites + fixtures
.github/workflows/ci.yml  # Node 18 + 20 matrix
```

## Running the tests

```bash
npm test
```

The suite uses Node's built-in `node:test` runner against fixtures under
[test/fixtures/projects/](test/fixtures/projects/).

## Adding support for other tools

The `tool:` key reserves the namespace for future adapters. A second adapter
would need its own scanner (producing the same session metadata shape) and an
exporter capable of rendering that tool's transcript format. The matcher and
query layers are tool-agnostic.

## License

MIT — see [LICENSE](LICENSE).
