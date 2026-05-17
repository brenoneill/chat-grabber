# Cursor session storage — schema reference

Notes on the Cursor on-disk format the chat-grabber Cursor adapter is built
against. Cursor's storage is undocumented and changes between releases; this
file pins what we observed so a future schema-drift bug is fast to diagnose.

> Captured: 2026-05-16 from a 1.16 GB global DB with 1,319 sessions
> and 40,778 message bubbles on macOS.
> Schema version observed: `bubbleId._v = 3` (99.8% of rows).

## Storage map

Cursor splits session data across **one global SQLite DB** and **one DB per
workspace**.

| File | Holds |
|---|---|
| `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` | Session bodies and all message bubbles, keyed by composer UUID. Cross-workspace. |
| `~/Library/Application Support/Cursor/User/workspaceStorage/<hash>/state.vscdb` | Per-workspace composer registry with cwd, branch, and rich metadata. One per workspace folder Cursor has opened. |
| `~/Library/Application Support/Cursor/User/workspaceStorage/<hash>/workspace.json` | `{ "folder": "file:///path/to/repo" }` — the cwd for everything in this workspace. |

Linux paths use `~/.config/Cursor/...`; Windows uses `%APPDATA%\Cursor\...`.
Same layout under those roots.

Each `.vscdb` is regular SQLite with two key-value tables:

```sql
CREATE TABLE ItemTable    (key TEXT UNIQUE, value BLOB);
CREATE TABLE cursorDiskKV (key TEXT UNIQUE, value BLOB);
```

Values are UTF-8 JSON text stored as BLOBs.

## Global DB — `cursorDiskKV` key patterns

| Prefix | Count | What it holds |
|---|---:|---|
| `bubbleId:<sessionId>:<bubbleId>` | 40,778 | Individual message bubbles. The source of truth for message content. |
| `agentKv:*` | 19,077 | Background-agent KV state. Not consumed by the export. |
| `checkpointId:*` | 8,810 | Workspace/file checkpoints for Cursor's "Restore" feature. Skip. |
| `codeBlockDiff:*` | 6,635 | Diff data for individual code blocks. Skip. |
| `codeBlockPartialInlineDiffFates:*` | 4,233 | Inline-diff acceptance state. Skip. |
| `messageRequestContext:*` | 2,031 | Per-message request context. Optional enrichment. |
| `composerData:<uuid>` | 1,319 | **Session header** — name, status, conversation cache, modes, timestamps. |
| `ofsContent:*` | 521 | File-system content cache. Skip. |

## `composerData:<uuid>` — session header

```jsonc
{
  "composerId": "<uuid>",           // matches the row key suffix
  "name": "Fixing Tab Update...",   // session title (sometimes empty)
  "createdAt": 1737136403732,       // unix ms
  "lastUpdatedAt": 1737136718874,   // unix ms
  "status": "none",                 // "none" | "generating" | ...
  "unifiedMode": "agent",           // "agent" (554) | "chat" (422) | "edit" (18) | "plan" (4) | null (321)
  "forceMode": "edit",
  "isAgentic": false,
  "conversation": [ /* bubble cache; see below */ ],
  "context": { /* attached files, selections, etc. */ },
  "tabs": [...],
  "capabilities": [...]
  // ... ~25 UI-state fields omitted
}
```

`conversation[]` is a cache of bubble summaries used by Cursor's UI. Each entry
has its own `bubbleId` that joins to a `bubbleId:<sessionId>:<bubbleId>` row in
the same DB — **always prefer the bubbleId rows for export content**, the
embedded cache is partial.

No `cwd`, no `gitBranch`, no `version` field. Those come from the workspace
registry (below).

## `bubbleId:<sessionId>:<bubbleId>` — single message

Most fields are sparse. The reliable ones:

| Field | Type | Notes |
|---|---|---|
| `_v` | number | Schema version. `3` in 40,716/40,778 rows. Code defensively against other values. |
| `type` | number | `1` = user (2,183), `2` = assistant (38,594). Ratio ~1:17 — each tool call / thinking step is its own type:2 bubble. |
| `text` | string | Message text. Often empty for tool-call or thinking bubbles. |
| `bubbleId` | uuid | Within-session id. |
| `requestId` | uuid | Server request id, shared across bubbles in the same turn. |
| `usageUuid` | uuid | Billing/usage id (sparse). |
| `tokenCount` | `{inputTokens, outputTokens}` | **Mostly zero — 96% of assistant bubbles report `{0,0}`. Don't trust for cost reporting.** |
| `workspaceUris` | string[] | `file://...` URIs. **Sparse — only 11% of sessions have any.** Use the workspace registry instead. |
| `thinking`, `allThinkingBlocks`, `thinkingDurationMs` | various | Extended thinking output. |
| `toolResults`, `mcpDescriptors`, `supportedTools` | various | Tool-call data. |
| `capabilityType`, `capabilities`, `capabilityContexts`, `capabilityStatuses` | various | Agent capability invocations. |
| `editTrailContexts`, `fileDiffTrajectories`, `gitDiffs`, `humanChanges`, `diffsSinceLastApply`, `assistantSuggestedDiffs` | various | File-edit data. Targets for `diffs:no-diffs` redaction. |

