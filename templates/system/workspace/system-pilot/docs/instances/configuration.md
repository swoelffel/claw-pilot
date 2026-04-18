# Instance Configuration

All instance settings are stored in the `instances.runtime_config_json` column
in the database. Configuration is managed entirely through the database and API,
not through files on disk. Most configuration changes are hot-reloaded without
requiring an instance restart.

## Configuration Storage

| Detail | Value |
|-----------------|---------------------------------------------------------------|
| Storage column | `instances.runtime_config_json` |
| Format | JSON object |
| Validation | Zod schemas enforce structure and types |
| Persistence | SQLite database (registry.db) |

## Viewing Configuration

```
GET /api/instances/:slug/config
```

Returns the full runtime configuration object for the instance.

## Modifying Configuration

```
PATCH /api/instances/:slug/config
Content-Type: application/json

{
  "model": "claude-sonnet-4-20250514"
}
```

Only the fields included in the PATCH body are updated; all other fields
remain unchanged. The request body is validated against Zod schemas before
being applied. Invalid patches are rejected with descriptive error messages.

### Hot Reload

Most configuration changes take effect immediately without restarting the
instance. The runtime detects config patches and reloads affected subsystems
dynamically.

| Change type | Restart required |
|----------------------------|------------------|
| Model or provider change | No |
| Agent parameter update | No |
| MCP server addition/removal| No |
| Permission rule change | No |
| Telegram token change | Yes |

## Configuration Sections

### Provider and Model

| Field | Type | Description |
|-------------------|--------|-----------------------------------------------|
| `provider_id` | string | AI provider identifier (e.g., `anthropic`) |
| `model` | string | Primary model ID for the instance |
| `fallback_models` | array | Ordered list of fallback model IDs |
| `auth_profile` | string | Named API key profile for authentication |

The provider catalog is available at:

```
GET /api/providers
```

This returns all configured AI providers with their supported models,
pricing information, and capability metadata.

### Agents

The agents section defines one or more agents for the instance:

| Field | Type | Description |
|----------------|--------|-----------------------------------------------|
| `id` | string | Unique agent identifier within the instance |
| `name` | string | Human-readable agent display name |
| `toolProfile` | string | Tool profile controlling available tools |
| `archetype` | string | Agent archetype (e.g., `coder`, `researcher`) |
| `persistence` | string | Session persistence mode |
| `systemPrompt` | string | Custom system prompt override |
| `model` | string | Agent-specific model override (optional) |

Each instance has at least one primary agent. Additional agents act as
subagents available for delegation via A2A (agent-to-agent) protocol.

### Channels

| Channel | Configuration | Notes |
|------------|---------------------------------------|-------------------------------|
| `web-chat` | Always enabled | No configuration needed |
| `telegram` | `{ "enabled": true, "token": "..." }` | Requires bot token from BotFather |

Web chat is always active for every instance. Telegram requires explicit
configuration with a valid bot token.

### MCP Servers

MCP (Model Context Protocol) servers extend agent capabilities by providing
additional tools and resources.

| Field | Type | Description |
|-----------|--------|-----------------------------------------------|
| `name` | string | Server display name |
| `type` | string | Transport type: `stdio` or `http` |
| `command` | string | Executable command (stdio only) |
| `args` | array | Command arguments (stdio only) |
| `url` | string | Server URL (http only) |
| `env` | object | Environment variables passed to the server |

Example MCP server configuration:

```json
{
  "mcpServers": [
    {
      "name": "filesystem",
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-fs"],
      "env": { "ROOT_DIR": "/data/workspace" }
    },
    {
      "name": "remote-tools",
      "type": "http",
      "url": "https://tools.example.com/mcp"
    }
  ]
}
```

### Permissions

Permission rules control which operations agents can perform without
explicit user approval.

| Field | Type | Description |
|-----------|--------|-----------------------------------------------|
| `pattern` | string | Glob pattern matching tool or resource names |
| `action` | string | `allow`, `deny`, or `ask` |

| Action | Behavior |
|---------|-------------------------------------------------------------|
| `allow` | Tool call proceeds automatically |
| `deny` | Tool call is blocked; agent receives denial message |
| `ask` | Tool call is paused; user prompted to approve or reject |

Permission rules are evaluated in order; the first matching rule wins. If
no rule matches, the default action applies (configurable, typically `ask`).

## Dashboard Settings View

The dashboard provides a graphical Settings view for each instance, organized
into tabs corresponding to the configuration sections above:

| Tab | Configures |
|---------------|-----------------------------------------------|
| General | Provider, model, fallback models, auth profile |
| Agents | Agent list, archetypes, tool profiles, prompts |
| Channels | Telegram bot token and pairing management |
| MCP Servers | Server list with add, edit, delete operations |
| Permissions | Permission rule editor with drag-to-reorder |
| Budgets | Budget creation and management |

All changes made through the dashboard are applied via the same PATCH API
and benefit from the same Zod validation and hot reload behavior.

## Notes

- Configuration is instance-scoped; each instance maintains its own
  independent configuration.
- The `runtime_config_json` column stores the canonical configuration.
  There are no configuration files to synchronize.
- Config patches are atomic: either all fields in a patch are applied
  or none are (validation failure rolls back the entire patch).
- Historical configuration changes are not versioned by default; use
  budget audit events or instance logs for change tracking.

*ClawPilot v0.74.1*
