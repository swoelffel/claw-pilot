# Web Chat Channel

The web chat channel is the primary way to interact with agents through the
ClawPilot dashboard. It provides two distinct interfaces: the Pilot view for
full-featured agent interaction and the Home Chat for quick administrative tasks.

## Interfaces

| Interface | Location | Features | Target use |
|-----------|---------------------|----------------------------------------------|--------------------------|
| Pilot | Instance detail page | Full context panel, session history, tool vis | Deep agent interaction |
| Home Chat | Dashboard home screen| Filtered events, simplified display | Quick admin tasks |

## Sending Messages

Messages are sent to an agent via the chat API:

```
POST /api/instances/:slug/runtime/chat
Content-Type: application/json

{
  "message": "Summarize the latest research findings"
}
```

The endpoint accepts plain text messages and routes them to the instance's
primary agent (or a specified agent via optional `agent_id` parameter).

## Real-Time Streaming

Agent responses stream in real time via Server-Sent Events (SSE):

```
GET /api/instances/:slug/runtime/chat/stream
```

The SSE connection delivers incremental response tokens, tool call events,
and status updates as they occur. The client receives a continuous stream
of typed events rather than waiting for a complete response.

## Message Types

| Type | Description |
|-----------------|-------------------------------------------------------------|
| `text` | Plain text messages from user or agent |
| `tool_call` | Agent invoking a tool (name, arguments, status) |
| `tool_result` | Result returned by a tool execution |
| `reasoning` | Agent's internal reasoning trace (when exposed) |
| `suggestion` | Suggested follow-up actions or questions |
| `question` | Agent asking the user for clarification or approval |

## Session Model

| Agent type | Session lifetime | Behavior |
|------------|------------------|-----------------------------------------------------|
| Primary | Permanent | Shared across all channels (web chat, Telegram) |
| Subagent | Ephemeral | Created for a delegation, destroyed on completion |

Primary agents maintain a single persistent session. Conversations are
continuous across web chat and Telegram -- the agent retains full context
regardless of which channel the user messages from.

Subagent sessions are scoped to a specific task delegation. They start when
the parent agent delegates work and end when the subagent returns its result.

## Pilot View Features

The Pilot view is the full-featured agent interaction interface:

### Context Panel
Displays the agent's current LLM context including system prompt, message
history, and active tool definitions. Useful for debugging agent behavior
and understanding what information the agent has access to.

### Session History
Scrollable chronological view of all messages in the current session,
including user messages, agent responses, tool calls, and tool results.
Past sessions are accessible via the session selector.

### Tool Visualization
Tool calls and their results are rendered with structured formatting:
tool name, input arguments, execution status, and output. Failed tool
calls display error details for diagnosis.

## Connection Handling

The SSE stream uses automatic reconnection with exponential backoff:

| Parameter | Value |
|---------------------|-------------|
| Initial retry delay | 5 seconds |
| Maximum retry delay | 60 seconds |
| Backoff multiplier | 2x |

The client automatically reconnects on network interruption, resuming
the event stream from where it left off using the last received event ID.

## Notes

- Web chat is always enabled for every instance; it cannot be disabled.
- File attachments are not supported in the current web chat implementation;
  use tool-based file operations instead.
- The Pilot view requires instance read permissions; the Home Chat requires
  access to the cp-system instance.

*ClawPilot v0.74.1*
