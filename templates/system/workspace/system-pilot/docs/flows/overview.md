# Flows and Outcomes

Reviewed against Community 0.84.13. A flow is a directed acyclic graph of agent missions. Independent ready steps can run concurrently; dependsOn controls dependencies. Definitions, runs and step results are separate records.

| Concept | Meaning |
|---|---|
| Definition | Instance-scoped name, steps and configuration |
| Step | Agent mission with prompt, dependencies and applicable limits |
| SITREP | Step completion report with outcome, summary and keyFindings |
| Run | One execution of the definition |
| Trigger | Separate cron/incoming-webhook resource attached to a flow |

## Dependency and result rules

A normal pending step becomes ready after suitable dependencies complete. Non-success outcomes can skip dependents. continueOnFailure on the **downstream** step permits it to run after terminal unsuccessful dependencies; placing it on a failed ancestor does not grant permission to all descendants. The current REST step schema does not preserve that flag, so do not claim an API-created flow configured it successfully; see [Creation](create-flow.md).

Run statuses are pending, running, completed, failed and cancelled. Completed is possible with success/stopped outcomes and no failed steps. A partial SITREP contributes to failed run status even if useful output exists or some downstream work continued. stopped is an intentional gate and is not by itself unsuccessful. Cancellation status is not proof all running work stopped.

Definitions are stored in rt_flow_definitions, runs in rt_flow_runs, and step records in rt_flow_step_runs. Technical run status is different from delivery, human acceptance and business usefulness.

Use [Running a flow](run-flow.md), [Triggers](triggers.md) and [Workflow governance](governance.md) for current API and unattended eligibility. Inspect installed [Built-in flows](built-in-flows.md) rather than assuming historical agent references remain executable.
