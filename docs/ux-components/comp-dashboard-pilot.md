# Component — Dashboard Pilot (`cp-dashboard-pilot`)

> **Source**: `ui/src/components/dashboard-pilot.ts`
> **Used in**: `cp-instance-dashboard` (right column)

Mini-pilot chat sidebar embedded in the instance dashboard. Simplified version of `cp-home-chat` and `cp-runtime-pilot`: text-only SMS-style bubbles, SSE streaming, status indicator. **No** tool-call rendering, **no** reasoning panel, **no** artifact card, **no** context panel — kept lean for the dashboard sidebar slot.

## Mockup

```
+-- header (PILOT . idle) --------------+
|                                       |
|  [user]   what is the status?         |
|  [agent]  Three flows ran today...    |
|  ...                                  |
|                                       |
|  [textarea]                  [Send]   |
+---------------------------------------+
```

## Props

| Property | Type | Description |
|---|---|---|
| `slug` | `string` | Instance slug — drives session resolution. |

## Status states

`type PilotStatus = "idle" | "loading" | "sending" | "thinking" | "tool" | "streaming" | "error"`.

## Behaviors

- Resolves the permanent session via `fetchRuntimeSessions(slug)` and picks the default agent.
- Posts to `/api/instances/:slug/runtime/chat` (`postRuntimeChat`).
- Subscribes to `getRuntimeChatStreamUrl(slug)` for SSE.
- 10-second polling fallback (`POLL_INTERVAL_MS`) when SSE is interrupted.
- SSE reconnect uses exponential backoff (1s → 30s, ×2).

## Differences vs `cp-runtime-pilot`

| Feature | `cp-runtime-pilot` | `cp-dashboard-pilot` |
|---|---|---|
| Tool-call parts | rendered | hidden (text only) |
| Reasoning | rendered | hidden |
| Context panel | yes | none |
| File upload | yes | no |
| Multi-agent tabs | yes | first default agent only |

## Related

- Full pilot: [screen-runtime-pilot.md](../ux-screens/screen-runtime-pilot.md).
- Parent dashboard: [comp-instance-dashboard.md](comp-instance-dashboard.md).

---

*Since v0.78+*
