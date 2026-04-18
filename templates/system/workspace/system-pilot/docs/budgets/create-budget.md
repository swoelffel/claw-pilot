# Creating and Managing Budgets

Budgets enforce spending limits on AI usage within a ClawPilot instance. Each budget
targets either the entire instance or a specific agent, preventing runaway costs by
capping LLM expenditure in US dollars. Budgets take effect immediately after creation.

## Budget Scope

| Scope | Description | scope_id required |
|------------|------------------------------------------------------|-------------------|
| `instance` | Caps total spending across all agents in the instance | No |
| `agent` | Caps spending for a single agent | Yes (agent ID) |

## Required and Optional Fields

| Field | Type | Required | Default | Description |
|----------------------|---------|----------|---------|----------------------------------------------|
| `name` | string | Yes | -- | Human-readable budget label |
| `scope` | string | Yes | -- | `"instance"` or `"agent"` |
| `limit_usd` | decimal | Yes | -- | Maximum spend in US dollars |
| `scope_id` | string | No* | -- | Agent ID when scope is `agent` |
| `period` | string | No | `total` | `daily`, `weekly`, `monthly`, or `total` |
| `soft_threshold_pct` | integer | No | `80` | Alert threshold percentage (0-100) |

*Required when `scope` is `"agent"`.

## Creating a Budget via Dashboard

1. Open the instance in the dashboard.
2. Navigate to **Settings > Budget Settings**.
3. Click **Add Budget**.
4. Fill in the budget name, scope, limit, period, and optional alert threshold.
5. Save. The budget activates immediately.

## Creating a Budget via API

Send a POST request with the budget definition:

```
POST /api/instances/:slug/budgets
Content-Type: application/json

{
  "name": "Monthly agent cap",
  "scope": "agent",
  "scope_id": "research-agent",
  "limit_usd": 25.00,
  "period": "monthly",
  "soft_threshold_pct": 75
}
```

A successful response returns the created budget object with its generated `id`.

## Listing Budgets

```
GET /api/instances/:slug/budgets
```

Returns an array of all budgets configured for the instance, including both
instance-scoped and agent-scoped budgets.

## Retrieving a Single Budget

```
GET /api/instances/:slug/budgets/:id
```

Returns the full budget object including current `spent_usd`, status, and
configuration fields.

## Updating a Budget

```
PATCH /api/instances/:slug/budgets/:id
Content-Type: application/json

{
  "limit_usd": 50.00,
  "soft_threshold_pct": 90
}
```

Only the fields included in the request body are modified. The budget ID, scope,
and scope_id cannot be changed after creation.

## Deleting a Budget

```
DELETE /api/instances/:slug/budgets/:id
```

Removes the budget. Any spending already tracked remains in cost history, but
enforcement stops immediately.

## Budget Periods

| Period | Behavior |
|-----------|--------------------------------------------------------------|
| `total` | Lifetime cap; spending accumulates without automatic reset |
| `daily` | Resets spent amount at midnight UTC each day |
| `weekly` | Resets spent amount at midnight UTC each Monday |
| `monthly` | Resets spent amount at midnight UTC on the 1st of each month |

## Notes

- Budgets are validated on creation: `limit_usd` must be positive, `scope` must
  be a recognized value, and `scope_id` must reference an existing agent when
  scope is `agent`.
- Multiple budgets can coexist for the same scope. The most restrictive limit
  applies first.
- Budget enforcement is real-time: each LLM call checks applicable budgets
  before execution.

*ClawPilot v0.74.1*
