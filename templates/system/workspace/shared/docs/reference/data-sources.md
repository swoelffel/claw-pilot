# Canonical Data Sources

Reviewed against Community 0.84.13, schema 58. This is a bounded operational map, not a full schema dump.

## Pick the right source

Use the actual cp_* tools first. Delegate analytical SELECT queries to **analyst** through the task tool; delegate authorized mutations to **ops**. The pilot's tool set is read-only. Do not invent an API-shaped tool name when no tool exists.

| Question | Canonical source | Safe starting point |
|---|---|---|
| Instances and agents | instances; agents.config_json | cp_list_instances, cp_get_instance, cp_list_agents |
| Flow definitions and results | rt_flow_definitions, rt_flow_runs, rt_flow_step_runs | cp_list_flows; Flows UI; analyst for selected metadata |
| Trigger settings and admissions | rt_flow_triggers, rt_flow_trigger_runs | Triggers UI; instance-scoped trigger API |
| Requests and execution attempts | rt_requests, rt_executions, rt_execution_events | Requests UI and instance request/execution APIs |
| Sessions and messages | rt_sessions, rt_messages, rt_parts | Authorized chat/history API; analyst only for the requested scope |
| Costs | Recorded usage and cost rows | cp_instance_costs for one instance; Costs UI |
| Workspace knowledge | agent_files, instance_shared_files and managed workspace files | ws_list_files, ws_search_files |
| Structured skills | skills, skill_files, agent_skills | Instance Settings / Skills |
| Permissions | Runtime tool rules and the installed permission checker | Authenticated permission inspection; do not infer grants from a role label |
| Secret values | SecretProvider; named keys are stored encrypted | Metadata/IDs only; dedicated authorized secret controls |

Configuration and persisted runtime state generally live in registry.db. That does **not** make every setting, secret or observation a safe SQL query. Live health comes from health/status checks; a PID or old running row alone is not proof of activity.

## Avoid misleading or sensitive artifacts

- runtime.json is a legacy/derived snapshot, not the authoritative configuration.
- SOUL.md and HEARTBEAT.md are agent inputs, not evidence of a completed operation or the current heartbeat schedule.
- SecretProvider's default environment provider uses the global state-directory .env file as well as the process environment. Never read, print or search it to answer a secret question. Do not extract credentials from config or runtime dumps.
- Query explicit, necessary metadata columns with LIMIT. Never return session tokens, password material, secret-bearing configuration or unrelated conversations. The SQL tool's masking is not a comprehensive secret or access-control guarantee.

## Discovery and interpretation

Read `@shared/docs/reference/system-tools.md` for real tool names and arguments. Use ws_list_files with dir @shared/docs/reference, or ws_search_files with a specific topic. A REST route is not automatically a cp_* tool. If an operation has no authorized tool, direct the user to its supported UI/API or ask an administrator; do not bypass the boundary with SQL or filesystem edits.

Persisted success, delivered output and human acceptance are different facts. Report the identity, observed state and remaining uncertainty separately. Do not repair an old running row merely to make monitoring look healthy.
