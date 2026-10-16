# Creating a Flow

Reviewed against Community 0.84.13. Create a definition in the instance Flows UI or the authenticated API. Referenced agents must actually exist in the target instance. A definition is different from a trigger resource and an individual run.

POST /api/instances/:slug/flows

Required fields are name and a nonempty steps array. Optional description/enabled and definition trigger metadata do not replace [Cron or incoming webhook configuration](triggers.md). The response contains a flow object with the generated numeric id. Creation starts the governed definition in DRAFT; selection/enabled does not authorize unattended execution.

| Step field | Current REST contract |
|---|---|
| id | Unique step identifier |
| agentId | Existing agent in the same instance |
| prompt | Mission text |
| dependsOn | Step ID array; empty by default |
| maxSteps | Optional 1–200; runtime default 50 |
| timeoutMs | Optional 1,000–600,000 ms; execution default 300,000 ms |
| retries | Optional 0–5 accepted/stored; no automatic flow retry loop currently consumes it |
| briefing | Optional includeLastN and extraContext |

The API validates unique IDs, valid dependencies and absence of cycles. Read returned validation errors; do not claim historical specialized error codes that the endpoint does not return. For updates use PATCH /api/instances/:slug/flows/:id and read the persisted result back.

## Inputs, MCP and outcomes

Manual REST runs accept `{ "vars": { "ticket_id": "EXAMPLE-42" } }`. Use `{{vars.ticket_id}}` and `{{steps.investigate.summary}}` in prompts/extra context. MCP tools follow the configured runtime registry and access rules. See [Running a flow](run-flow.md).

## continueOnFailure limitation

In persisted engine definitions, continueOnFailure belongs to the step that should run after an unsuccessful dependency, such as a notification/cleanup step. It does not make descendants of that step ignore its own failures.

The current REST FlowStepSchema does not preserve continueOnFailure, and cp_create_flow also lacks that argument. Do not promise an API/tool-created definition enabled this behavior, or bypass the limitation with direct DB edits. Inspect existing definitions and ask for a separately scoped functional change if this setting is required through the creation API.

For unattended use, validate/activate through [Workflow governance](governance.md). Test the intended input path and actual terminal result; no retry or rollback guarantee follows from saving a definition.
