# Component — Flow Sessions (`cp-flow-sessions`)

> **Source**: `ui/src/components/flow-sessions.ts`
> **Route**: `#/instances/:slug/flows/:flowId/sessions`

Run-centric master/detail view for a single flow. Left panel lists runs (paged); right panel renders the steps of the selected run as accordions with lazy-loaded message bodies.

## Mockup

```
+-- header --------------------------------------------------+
|  <- Back   <flow name>                                     |
+-- two columns ---------------------------------------------+
| Runs (left, paged)        | Run #42 — completed             |
|  #42  completed  2m       |  +- step.research [done]  v --+ |
|  #41  failed     5m       |  |  msgs (lazy)               | |
|  #40  running    --       |  +-- step.draft [done]   v ---+ |
|  ...                      |  |  msgs (lazy)               | |
| [Load more]               |  +-- step.publish [running]  v+ |
+------------------------------------------------------------+
```

## Props

| Property | Type | Description |
|---|---|---|
| `slug` | `string` | Instance slug |
| `flowId` | `number` | Flow definition id |

## Behaviors

- Paged runs list (`PAGE_SIZE = 20`) via `fetchFlowRuns(slug, flowId)`.
- Run selection loads details via `getFlowRun(slug, runId)`.
- Per-step message stream lazy-loaded (`MSG_PAGE_SIZE = 50`) via `fetchSessionMessages(slug, sessionId)`.
- Live updates: subscribes to `getRuntimeChatStreamUrl(slug, sessionId)` SSE for the active step.

## Status colors

Shared `statusColor()` helper for both runs and step runs:

| Status | Token |
|---|---|
| `pending` | `--text-muted` |
| `running` | `--state-info` |
| `completed` | `--state-running` |
| `failed` | `--state-error` |
| `cancelled` | `--state-warning` |
| `skipped` | `--text-secondary` |

## Helpers

- `fmtDate(iso)` — short locale date+time.
- `fmtDuration(start, end)` — `Nms` / `Ns` / `Nm Ms`.
- `fmtCost(usd)` — `$0.00` / `$0.0042` / `$1.23`.

## Related

- Sibling: [screen-flow-list.md](../ux-screens/screen-flow-list.md), [screen-flow-run-detail.md](../ux-screens/screen-flow-run-detail.md).
- Reached from `cp-flow-list` row click on the "Sessions" affordance.

---

*Since v0.79+ (FLOW sessions UI)*
