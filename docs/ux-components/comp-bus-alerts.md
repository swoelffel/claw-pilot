# Bus Alerts (`cp-bus-alerts`)

> **Source**: `ui/src/components/bus-alerts.ts`

Live alert toasts positioned bottom-right (`bottom: 100px`, `right: 24px`, `z-index: 9998`). Displayed above footer, below permission overlay. Maximum 3 simultaneous toasts (FIFO — oldest removed if exceeded).

## Mockup

```
                               ┌─ Toast (360px) ──────────────────┐
                               │ ⚠  Doom loop detected            │
                               │    Agent: researcher             │
                               │                              [✕] │
                               └──────────────────────────────────┘
                               ┌─ Toast ──────────────────────────┐
                               │ ♥  Heartbeat alert               │
                               │    Agent message...  [View]      │
                               │                              [✕] │
                               └──────────────────────────────────┘
```

## Alert Types

| Event Type | Variant | Icon | Title | Persistent |
|---|---|---|---|---|
| `tool.doom_loop` | warning | ⚠ | "Doom loop detected" | Yes |
| `heartbeat.alert` | warning | ♥ | "Heartbeat alert" | Yes |
| `provider.failover` | info | ↺ | "Provider failover" | No (8s) |
| `provider.auth_failed` | error | ✕ | "Provider auth failed" | Yes |
| `llm.chunk_timeout` | warning | ⏱ | "LLM chunk timeout" | No (8s) |
| `agent.timeout` | error | ⏱ | "Agent timeout" | Yes |

## Design

| Element | Description |
|---|---|
| **Left border** | 3px colored by variant (amber/red/cyan) |
| **Icon** | Colored by variant |
| **Title** | `font-size: 12px`, `font-weight: 700`, `--text-primary` |
| **Body** | `font-size: 11px`, `--text-secondary`, truncated with ellipsis |
| **[View]** | Amber outline button. Visible only for `heartbeat.alert`. Emit `navigate-to-session { sessionId, slug }`. |
| **[✕]** | Dismiss button muted → primary on hover. |
| **Animation** | `slide-in`: translateX(20px) → 0, opacity 0 → 1, 0.2s ease-out. |

## Public API

`addAlert(event: { type, payload, slug? })` — called from `app.ts` on receiving bus WebSocket messages.
