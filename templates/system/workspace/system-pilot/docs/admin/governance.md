# Governance Foundations and Business Outcomes

Reviewed against Community 0.84.13. These capabilities provide repositories and permission-checked APIs. They are not a claim that every feature has a complete dashboard interface or that business adoption is already demonstrated.

| Area | Supported API family | Interpretation |
|---|---|---|
| Governance teams and use cases | /api/governance/teams; /api/governance/use-cases | Model ownership/use-case lifecycle; distinct from private named access teams |
| Business tasks | /api/instances/:slug/business-tasks | Track requested outcomes and subsequent reviews |
| Artifacts | /api/instances/:slug/artifacts | Govern artifact state; persisted output is not automatically approved |
| Agent versions/promotions | /api/instances/:slug/agents/:id/versions; promotions and rollback operations | Review configuration/lifecycle changes under the required permissions |
| Workflow lifecycle | /api/instances/:slug/flows/:id/validate and lifecycle | [Unattended workflow rules](../flows/governance.md) |
| Costs and adoption | /api/instances/:slug/cost-governance; /api/instances/:slug/adoption | Attribute spend and use; distinguish observations from productivity claims |

Inspect current records and supported transition rules before proposing a mutation. Obtain a concrete decision for promotion, rollback or business acceptance. Do not update lifecycle/status columns through SQL or assume a successful model response means a human approved the result.

Use request/execution/trace identity to connect work to a business task. State the measurement window, denominator and missing attribution when reporting costs or adoption. A technical success rate and an outcome usefulness rate answer different questions.
