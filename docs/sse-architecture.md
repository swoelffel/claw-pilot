# SSE Architecture — Real-time Streaming

> **Source**: `src/runtime/engine/internal-api.ts`, `src/dashboard/routes/_sse-proxy.ts`, `ui/src/services/`
> **Version**: 0.72.6

claw-pilot uses **Server-Sent Events (SSE)** for real-time streaming and a separate **WebSocket** for health monitoring. This document covers all four real-time channels.

---

## Overview

```
┌──────────────┐    internal SSE     ┌─────────────────┐    public SSE     ┌─────────────┐
│  claw-runtime │ ←───────────────→  │    Dashboard     │ ←──────────────→ │   Browser    │
│    daemon     │  /internal/events  │   Hono server    │  /api/.../stream │  EventSource │
│               │    /stream         │                  │                  │              │
│   Bus (26+    │  Bearer token      │  _sse-proxy.ts   │  ?token= or     │  home-chat   │
│   event types)│  (timing-safe)     │  (parse + pipe   │  cookie auth     │  pilot       │
│               │                    │   + transform)   │                  │  live-stream │
└──────────────┘                     └────────┬─────────┘                  └──────────────┘
                                              │
                                     WebSocket /ws
                                     (health_update 10s)
                                              │
                                     ┌────────▼─────────┐
                                     │   ws-monitor.ts   │
                                     └──────────────────┘
```

**Key design**: the runtime daemon and dashboard are **separate OS processes**, each with their own in-memory Bus. The SSE proxy bridges them — the daemon exposes an internal SSE endpoint, and the dashboard connects to it via `fetch()` and pipes parsed events through Hono's `SSEStreamingApi` to the browser.

---

## SSE Stream 1 — Chat Stream

**Browser endpoint**: `GET /api/instances/:slug/runtime/chat/stream`

**Purpose**: real-time streaming for the Pilot and Home Chat UIs (messages, reasoning, tool phases, questions, suggestions).

**Query params**:
| Param | Description |
|---|---|
| `sessionId` | Optional — filter events to a specific session |
| `token` | Bearer token (fallback when cookies are unavailable) |

**22 event types** forwarded (CHAT_RELEVANT_TYPES):

| Category | Event types |
|---|---|
| Message streaming | `message.part.delta`, `message.created`, `message.updated` |
| Session lifecycle | `session.status`, `session.ended`, `session.created`, `session.updated` |
| System prompt | `session.system_prompt` |
| Permissions | `permission.asked`, `permission.replied` |
| Sub-agents | `subagent.completed` |
| Provider | `provider.failover`, `provider.auth_failed` |
| Tools | `tool.doom_loop`, `tool.call.started`, `tool.call.ended` |
| MCP | `mcp.tools.changed` |
| Timeouts | `llm.chunk_timeout`, `agent.timeout` |
| Questions | `question.asked` |
| Suggestions | `suggestions.generated` |

**UI consumers**:
- `cp-runtime-pilot` — full pilot chat interface
- `cp-home-chat` — lean home chat (applies HOME_FILTERS: chat + a2a + subtasks + suggestions, no raw tools)
- `cp-permission-request-overlay` — listens for `permission.asked`

---

## SSE Stream 2 — Events Stream

**Browser endpoint**: `GET /api/instances/:slug/events/stream`

**Purpose**: instance-wide event stream for the Activity Console and Live Stream Widget.

**Query params**:
| Param | Description |
|---|---|
| `type` | Comma-separated event types filter |
| `agentId` | Filter by agent |
| `level` | Filter by level (info/warn/error) |
| `token` | Bearer token |

**Events**: all runtime bus events (unfiltered by default). The dashboard-side transform derives `level` and calculates summaries before forwarding.

**UI consumer**: `cp-live-stream-widget` — dropdown event log (max 200 events in-memory).

---

## SSE Stream 3 — Internal Daemon Stream

**Daemon endpoint**: `GET /internal/events/stream` (node:http server on derived port)

**Purpose**: internal IPC between daemon and dashboard. Not exposed to browsers directly.

