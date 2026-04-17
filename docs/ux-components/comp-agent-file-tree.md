# Component — Agent File Tree (`cp-agent-file-tree`)

> **Source**: `ui/src/components/agent-file-tree.ts`, `ui/src/components/workspace-file-dialogs.ts`
> **Used in**: Agent Detail Panel (`cp-agent-detail-panel`) — Files tab

Collapsible file tree for managing an agent's workspace files. Supports browsing, creating, editing, and deleting files at arbitrary relative paths (including subdirectories).

## Mockup

```
┌─ Files ──────────────────────────────────────────────────────┐
│  memory/                                            [+]  ▾   │
│    facts.md             Knowledge base for ...     [✕]       │
│    decisions.md         Architectural decisions    [✕]       │
│  SOUL.md                Agent identity file        [✕]       │
│  IDENTITY.md            Mission and goals          [✕]       │
│  [+ New file]                                                 │
└──────────────────────────────────────────────────────────────┘
```

## Props

| Property | Type | Description |
|---|---|---|
| `slug` | `string` | Instance slug |
| `agentId` | `string` | Agent ID |

## Tree behavior

- **Directories** are inferred from file paths (e.g., `memory/facts.md` → `memory/` directory node)
- **Expand/collapse** per directory, persisted in component state
- **Per-directory "+" button** opens `cp-new-file-dialog` pre-filled with the directory prefix
- **Per-file delete button** opens `cp-delete-file-dialog` with the full relative path
- File names are displayed with a truncated title extracted from the file's first H1 or frontmatter `description:`
- Blueprint agents retain the legacy flat-tabs UI (file tree is instance agents only)

## Dialogs

### `cp-new-file-dialog`

| Field | Description |
|---|---|
| **Path** | Relative path from workspace root (e.g., `memory/notes.md`). Validated client-side and server-side. |
| **Content** | Optional initial content (textarea). |

Allowed extensions: `.md`, `.txt`, `.json`, `.yaml`, `.yml`, `.csv`, `.log`.
Path traversal (`../`) and absolute paths are rejected.

### `cp-delete-file-dialog`

Confirmation dialog showing the full relative path. Calls `DELETE /api/instances/:slug/agents/:agentId/files/*`.

## Data Fetching

| Endpoint | Description |
|---|---|
| `GET /api/instances/:slug/agents/:agentId/files` | Fetch hierarchical file tree |
| `GET /api/instances/:slug/agents/:agentId/files/*` | Read file content (opens in editor) |
| `PUT /api/instances/:slug/agents/:agentId/files/*` | Create or update file |
| `DELETE /api/instances/:slug/agents/:agentId/files/*` | Delete file |

## Events

| Event | Direction | Description |
|---|---|---|
| `files-changed` | tree → panel | A file was created or deleted (triggers reload) |

## i18n

Uses `msg("...", { id: "agent-files.*" })` prefix.

---

*Since v0.73.5 (workspace management)*
