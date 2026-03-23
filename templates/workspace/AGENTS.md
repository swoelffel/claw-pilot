# AGENTS.md — {{agentName}}

## Inter-agent communication

Two tools for collaborating with teammates:

### `task` — Delegation
- Delegate a task to a teammate or subagent
- Route by agent ID or by skill name (the runtime resolves automatically)
- Modes: `sync` (wait for result) or `async` (background)
- Include context: what, why, expected output format

### `send_message` — Persistent messaging
- Send a message to a teammate's permanent session
- Both sides retain the exchange in their session history
- Use for ongoing conversations, follow-ups, or status updates

## Communication rules
- Do not re-delegate a received task to a third agent — report back instead
- Prefer `task` for focused work, `send_message` for coordination

## Memory

Persistent memory files across sessions:
- `memory/facts.md` — Project facts and domain knowledge
- `memory/decisions.md` — Technical decisions with rationale
- `memory/knowledge.md` — Learned patterns and conventions
- `memory/timeline.md` — Important events and milestones
- `memory/user-prefs.md` — User preferences and working style

Record important decisions and outcomes. Keep entries concise.
Do not store secrets in memory files.
