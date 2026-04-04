# Component — Budget Alert Banner (`cp-budget-alert-banner`)

> **Source**: `ui/src/components/budget-alert-banner.ts`
> **Used in**: All instance pages (pilot, builder, costs, settings, activity)

Displays warning and error banners at the top of instance pages when budgets approach or exceed their limits.

## Mockup — Soft Alert (warning)

```
┌─────────────────────────────────────────────────────────────────────┐
│ ⚠ build-agent has reached 99% of budget ($14.80/$15.00)            │
│                                                        [Dismiss]    │
└─────────────────────────────────────────────────────────────────────┘
```

## Mockup — Hard Stop (exceeded)

```
┌─────────────────────────────────────────────────────────────────────┐
│ 🛑 build-agent budget exceeded — agent paused ($15.00/$15.00)       │
│                                          [Override +20%] [Dismiss]  │
└─────────────────────────────────────────────────────────────────────┘
```

## Styling

| Level | Background | Border-left | Text color |
|---|---|---|---|
| **warning** | `rgba(245,158,11,0.1)` | `3px solid --state-warning` | `--state-warning` |
| **exceeded** | `rgba(239,68,68,0.1)` | `3px solid --state-error` | `--state-error` |

## Behavior

| Aspect | Description |
|---|---|
| **Data source** | Polls `GET /api/instances/:slug/budgets` every 60 seconds |
| **Max visible** | 3 banners (most critical first), scroll if more |
| **Override button** | Calls `POST /api/instances/:slug/budgets/:id/override`, then refreshes |
| **Dismiss** | Hides banner for the current browser session (reappears on page reload) |
| **Agent label** | Shows `scopeId` for agent budgets, "instance" for instance budgets |

## Props

| Property | Type | Description |
|---|---|---|
| `slug` | `string` | Instance slug — required for API calls |
