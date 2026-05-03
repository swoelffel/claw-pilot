# Component — Instance Dashboard (`cp-instance-dashboard`)

> **Source**: `ui/src/components/instance-dashboard.ts`
> **Route**: `#/instances/:slug/dashboard`

Synthetic overview of one instance: KPIs, agents, tasks, costs, flows, heartbeat, sessions, memory. Self-contained widget grid with auto-refresh (`AUTO_REFRESH_MS = 5 min`). Embeds `cp-dashboard-pilot` as a side chat.

## Mockup

```
+-- KPIs row -------------------------------------------+
| Cost (7d) | Tokens (7d) | Active sessions | Agents    |
+-- widget grid ----------------------------------------+
| Agents widget        | Tasks widget                   |
| Flows widget         | Heartbeat widget               |
|   [Triggers ->]      |                                |
| Memory widget        | Events stream                   |
+-------------------------------------------------------+
| cp-dashboard-pilot (sidebar slot)                     |
+-------------------------------------------------------+
```

## Period selector

`type Period = "7d" | "30d" | "all"` — applied to cost/token aggregates.

## Data sources (parallel fetch)

- `fetchCostSummary` + `fetchDailyCosts` — top-line KPIs and sparkline.
- `fetchBuilderData` — agents widget.
- `fetchTasks` — tasks widget (counts by status).
- `fetchRtEvents` — events stream tail.
- `listFlows` — flows widget; renders a `Triggers →` shortcut to `#/instances/:slug/triggers` (added in PR #174).
- `fetchHeartbeatHeatmap` — agent activity widget.
- `fetchRuntimeSessions` — active sessions count.
- `fetchMemoryAgents` — memory widget.

## Helpers

- `fmtUsd(v)` — adaptive `$0.00` / `$0.003` / `$0.0042`.
- `fmtTokens(v)` — `1.2k` / `3.4M`.
- `fmtDuration`, `fmtBytes` — compact formatters.
- `archetypeColor(archetype)` — agent stripe color.
- `levelColor(level)` — events tint (`info`/`warn`/`error`).

## Navigation

Each widget exposes a `widget-link` (e.g. "Tasks →", "Flows →", "Triggers →", "Memory →") that emits `navigate { view, slug }` to drive the host router.

## Related

- Sidebar chat: [comp-dashboard-pilot.md](comp-dashboard-pilot.md).
- Triggers: [screen-triggers.md](../ux-screens/screen-triggers.md).

---

*Since v0.74+ — "Triggers →" link added 2026-04-22 (PR #174).*
