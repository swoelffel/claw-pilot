# Component — Live Stream Widget (`cp-live-stream-widget`)

> **Source**: `ui/src/components/live-stream-widget.ts`
> **Parent**: `cp-app` (header navigation bar)
> **Scope**: Global — persists across navigation, tied to the currently viewed instance

Real-time event stream widget in the header bar. Connects via SSE to the instance event stream. Replaces the previous static WS indicator with an interactive dropdown showing live events.

## Mockup

### Header button (closed)

```
┌──────────────────────┐
│  ● Live  [3]         │   ← green dot + unread badge
└──────────────────────┘
```

### Dropdown panel (open)

```
┌──────────────────────────────────────────┐
│  ● Live                        [⏸] [✕]  │
├──────────────────────────────────────────┤
│  14:32:01  ● session.created  New perm…  │
│  14:31:58  ● message.created  User mes…  │
│  14:31:45  ● provider.failover Switched… │
│  14:31:30  ● heartbeat.alert  ceo late…  │
│                                          │
│  (auto-scrolls to bottom)                │
└──────────────────────────────────────────┘
```

## Properties

| Property | Type | Description |
|---|---|---|
| `slug` | `string` | Currently viewed instance slug. SSE stream opens/closes when this changes. |
| `wsConnected` | `boolean` | WS monitor connection state (passed from parent). Used as fallback indicator when no instance is selected. |

## Header Button

| Element | Description |
|---|---|
| **Status dot** | 6px circle. Green (`#34d399`) if connected, gray (`#94a3b8`) if not. |
| **Label** | "Live" (connected) or "Offline" (disconnected). |
| **Badge** | Accent pill with unread count. Shown only when `_newCount > 0` and panel is closed. |
| **Border** | Transparent default. `--accent-border` on hover. `--accent` when panel is open. |

Click toggles the dropdown panel and resets unread count.

## Dropdown Panel

Fixed position below the button (`top: calc(100% + 8px)`, `right: 0`). Size: 420×340px.

### Panel header

| Element | Description |
|---|---|
| **Status dot** | SSE connection state (independent of WS). |
| **Title** | "Live" |
| **Pause/Play** | Toggle auto-scroll. "⏸" when playing, "▶" when paused. |
| **Clear** | "✕" button — empties the event buffer. |

### Event lines

Each event rendered as a single line:

| Part | Style | Description |
|---|---|---|
| **Time** | `--text-secondary`, `tabular-nums`, 0.7rem | `HH:MM:SS` format. |
| **Level dot** | 6px circle | Same color palette as Activity Console (info blue, warn orange, error red). |
| **Type** | `--text-secondary`, 0.7rem, `font-weight: 500` | Event type string (e.g. `session.created`). |
| **Summary** | `--text-primary`, 0.75rem | Truncated with `text-overflow: ellipsis`. |

## SSE Connection

| Aspect | Value |
|---|---|
| **Endpoint** | `GET /api/instances/:slug/events/stream` |
| **Auth** | Token passed as query parameter. |
| **Buffer** | Max 200 events (oldest trimmed when exceeded). |
| **Reconnection** | Exponential backoff: 1s → 2s → 4s → … → max 30s. |
| **Visibility** | Reconnects immediately when tab becomes visible (if disconnected). |
| **Ping** | Listens for `ping` SSE events to confirm connection. |

## Interaction

| Action | Behavior |
|---|---|
| **Click button** | Toggle panel open/close. Reset unread count on open. Auto-scroll to bottom. |
| **Outside click** | Close panel (document-level click listener). |
| **Slug change** | Close current stream, clear events, open new stream for new slug. |
| **Slug cleared** | Close stream, clear events, close panel. |
| **Pause** | Events still accumulate in buffer but panel does not auto-scroll. |
| **Clear** | Empty buffer and reset unread count. |

## States

| State | Display |
|---|---|
| **No instance** | Button shows WS connection state. Panel does not render. |
| **Connected, no events** | Panel shows "No events yet" centered message. |
| **Connected, receiving** | Events stream in, auto-scroll active (unless paused). |
| **Disconnected** | Gray dot, "Offline" label. Reconnection in progress (backoff). |

## i18n

4 keys: `ws-live`, `ws-offline`, `live.panel-title`, `live.empty`.
