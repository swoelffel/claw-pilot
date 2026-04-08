# Screen — Memory Browser (`cp-memory-browser`)

> **Source**: `ui/src/components/memory-browser.ts`
> **Route**: `#/instances/:slug/memory`
> **Entry point**: Instance card "Memory" action or sidebar navigation

Three-panel memory file browser with FTS5 full-text search. Displays agent memory files (MEMORY.md, SOUL.md, etc.) with markdown rendering and decay score visualization.

## Mockup

```
┌─ Header ────────────────────────────────────────────────────────┐
│  ← Back   Memory                        [ Search memory...    ] │
└─────────────────────────────────────────────────────────────────┘

┌─ Main (3 columns) ─────────────────────────────────────────────────┐
│ ┌─ Agents ──┐ ┌─ Files ───────┐ ┌─ Content ────────────────────┐  │
│ │ ● pilot   │ │ MEMORY.md 2KB │ │  # Memory Index              │  │
│ │   dev     │ │ facts.md  1KB │ │                               │  │
│ │   build   │ │ goals.md  800B│ │  ● 0.9  User prefers terse   │  │
│ │           │ │               │ │  ● 0.7  Project uses SQLite   │  │
│ │           │ │               │ │  ● 0.3  Old migration note    │  │
│ │           │ │               │ │                               │  │
│ └───────────┘ └───────────────┘ └───────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘

  3 files  ·  3.8 KB  ·  Modified 2h ago
```

## Header

| Element | Description |
|---|---|
| **← Back** | Gray outline button, hover `--bg-hover`. Emits `navigate { view: "cluster" }`. |
| **Title** | "Memory" (`font-size: 18px`, `font-weight: 600`). |
| **Search input** | Text input, 240px wide, `--bg-surface` background. Debounced 300ms, triggers FTS5 search across all agents. |

## Main Layout

Three-column flex layout with 1px `--bg-border` gaps. Min-height 480px. `--bg-surface` background per panel.

| Panel | Width | Description |
|---|---|---|
| **Agents sidebar** | 180px fixed | List of agents with memory files. Shows name, file count, total size. Selected item: accent left border. |
| **Files sidebar** | 200px fixed | File list for selected agent. Shows filename (short) + size. MEMORY.md is bold (`is-index`), `memory/` sub-files are indented. |
| **Content panel** | flex: 1 | Markdown rendering of selected file, or search results. |

## Agent List

| Element | Style |
|---|---|
| **Name** | 13px, `font-weight: 500`, `--text-primary` |
| **Meta** | 11px, `--text-muted`. Format: `{fileCount} files · {totalSize}` |
| **Selected** | `--bg-hover` background + `3px solid --accent` left border |
| **Auto-select** | If only one agent, auto-selected on load |

## File List

| Element | Style |
|---|---|
| **File name** | 12px, `--text-primary`. MEMORY.md: `font-weight: 600`. Sub-files: `padding-left: 12px`, `--text-secondary`. |
| **File size** | 10px, `--text-muted`, right-aligned |
| **Auto-select** | MEMORY.md auto-selected if present |

## Content Panel

### Markdown rendering
Standard markdown via `marked` + `DOMPurify`. Headings 14–16px, code blocks with `--bg-base` background, blockquotes with accent left border.

### Decay score rendering
When content matches pattern `- [0.7] Some text`, renders as visual indicators:

| Score range | Dot color | Meaning |
|---|---|---|
| >= 0.7 | `#34d399` (green) | High relevance |
| 0.4 – 0.7 | `#fbbf24` (amber) | Medium relevance |
| < 0.4 | `#f87171` (red) | Low relevance / decaying |

Each line shows: colored dot (6px) + score (10px mono) + content text.

## Search Mode

When search input has text (after 300ms debounce), the content panel switches to search results.

### Search result card

```
┌─────────────────────────────────────────────────────────┐
│  [pilot]  memory/facts.md                         L42   │
│  ...the user prefers **terse** responses with no...     │
└─────────────────────────────────────────────────────────┘
```

| Element | Style |
|---|---|
| **Agent tag** | 10px bold, `--accent-subtle` background, `--accent` text |
| **Source** | 11px, `--text-muted` |
| **Line number** | 10px, `--text-muted` |
| **Snippet** | 12px mono, `--text-secondary`. Query matches highlighted with `<mark>` (accent background). |

Click result → navigates to that agent and file.

## Stats Bar

Shown below the main panel. Horizontal flex, 12px `--text-muted`.

Format: `{totalFiles} files · {totalSize} · Modified {relativeTime}`

## Data Fetching

| Endpoint | Description |
|---|---|
| `GET /api/instances/:slug/memory/agents` | List agents with file counts and sizes |
| `GET /api/instances/:slug/memory/agents/:agentId/files` | File list for an agent |
| `GET /api/instances/:slug/memory/agents/:agentId/files/:path` | File content |
| `GET /api/instances/:slug/memory/search?q=` | FTS5 search across all agents |

## Responsive

Below 800px: columns stack vertically, sidebars get `max-height: 200px`.

## States

| State | Display |
|---|---|
| **Loading** | Centered "Loading..." text. |
| **Error** | Red error banner at top of page. |
| **Empty (instance)** | Centered "No memory files found for this instance". |
| **Empty (agent)** | "No memory files" in files sidebar. |
| **No file selected** | "Select a file to view its content" in content panel. |
| **Search empty** | "No results found" in content panel. |

## i18n

All strings use `msg("...", { id: "memory.*" })` prefix. 8 keys across 6 locales.
