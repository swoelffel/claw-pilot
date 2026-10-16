# Budget Enforcement and Recorded Spending

Reviewed against Community 0.84.13. Budgets apply to an instance or an agent. They check applicable spending before model work and record actual cost afterward. In-flight/partial work can incur costs; a threshold is not a guarantee of an exact maximum final invoice.

The API uses camelCase. Example POST /api/instances/:slug/budgets body:

```json
{
  "scope": "instance",
  "limitUsd": 100,
  "period": "monthly",
  "softAlertPct": 0.8,
  "hardStopPct": 1,
  "overridePct": 0.2
}
```

scope is instance or agent. scopeId is optional/nullable in the API; use the intended actual agent ID for agent scope. limitUsd is required and positive. Supported periods are monthly (default) and lifetime, not daily/weekly/total. Ratio fields use fractions: 0.8 means 80%, not 80.

Monthly spending is reset at a month boundary when the budget is checked/read through the applicable repository path. Lifetime budgets do not reset monthly. A reset does not undo provider spending or restore the previous limit after an override.

GET /api/instances/:slug/budgets lists current values such as spentUsd and limitUsd. PUT /api/instances/:slug/budgets/:id updates supported settings. Use the actual instance/action permissions; management is not a secret or tool grant.

Overrides mutate the current limit, and repeated overrides compound. See [Alerts and overrides](alerts-override.md) before approving additional spending. [Creation](create-budget.md) gives the current API field names.

Total model usage across steps drives spending; final-request context occupancy drives compaction. These are different metrics. See [Cost accounting](../costs/cost-tracking.md) and [Business outcomes](../admin/governance.md).
