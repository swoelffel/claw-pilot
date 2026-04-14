# Component — Home Chat (`cp-home-chat`)

> **Source**: `ui/src/components/home-chat.ts`
> **Used in**: Home Screen (`cp-home-screen`)

Lean conversational UI dedicated to the cp-system instance. Simplified counterpart of `cp-runtime-pilot` — no context panel, no filter bar, no agent tabs.

## Mockup

```
┌─ Header ──────────────────────────────────────────────┐
│  system-pilot  ● idle    12.4k tokens  $0.03          │
└───────────────────────────────────────────────────────┘
┌─ Messages ────────────────────────────────────────────┐
│  [ASSISTANT] Hello! How can I help you manage...      │
│                                                        │
│  [YOU] Create a new instance called "staging"          │
│                                                        │
│  [ASSISTANT] I'll create that for you...               │
│  [delegation] Asked admin-exec → ...                   │
│  [suggestions] ○ Show instances  ○ Configure staging   │
└───────────────────────────────────────────────────────┘
┌─ Input ───────────────────────────────────────────────┐
│  Ask anything about your ClawPilot setup...    [Send] │
└───────────────────────────────────────────────────────┘
```

## Props

| Property | Type | Description |
|---|---|---|
| `slug` | `string` | System instance slug (cp-system) |

## Status Phases

6-phase status: `idle`, `loading`, `sending`, `thinking`, `tool` (using <tool>), `streaming`, `error`.

## Timeline Filters (hardcoded)

| Filter | Value | Effect |
|---|---|---|
| `chat` | true | Show conversation messages |
| `a2a` | true | Show delegation traces |
| `tools` | false | Hide raw tool calls |
| `thinking` | true | Show reasoning blocks |
| `subtasks` | true | Show subtask results |
| `suggestions` | true | Show follow-up chips |

## SSE Connection

Connects to `GET /api/instances/:slug/runtime/chat/stream` via EventSource.

| Parameter | Value |
|---|---|
| Initial reconnect delay | 1,000 ms |
| Multiplier | 2x |
| Max delay | 30,000 ms |
| Polling fallback | 10,000 ms |

See [SSE Architecture](../sse-architecture.md) for details.

## Sub-components

Uses `cp-pilot-header`, `cp-pilot-messages`, `cp-pilot-input` from the pilot subsystem.

## Data Fetching

| Endpoint | Description |
|---|---|
| `GET /api/instances/:slug/runtime/sessions` | Load active sessions |
| `GET /api/instances/:slug/runtime/sessions/:id/messages` | Session messages |
| `POST /api/instances/:slug/runtime/chat` | Send message |
| `POST /api/instances/:slug/runtime/chat/abort` | Abort streaming |
| `GET /api/instances/:slug/runtime/chat/stream` | SSE real-time events |

## i18n

All strings use `msg("...", { id: "home-chat.*" })` prefix.

---

*Since v0.70.0*
