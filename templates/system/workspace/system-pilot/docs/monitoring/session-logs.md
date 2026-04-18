# Session Logs

View historical sessions and their messages for any instance. Session logs provide full conversation history including user messages, assistant responses, tool calls, and tool results, enabling post-mortem debugging and behavior analysis.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/instances/:slug/runtime/sessions` | List all sessions for an instance |
| GET | `/api/instances/:slug/runtime/sessions/:id/messages` | Messages and parts for a session |
| GET | `/api/instances/:slug/runtime/sessions/:id/context` | LLM context view for a session |

## Session Types

ClawPilot uses two session types:

| Type | Lifetime | Key Format | Use Case |
|------|----------|------------|----------|
| Permanent | Persists across interactions | `<slug>:<agentId>` | Primary agents, shared across channels |
| Ephemeral | Created per task, disposed after | `<slug>:<agentId>:<channel>:<peerId>` | Subagent task sessions, isolated work |

### Permanent Sessions

Each primary agent has one permanent session. All interactions with that agent, regardless of the channel (dashboard, Telegram, API), share the same session. This gives the agent continuous memory of prior conversations and decisions.

The session key for permanent sessions follows the format `<slug>:<agentId>`, where `slug` is the instance identifier and `agentId` is the agent name.

### Ephemeral Sessions

Subagents and task-specific agents receive ephemeral sessions. These sessions include channel and peer information in their key to isolate concurrent work. Ephemeral sessions are disposed after the task completes, though their messages remain queryable in the session log.

## Message Structure

Each message in a session contains:

| Field | Description |
|-------|-------------|
| role | `user`, `assistant`, `system`, or `tool` |
| content | Text content or structured parts |
| parts | Array of content parts (text, tool_use, tool_result, image) |
| timestamp | When the message was created |
| metadata | Additional context (token counts, model, cost) |

Messages are stored in order and can be replayed to understand the full conversation flow.

## LLM Context View

The context endpoint (`GET .../sessions/:id/context`) returns exactly what the LLM sees when processing a request in this session:

- **System prompt**: The full system prompt including agent instructions, workspace knowledge, and tool definitions
- **Messages**: The conversation history as sent to the LLM (may be truncated or summarized for context window management)
- **Tool definitions**: All tools available to the agent in this session

This view is invaluable for debugging unexpected agent behavior. It shows the exact input the model receives, making it possible to identify missing context, incorrect instructions, or tool definition issues.

## Browsing Sessions

The dashboard session browser lists all sessions for an instance, showing:

- Session key (identifies agent and type)
- Creation timestamp
- Message count
- Last activity timestamp
- Session type (permanent or ephemeral)

Click a session to view its full message history with expandable tool call details.

## Use Cases

- **Debugging agent behavior**: Trace the exact sequence of messages, tool calls, and responses to understand why an agent acted in a particular way
- **Understanding conversation flow**: See how context builds up over multiple interactions in permanent sessions
- **Verifying tool usage**: Check that agents call the right tools with correct parameters
- **Context window analysis**: Use the LLM context view to verify what the model actually sees
- **Auditing**: Review agent interactions for compliance or quality assurance

## Troubleshooting

If a session appears empty, the agent may not have been invoked yet. Check that the instance runtime is running and the agent is configured.

If the context view differs from expected, verify the agent's system prompt configuration and workspace knowledge files.

*ClawPilot v0.74.1*