There are ~70 fields total on the bubble row; the rest are UI state or
feature-specific extras.

## Workspace DB — `ItemTable.composer.composerData`

Each workspace's local DB has one entry that lists the composers belonging to
it, with the richest metadata Cursor exposes:

```jsonc
{
  "allComposers": [
    {
      "composerId": "368a3d8e-...",           // joins to global composerData:<id>
      "type": "head",                          // "head" | other
      "name": "Candidate assessment flow...",
      "subtitle": "page.tsx, route.ts, ...",
      "createdAt": 1771860348535,
      "lastUpdatedAt": 1771865761688,
      "unifiedMode": "agent",
      "forceMode": "edit",
      "createdOnBranch": "main",               // git branch at session creation
      "totalLinesAdded": 1978,
      "totalLinesRemoved": 139,
      "filesChangedCount": 18,
      "contextUsagePercent": 37.5,
      "hasUnreadMessages": false,
      "isArchived": false,
      "isDraft": false,
      "isWorktree": false,
      "isSpec": false,
      "isBestOfNSubcomposer": false,
      "numSubComposers": 0,
      "referencedPlans": []
    }
  ],
  "selectedComposerIds": [...],
  "lastFocusedComposerIds": [...],
  "hasMigratedComposerData": true,
  "hasMigratedMultipleComposers": true
}
```

This is where `cwd` (via the sibling `workspace.json`) and `gitBranch` (via
`createdOnBranch`) come from. **`createdOnBranch` is the branch when the
session was created; it does not update if the user switches branches
mid-session.** That's the same semantic as Claude Code's `gitBranch` so
treating them as equivalent for filtering is reasonable.

## Join strategy

```
for each workspaceStorage/<hash>:
  folder := workspace.json.folder
  for each c in state.vscdb.ItemTable['composer.composerData'].allComposers:
    index[c.composerId] = { cwd: folder, branch: c.createdOnBranch,
                            name: c.name, subtitle: c.subtitle,
                            isArchived: c.isArchived, ... }

for each composerData:<id> in global cursorDiskKV:
  meta := index[id]   // may be missing — "orphan" session, workspace deleted
  bubbles := load all bubbleId:<id>:* from global cursorDiskKV
  emit session(meta, header, bubbles)
```

Orphans (sessions present in the global DB but not in any workspace registry)
exist; treat `cwd` and `gitBranch` as `null` and let the matcher filter them
out when `cwd:` or `branch:` is requested.

## Fragility — what to watch for

- **Schema version `_v`.** Any value other than `3` should log a warning. New
  major versions probably reshape `bubbleId` rows.
- **`workspaceUris` is unreliable.** Don't rely on it for cwd; always go
  through the workspace registry.
- **`tokenCount` is unreliable.** 96% of assistant bubbles report zero. Don't
  expose cost numbers for Cursor sessions until this is understood.
- **Sub-composers / best-of-N.** `numSubComposers > 0` and
  `isBestOfNSubcomposer: true` indicate Cursor's parallel-exploration feature.
  Each branch is its own composer row. V1 treats them as independent
  sessions; revisit if it produces confusing exports.
- **Background composers / agents.** `backgroundComposer.*` keys in
  `ItemTable` (global) and `workbench.backgroundComposer.workspacePersistentData`
  (workspace) reference a separate session type. Out of scope for v1.
- **Legacy chat panel.** `workbench.panel.aichat.view.aichat.chatdata` in
  ItemTable holds the older non-composer chat. Out of scope for v1.

## SQLite access from Node

- `node:sqlite` (built in, stable Node 22.5+) is the preferred client. Open
  read-only via the URI form so we don't fight Cursor for the WAL:
  `new DatabaseSync('file:/path/to/state.vscdb?mode=ro&immutable=1', { readOnly: true })`.
- Cursor leaves a non-trivial WAL (~9 MB observed). Reading with
  `immutable=1` skips WAL recovery; you'll miss writes from the last few
  seconds but won't see lock errors. Acceptable for an export tool.
- If `node:sqlite` ever needs to be avoided, `better-sqlite3` is a drop-in.
  Shell-out to the `sqlite3` CLI is a fallback for very old Node, but the
  blob `writefile()` dance is awkward.
