# Budget Alerts, Overrides and Reconciliation

Reviewed against Community 0.84.13. Inspect the current limitUsd, spentUsd and applicable thresholds before suggesting a spending decision. Soft warnings and hard blocking are different states; use returned events/errors rather than assuming a notification was delivered to every channel.

## Override

POST /api/instances/:slug/budgets/:id/override

The endpoint multiplies the **current** stored limit by 1 + overridePct. With the default 0.2, a $100 limit becomes $120, then $144 after another override. It is not limited to one active override and does not automatically revert to the original limit at period reset.

Obtain explicit authorization for the resulting limit and explain that repeated requests compound. Do not retry an uncertain override blindly. If the owner wants the previous limit restored, use an explicitly authorized supported budget update with that concrete value; do not assume reset/reconcile restores it.

## Period changes and reconciliation

Monthly reset zeroes recorded period spending and advances periodStart; it does not refund provider costs or undo an increased limit. There is no public budgets/:id/reset endpoint in this release.

POST /api/instances/:slug/budgets/:id/reconcile compares and can correct recorded spending against its source records. This is a mutation, not a harmless refresh or an authorization to erase costs. Review the reported drift/corrected result and preserve evidence.

GET /api/instances/:slug/budgets/:id/events and GET /api/instances/:slug/budgets/events provide authorized event histories. A recorded event and a delivered alert are separate facts.

Budget changes do not grant tool/secret access or bypass workflow governance. See [Enforcement](overview.md) and [Cost accounting](../costs/cost-tracking.md).
