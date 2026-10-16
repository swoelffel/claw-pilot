# Tools, Profiles and Runtime Boundaries

Reviewed against Community 0.84.13. Actual tools depend on the configured profile, allowed/custom tools, runtime permissions, installed plugins, MCP connections and execution context. A profile name is not an authorization to perform every requested action.

| Profile | Built-in intent |
|---|---|
| sentinel | Question tool only before scoped plugin additions |
| pilot | Questions, web fetch, messaging/delegation, task board and artifacts/files |
| executor | File/shell/search, questions, todo/skills, messaging, task board and artifacts/files |
| manager | Executor-style surface plus delegation |

Use the returned tool definitions for exact argument schemas. The runtime can add scoped system tools, workspace tools, MCP tools and flow-step-only tools; it also filters tools according to the current agent and context. Do not describe unsupported minimal/coding/full profile names as the current built-in profiles.

## Additional surfaces

- cp-system system tools: see `@shared/docs/reference/system-tools.md`. Pilot queries, ops mutations and analyst SQL are different scopes.
- Workspace tools: [Workspace boundaries](../agents/workspace-files.md). Discovery is agent-private plus instance-shared; write/delete require applicable scope and protected-path/quota checks.
- Structured skills: [Skills](../agents/skills.md). Instructions do not bypass tool authorization.
- MCP: [Instance settings](../instances/mcp-servers.md). A configured server is not proof of a live authorized call.
- Flow steps receive complete_step and request_step_extension in their flow context. These are not general chat tools that the pilot can invent or call outside a step.

Tool errors can include structured resource classifications and bounded retry advice. Honor denials, cooldown and uncertain-side-effect review instead of repeatedly trying another identity. See [Resource health](../monitoring/resource-health.md) and [Recovery](../monitoring/recovery-and-timeouts.md).
