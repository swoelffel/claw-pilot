# Component — Pilot Part: Delegation Expand (`cp-pilot-part-delegation-expand`)

> **Source**: `ui/src/components/pilot/parts/part-delegation-expand.ts`
> **Used in**: Runtime Pilot (`cp-runtime-pilot`), Home Chat (`cp-home-chat`)

Inline accordion that drills into a sub-session's full timeline on demand. Supports recursive nested drill-down: a delegation entry inside the sub-session is itself expandable.

## Mockup

```
┌─ [delegation] Asked analyst → research market data  [▸] ───────┐
│                                                                  │
│  (click to expand)                                               │
│                                                                  │
│  ┌─ Expanded sub-session ─────────────────────────────────────┐  │
│  │  [ASSISTANT] Researching market data for Q1...             │  │
│  │  [TOOL] webfetch → https://api.example.com/data            │  │
│  │  [ASSISTANT] Found 3 relevant data points...               │  │
│  │                                                             │  │
│  │  ── Summary ──────────────────────────────────────────────  │  │
│  │  3 steps · 12.4k tokens · $0.03 · 45s                     │  │
│  └─────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

## Props

| Property | Type | Description |
|---|---|---|
| `slug` | `string` | Instance slug |
| `subSessionId` | `string` | Sub-session to drill into |
| `filters` | `TimelineFilters` | Inherited from parent timeline |
| `label` | `string` | Display label for the delegation trace |

## Behavior

1. **Collapsed** (default): shows delegation label with expand chevron
2. **First click**: lazy-fetches messages via `GET /runtime/sessions/:id/messages`
3. **Expanded**: renders full sub-session timeline using `cp-pilot-message` (recursive)
4. **Summary pill**: steps count, total tokens (in+out), cost, duration

## Summary Metrics

| Metric | Format |
|---|---|
| Steps | Integer |
| Tokens | `12.4k` (formatted) |
| Cost | `$0.03` (USD) |
| Duration | `45s` or `2m15s` |

## Data Fetching

| Endpoint | Description |
|---|---|
| `GET /api/instances/:slug/runtime/sessions/:id/messages` | Lazy-loaded on first expand |

## i18n

Uses `msg("...", { id: "delegation.*" })` prefix.

---

*Since v0.71.3*