**Query params**:
| Param | Description |
|---|---|
| `sessionId` | Optional — daemon-side filter |
| `types` | Comma-separated event type filter |

**Auth**: `Authorization: Bearer <token>` with timing-safe comparison (`resolveInternalApiToken(slug)`).

**Implementation** (`src/runtime/engine/internal-api.ts`):
- Subscribes to `getBus(slug).subscribeAll()`
- Writes `data: <JSON>\n\n` for each event
- Sends `:ping\n\n` comment every 15s as keep-alive
- Sends `retry: 3000\n\n` as reconnection hint (3s)
- Port derived from instance slug via `deriveInternalApiPort()`

---

## WebSocket — Health Monitor

**Endpoint**: `/ws` on dashboard port 19000

**Purpose**: instance health updates, transitioning state. Separate from SSE — optimized for delta-compressed periodic broadcasts.

**Auth**: first applicative message (`{ type: "auth", token }`) with timing-safe compare.

**Broadcasts**: `health_update` every 10s with:
- Each instance state (running/stopped/error/unknown + transitioning flag)
- Pending permissions count
- Heartbeat agents and alerts
- MCP server count

**UI consumer**: `ws-monitor.ts` — dispatches `cp-ws-message` custom events to `window`.

**Reconnection**: 5-second delay on disconnect.

---

## SSE Proxy Architecture

**File**: `src/dashboard/routes/_sse-proxy.ts`

The proxy is the bridge between daemon and browser:

1. **Connect**: `fetch()` to `http://127.0.0.1:<derivedPort>/internal/events/stream`
2. **Parse**: `parseSSEChunks()` generator extracts `data:` lines from raw SSE text
3. **Transform**: optional dashboard-side function can reshape or filter events
4. **Forward**: `stream.writeSSE()` via Hono's `SSEStreamingApi`
5. **Keep-alive**: 15s ping interval (`event: ping`)
6. **Error handling**: sends `event: error` with `RUNTIME_UNREACHABLE` or `RUNTIME_ERROR`
7. **Disconnect**: sends `event: disconnect` with `RUNTIME_DISCONNECTED` when daemon stops
8. **Cleanup**: `AbortController` wired to browser disconnect

```typescript
interface ProxySSEParams {
  sessionId?: string;     // daemon-side filter
  types?: string;         // comma-separated event types
  transform?: (raw) => Record<string, unknown> | null;  // dashboard-side transform
}
```

---

## Auth Strategy

`EventSource` cannot set custom headers. Auth uses two mechanisms:

| Mechanism | Priority | Detail |
|---|---|---|
| **Session cookie** | 1 (preferred) | `EventSource(url, { withCredentials: true })` sends the HttpOnly session cookie |
| **Token query param** | 2 (fallback) | `?token=<bearer>` — timing-safe comparison in auth middleware |

The internal daemon-to-dashboard connection uses standard `Authorization: Bearer` header (fetch, not EventSource).

---

## Reconnection Strategy

All UI SSE consumers implement the same pattern:

| Parameter | Value |
|---|---|
| Initial delay | 5,000 ms |
| Multiplier | 2x per retry |
| Max delay | 60,000 ms |
| Polling fallback | 10s interval for missed events |
| Visibility change | Immediate refresh on tab focus |

Implementation: manual `onerror` handler with `_scheduleReconnect()`. The native `EventSource` auto-reconnect is overridden for finer control.

---

## Event Types Reference (43 types in AnyEventDef union)

All events are defined in `src/runtime/bus/events.ts` with typed payloads via `EventDef<T, P>`.

### Runtime (4)

| Event type | Payload (key fields) |
|---|---|
| `runtime.started` | slug |
| `runtime.stopped` | slug, reason? |
| `runtime.state_changed` | slug, state, previous |
| `runtime.error` | slug, error, stack? |

### Sessions (5)

| Event type | Payload (key fields) |
|---|---|
| `session.created` | sessionId, agentId, channel |
| `session.updated` | sessionId, title? |
| `session.ended` | sessionId, reason (completed/cancelled/error) |
| `session.status` | sessionId, status (idle/busy/retry), agentId?, tokensIn?, tokensOut?, costUsd? |
| `session.system_prompt` | sessionId, agentId, systemPrompt, builtAt |

