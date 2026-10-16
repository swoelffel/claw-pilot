# Running and Inspecting a Flow

Reviewed against Community 0.84.13. A flow run is asynchronous; starting it returns a numeric runId, not a completed business outcome.

## Start and inputs

POST /api/instances/:slug/flows/:id/run

An optional JSON body can contain `{ "vars": { "ticket_id": "EXAMPLE-42" } }`. The successful start response is `{ "runId": 123 }`, with the real numeric ID supplied by the service. The cp_run_flow tool instead accepts only slug/flowId and cannot carry vars in this release.

Briefings resolve `{{vars.ticket_id}}` and upstream outputs such as `{{steps.investigate.summary}}` at dispatch time. Unknown paths stay verbatim. Tool arguments are not templated by this feature. Configured MCP tools are passed through the runtime registry, subject to actual settings and permission.

## Inspect and cancel

GET /api/instances/:slug/flow-runs/:runId

The detail response is `{ "run": { ... }, "steps": [ ... ] }`. Inspect persisted step status, SITREP, text, token and cost fields; do not expect a fabricated flat response. The UI path /instances/:slug/flows/runs/:runId is different from this API path.

POST /api/instances/:slug/flow-runs/:runId/cancel

This endpoint marks pending steps skipped and changes the run to cancelled. It does **not** propagate abort to already-running steps in this release. A cancelled database status does not guarantee execution has stopped, and external side effects may continue. Inspect active steps and the external target before repeating work or assuming a safe maintenance window.

## Outcomes and dependencies

Each step calls complete_step with an outcome, summary and keyFindings. success permits normal downstream execution. failure or partial can skip ordinary dependents; a downstream step whose persisted definition has continueOnFailure true can run after unsuccessful dependencies. The flag belongs to that downstream step, not to the failed ancestor.

The run is failed when a step fails or returns partial/malformed completion. A partial result can remain useful, but is not a completed technical run. stopped is an intentional gate and does not by itself make the run fail. See [Flow concepts](overview.md) and [Creation](create-flow.md) for the current API limitation on continueOnFailure.

## Limits, timeouts and retries

Step maxSteps defaults to 50. request_step_extension can request increments of 20 up to the effective hard cap min(maxSteps × 2, 200), which is 100 with the default soft cap. An extension is a tool decision, not an unconditional promise to reach 200.

The step definition field is timeoutMs (1,000–600,000 milliseconds in the API); execution defaults to 300,000 ms when absent. Do not use a field named timeout. Although retries can be accepted/stored, the current flow engine does not consume it in an automatic retry loop. Do not promise that setting retries re-executes failed steps.

A provider/tool timeout, flow cancellation, UI disconnect and unknown side-effect outcome are different conditions. See [Recovery and timeouts](../monitoring/recovery-and-timeouts.md) before resubmission. For cron/webhooks, also inspect [Workflow governance](governance.md) and [Trigger history](triggers.md).
