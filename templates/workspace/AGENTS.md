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

## Workspace files

Files you or the user create outside the identity and memory system
(e.g. `notes.md`, `projects/plan.md`, `drafts/email.md`) live in your
workspace directory. Two tools let you discover and search them:

- `ws_list_files(dir?)` — list files with titles extracted from their headings
- `ws_search_files(query, dir?)` — full-text search across workspace content

When to use: when the user references notes, documents, drafts, configs, or
project files they may have stored — run `ws_list_files` to orient yourself
before asking them to repeat information you could find yourself.
