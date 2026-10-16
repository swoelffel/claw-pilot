<!-- cspell:ignore cooldowns -->

# MCP Servers in Instance Settings

Reviewed against Community 0.84.13. Open /instances/:slug/settings and choose MCP. The settings API manages server configuration and the instance MCP enabled switch.

| Method | Path | Purpose |
|---|---|---|
| GET / POST | /api/instances/:slug/mcp/servers | List / create configuration |
| PATCH / DELETE | /api/instances/:slug/mcp/servers/:serverId | Update / remove a configured server |
| PATCH | /api/instances/:slug/mcp/enabled | Enable or disable instance MCP |
| GET | /api/instances/:slug/mcp/tools | Inspect available tools |
| GET | /api/instances/:slug/mcp/status | Inspect runtime connection state |

Inspect the existing server and execution identity before editing. Use approved endpoints and credentials; masked environment/header values in responses are not reusable plaintext. Do not copy masks back as new credentials or print saved settings in a conversation. Use the supported editor's preservation semantics when updating non-secret fields.

Configured MCP tools can be available in chat and flow steps through the runtime registry, subject to configuration/permissions. A saved server definition is not proof of a live authorized connection or a successful business call. Check status, available tools and a bounded permitted read before claiming success.

MCP cancellation does not prove a remote operation stopped or reversed side effects. Respect resource circuit-breaker cooldowns, authentication errors and authorization failures. See [Resource health](../monitoring/resource-health.md).
