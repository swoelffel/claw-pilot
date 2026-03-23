# Screen — Activity Console (`cp-activity-console`)

> **Source**: `ui/src/components/activity-console.ts`
> **Route**: `#/instances/:slug/activity`
> **Entry point**: Instance card "Activity" action or sidebar navigation

Paginated event browser for a single instance. Displays runtime bus events with filters by type, level, and agent. Supports cursor-based pagination and auto-refresh.

## Mockup

```
┌─ Header ────────────────────────────────────────────────────────┐
│  ← Back   Activity                             ☑ Auto-refresh   │
└─────────────────────────────────────────────────────────────────┘

┌─ Filters ───────────────────────────────────────────────────────┐
│  [ All types ▾ ]   [ Agent ID   ]   (info) (warn) (error)      │
└─────────────────────────────────────────────────────────────────┘

┌─ Events table ──────────────────────────────────────────────────┐
│  TIME      ●  TYPE                AGENT    SUMMARY              │
│  14:32:01  ●  session.created     ceo      New permanent session│
│  14:31:58  ●  message.created     dev      User message received│
│  14:31:45  ●  provider.failover   —        Switched to profile 2│
│  ▼ (expanded row)                                               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ { "sessionId": "abc123", "agentId": "ceo", ... }        │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘

                      [ Load more ]
```

## Header

| Element | Description |
|---|---|
| **← Back** | Gray outline button, hover `--bg-hover`. Emits `navigate { view: "cluster" }`. |
| **Title** | "Activity" (`font-size: 1.25rem`, `font-weight: 600`). |
| **Auto-refresh** | Checkbox + label. Checked by default. Toggles 30s polling interval. |

## Filters

Horizontal bar with wrapping. All filters trigger an immediate data reload.

| Filter | Type | Description |
|---|---|---|
| **Type** | `<select>` dropdown | 20 event types grouped by prefix. Default: "All types". |
| **Agent ID** | `<input type="text">` | Freeform text filter. |
| **Level pills** | 3 toggle buttons | `info` (blue), `warn` (orange), `error` (red). Click to toggle on/off. Only one active at a time (click same pill to deactivate). |

### Available event types

| Prefix | Events |
|---|---|
| `runtime` | `runtime.started`, `runtime.stopped`, `runtime.error` |
| `session` | `session.created`, `session.ended`, `session.status` |
| `message` | `message.created`, `message.updated` |
| `permission` | `permission.asked`, `permission.replied` |
| `provider` | `provider.auth_failed`, `provider.failover` |
| `heartbeat` | `heartbeat.alert` |
| `agent` | `agent.message.sent` |
| `subagent` | `subagent.completed` |
| `mcp` | `mcp.server.reconnected`, `mcp.tools.changed` |
| `tool` | `tool.doom_loop` |
| `channel` | `channel.message.received`, `channel.message.sent` |

## Events Table

| Column | Style | Description |
|---|---|---|
| **Time** | `tabular-nums`, `--text-secondary` | `HH:MM:SS` format (locale `fr-FR`). |
| **Level dot** | 8px circle | Color: info `#60a5fa`, warn `#fb923c`, error `#f87171`, default `#94a3b8`. |
| **Type** | Pill badge, white text | Background color by prefix (12 colors). |
| **Agent** | `--text-secondary`, 0.75rem | Agent ID or "—" if null. |
| **Summary** | `--text-primary` | Event summary text. |

### Type badge colors

| Prefix | Color |
|---|---|
| `runtime` | `#a78bfa` |
| `session` | `#60a5fa` |
| `message` | `#34d399` |
| `permission` | `#fb923c` |
| `provider` | `#f87171` |
| `agent` / `subagent` | `#818cf8` |
| `heartbeat` | `#94a3b8` |
| `mcp` | `#2dd4bf` |
| `tool` / `llm` | `#facc15` |
| `channel` | `#22d3ee` |

### Row interaction

- **Click row** → toggle expand/collapse detail panel.
- **Hover** → `--bg-hover` background.

### Detail panel (expanded row)

Spans all 5 columns. Shows event payload as formatted JSON (`pre` block, monospace 0.75rem, `--bg-base` background, max-height 300px with scroll).

## Pagination

Cursor-based pagination. "Load more" button shown when `nextCursor` is not null.

| Element | Description |
|---|---|
| **Load more** | Centered button, `--bg-surface` background, `--bg-border` border. |
| **Loading state** | Button text changes to "Loading…", disabled during fetch. |
| **Page size** | 50 events per page. |

## Data Fetching

| Endpoint | Description |
|---|---|
| `GET /api/instances/:slug/events` | Paginated events with query params: `cursor`, `limit`, `level`, `agentId`, `type[]` |

**Auto-refresh**: 30s interval (configurable via checkbox). Reloads from the beginning (resets cursor).

## States

| State | Display |
|---|---|
| **Loading** | Centered "Loading…" text. |
| **Error** | Centered error message in `--state-error` color. |
| **Empty** | Centered "No events found" message. |
| **Loaded** | Table with events + optional "Load more" footer. |

## i18n

All strings use `msg("...", { id: "activity.*" })` prefix. 11 keys across 6 locales.
