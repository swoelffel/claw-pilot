# Creating and Managing Budgets

Reviewed against Community 0.84.13. Use the instance budget settings UI or the permission-checked API. Inspect the intended scope and remaining allowance before changing limits.

## Create

POST /api/instances/:slug/budgets

```json
{
  "scope": "instance",
  "limitUsd": 25,
  "period": "monthly",
  "softAlertPct": 0.75,
  "hardStopPct": 1,
  "overridePct": 0.2
}
```

scope and positive limitUsd are required. scopeId is the optional/nullable agent binding for agent scope. period defaults to monthly; lifetime is the other supported value. The ratios are fractions, not integer percentages. There is no required name field; do not copy database snake_case columns into API requests.

The response returns the created budget with a numeric id and camelCase metadata. GET /api/instances/:slug/budgets lists the instance's budgets. Do not assume a GET-by-ID or reset endpoint exists in this release.

## Update and remove

PUT /api/instances/:slug/budgets/:id updates limitUsd, softAlertPct, hardStopPct, overridePct or enabled. Read the actual returned state. Scope/period changes are not supported by that update schema; do not infer patch fields from a SQL row.

DELETE /api/instances/:slug/budgets/:id removes enforcement for that budget. It does not reverse spending already incurred. Both update and removal need the concrete authorization and effective resource permission.

See [Enforcement](overview.md) and [Overrides](alerts-override.md). An override is a durable increase of the current limit, not a temporary one-time allowance.
