# System Tools and Delegation

Reviewed against Community 0.84.13. cp_* tools are provided by the system-tools plugin in cp-system, not by an external MCP server. Tool visibility is scoped by agent identity. Visibility does not authorize every user request or imply the same rights on a REST route.

| Agent | Tool scope | Responsibility |
|---|---|---|
| system-pilot | Eight query tools below | Explain, inspect simple state, coordinate; delegate changes |
| analyst | Query tools plus cp_query_db | Read-only analysis, scoped metadata queries |
| ops | Management tools plus query tools; no cp_query_db | Execute explicitly authorized configuration/lifecycle work |

## Query tools

| Tool | Arguments |
|---|---|
| cp_list_instances | {} |
| cp_get_instance | slug |
| cp_list_agents | slug |
| cp_list_blueprints | {} |
| cp_list_flows | slug |
| cp_list_named_keys | {} |
| cp_system_health | {} |
| cp_instance_costs | slug; reports the current 30-day summary, no since/until arguments |

## Management tools (ops)

| Tool | Required arguments | Optional arguments / constraints |
|---|---|---|
| cp_create_instance | slug, defaultModel, namedKeyId | displayName; agents with id/name/isDefault |
| cp_delete_instance | slug | Destructive; validate scope and preconditions |
| cp_start_instance | slug | Check resulting health |
| cp_stop_instance | slug | Do not stop cp-system |
| cp_restart_instance | slug | Interruption; do not restart cp-system through a conversational workaround |
| cp_update_instance_config | slug, patch | Partial runtime config patch; may restart a running instance |
| cp_create_blueprint | name, sourceSlug | description; copies an existing instance's agents |
| cp_delete_blueprint | id | Check references and scope |
| cp_create_flow | slug, name, steps | description; steps contain id, agentId, prompt and optional dependsOn |
| cp_run_flow | slug, flowId | No inputs or vars parameter in this tool; use the supported REST/UI contract if run inputs are needed |
| cp_delete_flow | slug, flowId | Destructive; inspect first |
| cp_create_named_key | name, providerId, apiKey, defaultModel | baseUrl; prefer the secure settings form for credential entry, never echo values |
| cp_delete_named_key | id | Confirm authorization and dependencies |

## Analyst SQL

cp_query_db accepts sql and optional limit. It allows SELECT queries, not mutations. Use explicit columns and the minimum scope; never rely on its limited masking to protect arbitrary secrets. Prefer query tools, and consult `@shared/docs/reference/data-sources.md` first.

Do not translate API paths into invented tool names. Triggers, skills, request recovery and permission administration have supported UI/API operations but no corresponding cp_* management tool in this release. Do not simulate them through database writes. The pilot can explain the procedure and guide an authorized user.
