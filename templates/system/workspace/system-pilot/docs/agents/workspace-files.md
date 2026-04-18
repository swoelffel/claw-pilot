# Agent Workspace Files

Every agent in ClawPilot has a dedicated workspace directory containing files that shape its identity, behavior, team composition, and memory.

## Standard Workspace Files

| File | Purpose | When Used |
|------|---------|-----------|
| `SOUL.md` | Agent identity, capabilities, principles, personality | Injected into system prompt when `promptMode=full` |
| `AGENTS.md` | Team composition, communication links, delegation rules | Loaded at prompt build time for multi-agent awareness |
| `BOOTSTRAP.md` | First-contact guidance, onboarding instructions | Shown only on the very first message of a new session |
| `USER.md` | User preferences, custom instructions, working style | Injected into system prompt alongside SOUL.md |
| `HEARTBEAT.md` | Heartbeat check instructions, health verification steps | Read by the heartbeat scheduler at each check interval |

## How Standard Files Are Loaded

The runtime reads workspace files during prompt construction. The loading order is:

1. **SOUL.md** -- core identity block, always first
2. **USER.md** -- user-specific overrides appended after SOUL
3. **AGENTS.md** -- team topology for delegation-aware agents
4. **BOOTSTRAP.md** -- conditional, only if `session.messageCount === 0`

When `promptMode` is set to `minimal`, only SOUL.md summary lines are included to reduce token usage. Set `promptMode=full` for complete injection of all workspace content.

## Custom Documentation Files

Any `.md` file placed in the `docs/` subdirectory (or deeper) becomes part of the agent's knowledge base. Examples:

- `docs/reference/glossary.md` -- terminology definitions
- `docs/flows/daily-maintenance.md` -- flow-specific instructions
- `docs/security/authentication.md` -- security context

Custom files are **not** injected into the system prompt automatically. They are accessed on demand through workspace search tools.

## Workspace Knowledge Plugin

Agents equipped with the **workspace-knowledge** plugin gain two MCP tools:

| Tool | Description |
|------|-------------|
| `ws_search_files` | Full-text search (FTS5) across all workspace `.md` files in `docs/` |
| `ws_list_files` | List all indexed workspace files with paths and metadata |

The FTS5 index provides snippet context (approximately 15 words around each match), enabling agents to locate relevant documentation without loading entire files.

### Search Scope

- **Included**: all `.md` files under `docs/` and its subdirectories
- **Excluded**: files in `memory/` directory (managed separately)
- **Excluded**: non-markdown files

## Memory Directory

The `memory/` directory stores auto-managed memory files created by the agent runtime:

- **Facts** -- key decisions, user preferences, learned context
- **Decisions** -- recorded choices with rationale
- **Timeline** -- chronological event log

Memory files are written by the agent during conversations and persisted across sessions. They are excluded from `ws_search_files` results to keep search focused on curated documentation.

## Directory Structure Example

```
workspace/my-agent/
  SOUL.md
  AGENTS.md
  BOOTSTRAP.md
  USER.md
  HEARTBEAT.md
  docs/
    reference/
      glossary.md
      tools-system.md
    agents/
      workspace-files.md
    security/
      authentication.md
  memory/
    facts.md
    decisions.md
    timeline.md
```

## Editing Workspace Files

Workspace files can be edited through:

1. **Dashboard UI** -- Memory Browser screen at `#/instances/:slug/memory`
2. **Agent self-edit** -- agents with file-write permissions can update their own workspace
3. **Direct filesystem access** -- files stored under the instance data directory

After editing, the FTS5 index is rebuilt automatically on the next search query.

## Best Practices

- Keep SOUL.md under 120 lines to avoid excessive token consumption
- Use AGENTS.md only for agents that participate in multi-agent delegation
- Place reusable knowledge in `docs/` so it is searchable via FTS5
- Write files with keyword-rich headings and content for better search relevance
- Avoid duplicating information between SOUL.md and docs/ files

*ClawPilot v0.74.1*
