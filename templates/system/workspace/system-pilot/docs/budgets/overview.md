# Budget Enforcement

Budget enforcement controls AI spending with configurable soft and hard limits. Budgets can be scoped to an entire instance (all agents) or a specific agent. The system monitors token costs in real time and takes action when thresholds are reached — sending alerts at the soft limit and blocking LLM calls at the hard limit.

## Budget Fields

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | string | yes | — | Human-readable budget name |
| `scope` | enum | yes | — | `instance` or `agent` |
| `scope_id` | string | yes | — | Instance slug or agent ID |
| `limit_usd` | number | yes | — | Maximum spending amount in USD |
| `period` | enum | yes | — | `daily`, `weekly`, `monthly`, or `total` |
| `soft_threshold_pct` | number | no | `80` | Percentage of limit that triggers a soft alert |

## Scope Types

| Scope | Applies To | Example |
|---|---|---|
| `instance` | All agents within the instance | Limit the entire "dev-team" instance to $50/month |
| `agent` | A single agent | Limit "code-reviewer" to $10/day |

Agent-scoped budgets are checked in addition to instance-scoped budgets. Both must have remaining capacity for an LLM call to proceed.

## Budget Periods

| Period | Reset Behavior |
|---|---|
| `daily` | Resets at midnight UTC each day |
| `weekly` | Resets at midnight UTC each Monday |
| `monthly` | Resets at midnight UTC on the first of each month |
| `total` | Never resets — cumulative lifetime limit |

## Soft Alerts

When spending reaches the `soft_threshold_pct` (default 80%) of `limit_usd`, the system generates a notification. Soft alerts are informational — they do not block agent execution. Alerts are delivered through:

- Dashboard notification inbox
- Telegram channel (if configured for the instance)

For example, a budget with `limit_usd: 100` and `soft_threshold_pct: 80` triggers a soft alert at $80 spent.

## Hard Stop

When spending reaches 100% of `limit_usd`, the budget enforcement module blocks all LLM calls for the affected scope. Agents receive an error indicating the budget is exhausted. The hard stop prevents cost overruns.

Blocked agents remain in their current state — sessions are not terminated. Once the budget is reset, extended, or the period rolls over, agents resume normal operation.

## Budget Check Module

Budget enforcement runs in the session middleware pipeline. The `budget-check` module executes at two points:

| Phase | Action |
|---|---|
| **Pre-LLM call** | Checks remaining budget before sending the request. Blocks if exhausted. |
| **Post-LLM call** | Records actual token cost against the budget. May trigger soft alert. |

This dual-phase approach ensures no LLM call starts when the budget is already exhausted and accurately tracks spending after each call.

## Temporary Override

Grant a temporary +20% budget extension when the hard limit is reached but work must continue:

```
POST /api/instances/:slug/budgets/:id/override
```

The override increases the effective limit by 20% of the original `limit_usd`. Only one override can be active per budget. Overrides persist until the next period reset.

## Manual Reset

Reset the spent amount to zero without waiting for the period to roll over:

```
POST /api/instances/:slug/budgets/:id/reset
```

This is useful when a runaway agent consumed budget on a failed task and you want to reclaim the spent amount.

## Audit Events

All budget-related events are tracked in the `rt_budget_events` table:

| Event Type | Description |
|---|---|
| `budget_created` | New budget was configured |
| `soft_alert` | Spending reached the soft threshold |
| `hard_stop` | Spending reached the limit, LLM calls blocked |
| `override_granted` | Temporary +20% extension applied |
| `budget_reset` | Spent amount manually reset to zero |
| `period_reset` | Automatic reset at period boundary |

## Creating a Budget

```
POST /api/instances/:slug/budgets
Content-Type: application/json

{
  "name": "Monthly dev-team limit",
  "scope": "instance",
  "scope_id": "dev-team",
  "limit_usd": 100,
  "period": "monthly",
  "soft_threshold_pct": 75
}
```

## Listing Budgets

```
GET /api/instances/:slug/budgets
```

Returns all budgets for the instance, including current `spent_usd`, remaining amount, and whether a soft alert or hard stop is active.

*ClawPilot v0.74.1*