### Messages (3)

| Event type | Payload (key fields) |
|---|---|
| `message.created` | sessionId, messageId, role (user/assistant) |
| `message.updated` | sessionId, messageId |
| `message.part.delta` | sessionId, messageId, partId, delta, partType? (text/reasoning) |

### Permissions (2)

| Event type | Payload (key fields) |
|---|---|
| `permission.asked` | id, sessionId, permission, pattern, description? |
| `permission.replied` | id, sessionId, action (allow/deny), persist, feedback? |

### Provider (2)

| Event type | Payload (key fields) |
|---|---|
| `provider.auth_failed` | providerId, profileId, reason |
| `provider.failover` | providerId, fromProfileId, toProfileId, reason |

### Agents & Subagents (3)

| Event type | Payload (key fields) |
|---|---|
| `subagent.completed` | parentSessionId, subSessionId, result {text, steps, tokens, model} |
| `agent.message.sent` | fromAgentId, toAgentId, expectReply, instanceSlug |
| `agent.timeout` | sessionId, agentId, timeoutMs |

### Heartbeat (2)

| Event type | Payload (key fields) |
|---|---|
| `heartbeat.tick` | agentId, instanceSlug |
| `heartbeat.alert` | agentId, instanceSlug, text |

### Budget (2)

| Event type | Payload (key fields) |
|---|---|
| `budget.soft_alert` | instanceSlug, budgetId, scope, scopeId, spentUsd, limitUsd, pct |
| `budget.hard_stop` | instanceSlug, budgetId, scope, scopeId, spentUsd, limitUsd |

### Tasks (3)

| Event type | Payload (key fields) |
|---|---|
| `task.created` | instanceSlug, taskId, title, createdBy |
| `task.status_changed` | instanceSlug, taskId, oldStatus, newStatus, agentId? |
| `task.assigned` | instanceSlug, taskId, assigneeId, sessionId?, assignedBy? |

### MCP (2)

| Event type | Payload (key fields) |
|---|---|
| `mcp.server.reconnected` | serverId |
| `mcp.tools.changed` | serverId, toolCount |

### Tools (6)

| Event type | Payload (key fields) |
|---|---|
| `tool.doom_loop` | sessionId, toolName |
| `llm.chunk_timeout` | sessionId, agentId, elapsedMs |
| `guardrail.blocked` | sessionId, provider, reason |
| `tool.error.recovered` | sessionId, toolName, errorType |
| `tool.call.started` | sessionId, messageId, toolName, toolCallId |
| `tool.call.ended` | sessionId, messageId, toolName, toolCallId |

### Questions & Suggestions (2)

| Event type | Payload (key fields) |
|---|---|
| `question.asked` | questionId, sessionId, messageId, agentId, questions[] (v0.72+ structured) |
| `suggestions.generated` | sessionId, messageId, suggestions[] |

### Flows (3)

| Event type | Payload (key fields) |
|---|---|
| `flow.run.started` | instanceSlug, runId, flowId, flowName |
| `flow.step.completed` | instanceSlug, runId, stepId, agentId, outcome |
| `flow.run.completed` | instanceSlug, runId, flowId, status |

### Workspace & System (2)

| Event type | Payload (key fields) |
|---|---|
| `workspace.file.changed` | instanceSlug, agentId, filename, filePath |
| `system.state.changed` | resource (named-key/instance/blueprint), action (create/update/delete) |

### Channels (2)

| Event type | Payload (key fields) |
|---|---|
| `channel.message.received` | channelType, peerId, text |
| `channel.message.sent` | channelType, peerId, text, sessionId |

---

## Debug

Toggle SSE diagnostic logging in browser devtools:

```javascript
localStorage.setItem("cp:debug-sse", "1");
// Reload — all SSE events logged under [cp:sse] prefix
```

Helper: `ui/src/services/debug.ts::debugSse(label, ...args)`.

---

*Updated: 2026-04-16 — v0.73.5: 3 SSE streams, 1 WebSocket, 43 event types (11 categories), SSE proxy with transform layer*
