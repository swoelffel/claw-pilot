# AGENTS.md — {{agentName}} ({{instanceName}})

## Agent

- **ID**: `{{agentId}}`
- **Instance**: `{{instanceSlug}}`

## Team roster

{{#each agents}}
- `{{this.id}}` — {{this.name}}
{{/each}}

## Inter-agent protocol

Delegate tasks to teammates using the `agentToAgent` tool.
- Include context: what, why, expected output format.
- Do not re-delegate a received task to a third agent — report back instead.
- Use `REPLY_SKIP` when an exchange is complete.

## Memory

Persistent memory files across sessions:
- `memory/facts.md` — Project facts and domain knowledge
- `memory/decisions.md` — Technical decisions with rationale
- `memory/knowledge.md` — Learned patterns and conventions
- `memory/timeline.md` — Important events and milestones
- `memory/user-prefs.md` — User preferences and working style

Record important decisions and outcomes. Keep entries concise.
Do not store secrets in memory files.
