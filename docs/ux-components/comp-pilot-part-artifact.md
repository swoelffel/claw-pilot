# Artifact Card (`cp-pilot-part-artifact`)

> **Source**: `ui/src/components/pilot/parts/part-artifact.ts`

Rich card renderer for `create_artifact` tool calls. Displays structured content (code, markdown, JSON, etc.) with a header, scrollable body, and copy button. Used inside `cp-pilot-message` when `toolName === "create_artifact"`.

## Mockup

```
┌─ artifact-card ──────────────────────────────────────┐
│  ┌─ header (accent-subtle bg) ─────────────────────┐ │
│  │  [{ }]  Sort Algorithm       python   [Copy]    │ │
│  └─────────────────────────────────────────────────┘ │
│  ┌─ content (mono, scrollable) ────────────────────┐ │
│  │  def quicksort(arr):                            │ │
│  │      if len(arr) <= 1:                          │ │
│  │          return arr                             │ │
│  │      pivot = arr[len(arr) // 2]                 │ │
│  │      ...                                        │ │
│  └─────────────────────────────────────────────────┘ │
│  [ Show all ]  (if > 30 lines)                       │
└──────────────────────────────────────────────────────┘
```

## Properties

| Property | Type | Description |
|---|---|---|
| `call` | `PilotPart` | The `tool_call` part (metadata contains args) |
| `result` | `PilotPart \| undefined` | The `tool_result` part (content = artifact body) |

## Metadata (parsed from `call.metadata`)

```json
{
  "toolName": "create_artifact",
  "toolCallId": "...",
  "args": {
    "title": "Sort Algorithm",
    "artifactType": "code",
    "content": "def quicksort(arr): ...",
    "language": "python"
  }
}
```

## Artifact Types

| Type | Icon | Extension (Telegram) |
|---|---|---|
| `code` | `{ }` | `.py`, `.ts`, `.js` (language-based) |
| `markdown` | `MD` | `.md` |
| `json` | `{ }` | `.json` |
| `csv` | `CSV` | `.csv` |
| `svg` | `SVG` | `.svg` |
| `html` | `</>` | `.html` |

## Design

| Element | Description |
|---|---|
| **Card** | `border: 1px solid --accent-border`, `border-radius: --radius-md`, `background: --bg-surface` |
| **Header** | `background: --accent-subtle`, `border-bottom: 1px solid --accent-border` |
| **Type icon** | `font-family: --font-mono`, `font-weight: 700`, `color: --accent`, `background: rgba(79,110,247,0.12)` |
| **Title** | `font-size: 13px`, `font-weight: 600`, `--text-primary`, ellipsis on overflow |
| **Language badge** | `font-size: 10px`, `--text-muted`, monospace |
| **Copy button** | Ghost style, transitions to green "Copied" for 2s on click (clipboard API) |
| **Content** | `font-family: --font-mono`, `font-size: 12px`, `white-space: pre-wrap`, `max-height: 400px`, `overflow: auto` |
| **Collapsed state** | If > 30 lines or 2000 chars: `max-height: 200px` with gradient fade + "Show all" button |
| **Expand button** | Full-width, `--accent` text, `border-top: 1px solid --bg-border` |

## Telegram delivery

When the artifact is sent via Telegram, it is delivered as a **downloadable document** (file) with the artifact title as caption. See `TelegramChannel.sendArtifactDocument()`.
