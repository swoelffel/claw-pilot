# Screen — Session Logs (`cp-session-logs`)

> **Source**: `ui/src/components/session-logs.ts`
> **Route**: `#/instances/:slug/session-logs`
> **Entry point**: Instance card "Session Logs" menu item

Master/detail viewer for runtime sessions. Displays all sessions (active + archived, permanent + ephemeral) with filters. Selecting a session shows its full conversation including system prompt, messages, and tool calls. Supports two viewing modes: Conversation (compact) and Raw LLM (full detail).

## Mockup

```
┌─ Header ────────────────────────────────────────────────────────┐
│  ← Back   Session Logs — {slug}                                │
└─────────────────────────────────────────────────────────────────┘

┌─ Filters ───────────────────────────────────────────────────────┐
│  Agent: [▼ All]  Period: [7d ● 30d ● All]  Type: [▼ All]      │
│  State: [▼ All]                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─ Sessions (scroll) ──────┬─ Conversation ───────────────────────┐
│  ● Pilot                 │  Pilot · 31 Mar 16:03 · claude-4    │
│    31 Mar 16:03          │                      [☐ Raw LLM]    │
│    15 msgs · $0.02       │  ┌─────────────────────────────────┐ │
│  ● tech-lead             │  │ ▶ System prompt (2.4 KB)        │ │
│    30 Mar 16:03          │  └─────────────────────────────────┘ │
│    42 msgs · $0.15       │                                      │
│  ● dev-sr  [archived]    │  👤 USER                             │
│    31 Mar 08:36          │  Comment créer un agent ?            │
│    3 msgs · $0.00        │                                      │
│                          │  🤖 ASSISTANT                        │
│  (scroll → load more)    │  ▶ 🔧 glob → completed              │
│                          │  Voici les étapes...                 │
│                          │                                      │
│                          │  Tokens: 12.3k in / 0.3k out        │
│                          │  Cost: $0.02 · claude-sonnet-4-6    │
└──────────────────────────┴──────────────────────────────────────┘
```

## Header

| Element | Description |
|---|---|
| **← Back** | Gray outline button, hover `--bg-hover`. Emits `navigate { view: "cluster" }`. |
| **Title** | "Session Logs — {slug}" (`font-size: 20px`, `font-weight: 700`). |

## Filters

Horizontal bar with wrapping. All filter changes reset the session list and reload from scratch.

| Filter | Type | API param | Description |
|---|---|---|---|
| **Agent** | `<select>` dropdown | `?agentId=` | Distinct agents from loaded sessions. Default: "All agents". |
| **Period** | Segmented control | `?since=` | 7d / 30d / All. Default: 7d. |
| **Type** | `<select>` dropdown | `?persistent=` | All / Permanent / Ephemeral. |
| **State** | `<select>` dropdown | `?state=` | All / Active / Archived. Default: All (both active and archived). |

## Session List (left panel, ~320px)

- Vertical scrollable list with infinite scroll (IntersectionObserver on sentinel div)
- Page size: 50 sessions per load
- Cursor: `before` param = `createdAt` of last session
- Each item shows: agent name, date, message count, cost
- Badges: `archived` (red), `persistent` (green)
- Selected item highlighted with `--accent-subtle` bg + left border accent

## Conversation Panel (right panel, flex 1)

### Header
- Agent name + creation date + model name
- Toggle checkbox: "Raw LLM" — switches between conversation and raw mode

### System Prompt
- Collapsible (closed by default) in Conversation mode
- Shows size in KB
- Always expanded in Raw mode
- Monospace font, pre-wrap

### Messages
Loaded via `GET /runtime/sessions/:id/messages` with cursor pagination (ULID-based).

| Part type | Conversation mode | Raw mode |
|---|---|---|
| `text` | Plain text, pre-wrap | Same |
| `tool_call` | Compact: `🔧 name → status`, expand on click for args | Full JSON |
| `tool_result` | Inside expanded tool call (or standalone) | Full content |
| `reasoning` | Italic, collapsible | Same |
| `compaction` | Dashed border + "compaction" label | Same |
| `suggestion` | Muted text | Same |

### Footer
- Total tokens in/out
- Total cost
- Model name

## Data Fetching

| Endpoint | Description |
|---|---|
| `GET /api/instances/:slug/runtime/sessions` | List sessions with filters + pagination |
| `GET /api/instances/:slug/runtime/sessions/:id/messages` | Messages with parts, cursor pagination |
| `GET /api/instances/:slug/runtime/sessions/:id/context` | Session context (system prompt, agent config, tools) |

## Responsive

- Below 800px: grid collapses to single column (list above, conversation below)
- Filters wrap onto multiple lines

## States

| State | Display |
|---|---|
| **Loading** | "Loading..." centered in each panel |
| **Error** | Red error message centered |
| **Empty (no sessions)** | "No sessions found" with suggestion to change filters |
| **No selection** | "Select a session" centered in right panel |
| **Loaded** | Full master/detail layout |

## i18n

All strings use `msg("...", { id: "session-logs-*" })` prefix. 18 keys across en + fr locales.
