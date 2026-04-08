# Component — Budget Settings (`cp-budget-settings`)

> **Source**: `ui/src/components/budget-settings.ts`
> **Used in**: Cost Dashboard → Budgets tab (`cp-costs-dashboard`)

Budget enforcement management panel. Manages per-instance and per-agent budget limits with CRUD operations, progress bars, override actions, and an event log.

## Mockup

See [screen-costs-dashboard.md](../ux-screens/screen-costs-dashboard.md) for the full Budgets tab mockup.

## Sections

### Instance Budget

Single instance-wide budget card (at most one). Shows limit, thresholds, spent/remaining amounts, and a progress bar.

```
┌─ INSTANCE BUDGET ─────────────────────────────────────────┐
│  monthly                                    [Edit] [✕]    │
│  Limit: $50.00  Alert: 80%  Stop: 100%  Override: +20%   │
│  Spent: $32.40 / $50.00 (65%)                            │
│  ████████████████████████████████░░░░░░░░░░░░░░░░        │
│  Period: 2026-04          Remaining: $17.60               │
└───────────────────────────────────────────────────────────┘
```

If no instance budget exists: "+ Add Budget" button.

### Agent Budgets

Table of per-agent budgets with inline progress bars and override buttons.

| Column | Description |
|---|---|
| **Agent** | Agent ID (mono) |
| **Period** | `monthly` or `lifetime` |
| **Limit** | USD amount (mono) |
| **Spent** | USD + percentage (mono) |
| **Status** | Inline progress bar (80px) + status icon |
| **Actions** | Override (if exceeded), Edit, Delete buttons |

"+ Add Budget" button always visible.

### Budget History

Event log of the last 20 budget events. Scrollable (max-height 300px).

| Column | Description |
|---|---|
| **Date** | `MM-DD HH:MM` format (mono) |
| **Icon** | Event type icon: ⚠ soft_alert, ● hard_stop, ↻ reset/reconcile, ⬆ override |
| **Type** | Event type name |
| **Scope** | Agent ID or "instance" |
| **Message** | Event details or `$spent/$limit` |

## Progress Bar Colors

| Range | Color |
|---|---|
| < soft_alert_pct | `--state-running` (green) |
| soft_alert_pct to hard_stop_pct | `--state-warning` (amber) |
| >= hard_stop_pct | `--state-error` (red) |

## Create/Edit Dialog

Modal dialog (`480px max-width`) with backdrop overlay.

| Field | Type | Notes |
|---|---|---|
| **Scope** | Radio: Instance / Agent | Create only (locked on edit) |
| **Agent** | `<select>` | Shown only for agent scope |
| **Period** | Radio: Monthly / Lifetime | Create only (locked on edit) |
| **Limit (USD)** | Number input | min: 0.01, step: 0.01 |
| **Alert threshold (%)** | Number input | Default: 80 |
| **Stop threshold (%)** | Number input | Default: 100 |
| **Override increase (%)** | Number input | Default: 20 |

Actions: `[Cancel]` + `[Create Budget]` / `[Save]`.

## Data Fetching

| Endpoint | Description |
|---|---|
| `GET /api/instances/:slug/budgets` | List all budgets for instance |
| `POST /api/instances/:slug/budgets` | Create budget |
| `PUT /api/instances/:slug/budgets/:id` | Update budget thresholds/limit |
| `DELETE /api/instances/:slug/budgets/:id` | Delete budget |
| `POST /api/instances/:slug/budgets/:id/override` | Override exceeded budget (+overridePct%) |
| `GET /api/instances/:slug/budgets/events` | All budget events for instance |
| `GET /api/instances/:slug/builder` | Agent list (for agent scope dropdown) |

## Props

| Property | Type | Description |
|---|---|---|
| `slug` | `string` | Instance slug — required for all API calls |

## States

| State | Display |
|---|---|
| **Loading** | Centered "Loading budgets..." |
| **Error** | Centered error message in `--state-error` |
| **Loaded** | Instance section + Agent section + Event log |

## i18n

All strings use `msg("...", { id: "budget-*" })` prefix. 20+ keys across 6 locales.
