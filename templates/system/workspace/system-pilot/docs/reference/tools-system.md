# System Tools Reference (cp_*)

System tools are MCP tools available exclusively within the cp-system instance. They provide programmatic control over ClawPilot infrastructure: instances, blueprints, flows, API keys, and system health.

## Instance Management

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `cp_list_instances` | List all registered instances with status, slug, and blueprint info | `status` (optional filter: running, stopped, error) |
| `cp_get_instance` | Get detailed configuration and state for a single instance | `slug` (required) |
| `cp_create_instance` | Create a new instance from a blueprint or raw configuration | `slug`, `blueprint`, `displayName`, `model`, `namedKey` |
| `cp_delete_instance` | Permanently delete an instance and its data | `slug` (required, instance must be stopped) |
| `cp_start_instance` | Start a stopped instance, initializing its runtime and session | `slug` (required) |
| `cp_stop_instance` | Gracefully stop a running instance, preserving session data | `slug` (required) |
| `cp_restart_instance` | Stop then start an instance in sequence | `slug` (required) |

## Agent Configuration

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `cp_list_agents` | List all agents across instances with their roles and status | `instanceSlug` (optional filter) |
| `cp_update_instance_config` | Update runtime configuration for an instance (model, tools, prompt mode) | `slug`, `config` (partial config object) |

## Blueprint Management

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `cp_list_blueprints` | List all available blueprints in the registry | none |
| `cp_create_blueprint` | Register a new blueprint with default configuration | `name`, `description`, `config` (model, tools, archetype) |
| `cp_delete_blueprint` | Remove a blueprint from the registry | `id` (required, no instances must reference it) |

## Flow Management

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `cp_list_flows` | List all defined flows with step count and last run status | none |
| `cp_create_flow` | Define a new multi-step flow with step dependencies | `name`, `steps` (array of step definitions) |
| `cp_run_flow` | Execute a flow, creating a new flow run | `flowId`, `inputs` (optional key-value pairs) |
| `cp_delete_flow` | Remove a flow definition and its run history | `flowId` (required) |

## Named API Key Management

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `cp_list_named_keys` | List all named API keys with provider and label (secrets masked) | none |
| `cp_create_named_key` | Store a new named API key for an LLM provider | `label`, `provider`, `apiKey`, `model` (optional default) |
| `cp_delete_named_key` | Remove a named API key from the registry | `id` (required, no instances must be using it) |

## System Operations

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `cp_system_health` | Return runtime health status: uptime, instance count, memory, event bus stats | none |
| `cp_instance_costs` | Query token usage and cost data for one or all instances | `slug` (optional), `since` (ISO date), `until` (ISO date) |
| `cp_query_db` | Execute a read-only SQL query against registry.db | `sql` (SELECT only, sensitive columns auto-masked) |

## Usage Notes

### Access Control

System tools are restricted to the **cp-system** instance. Other instances cannot call `cp_*` tools even if their tool profile is modified. This is enforced at the runtime level.

### cp_query_db Safety

The `cp_query_db` tool only accepts SELECT statements. INSERT, UPDATE, DELETE, and DDL statements are rejected. Sensitive columns (API keys, password hashes, tokens) are automatically masked in query results with `***MASKED***`.

Example queries:

```sql
-- Count running instances
SELECT COUNT(*) FROM instances WHERE status = 'running'

-- List recent flow runs
SELECT id, flow_id, status, started_at FROM flow_runs ORDER BY started_at DESC LIMIT 10

-- Check budget usage for an instance
SELECT * FROM budget_usage WHERE instance_slug = 'my-agent'
```

### Error Handling

All system tools return structured responses with:

- `success` (boolean) -- whether the operation completed
- `data` (object) -- the result payload on success
- `error` (string) -- human-readable error message on failure

Common error codes: `INSTANCE_NOT_FOUND`, `INSTANCE_RUNNING` (cannot delete), `BLUEPRINT_IN_USE`, `INVALID_SQL`, `PERMISSION_DENIED`.

### Rate Limits

System tools are subject to the same API rate limits as other endpoints: 60 requests per minute. Bulk operations (e.g., restarting all instances) should include short delays between calls.

*ClawPilot v0.74.1*
