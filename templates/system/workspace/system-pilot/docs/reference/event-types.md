# Runtime Events and Audit References

Reviewed against Community 0.84.13. Runtime bus events, durable execution replay, structured observability and security audit events are different records. Do not assume one stream is a complete substitute for the others.

Use the Activity UI and authorized /api/instances/:slug/events history for runtime events. Request/execution APIs preserve identity, terminal results and ordered durable replay. Observability routes under /api/instances/:slug/observability expose authorized traces, metrics, alerts and retention metadata. Security audit events record sensitive administration without plaintext secret values.

Event families include runtime/session/message/tool/provider activity, subagent delegation, questions/permissions, heartbeats, budgets, tasks, MCP, skills and request/execution recovery. Names and payloads evolve; filter by the actual event/error code returned by the installed service rather than relying on a historical count.

For diagnosis, record the relevant request, execution, trace and session IDs, timestamp and redacted error classification. A quiet journal or a delivered result does not prove that every event persisted. Avoid copying customer payloads or credentials into reports.

The pilot's [Resource health](../monitoring/resource-health.md) and [Requests and executions](../monitoring/requests-and-executions.md) guides describe current operational entry points.
