# Home Chat

Home Chat is the simplified chat interface on the ClawPilot dashboard home screen.
It connects directly to the system-pilot agent of the cp-system instance,
providing a quick way to perform administrative tasks without navigating to a
specific instance Pilot view.

## Purpose

Home Chat is designed for quick administrative interactions:

- Check instance status and health.
- Create or configure instances.
- Manage API keys and providers.
- Review recent activity summaries.
- Trigger common maintenance operations.

## Event Filtering

Home Chat applies **HOME_FILTERS** to the event stream, showing only
user-relevant events and hiding low-level runtime details.

| Shown | Hidden |
|-----------------------------------|--------------------------------------|
| Chat messages (user and agent) | Raw tool call invocations |
| A2A delegation events | Internal runtime events |
| Subtask completion results | Tool result payloads |
| Suggestions and follow-up prompts | Reasoning traces |
| Error messages | Heartbeat and keepalive events |

This filtering keeps the Home Chat interface clean and focused on
conversational interaction rather than technical debugging.

## Streaming

Home Chat uses the same SSE (Server-Sent Events) streaming mechanism as the
full Pilot view, with identical reconnection behavior:

| Parameter | Value |
|-------------------------|-------------|
| Initial retry delay | 5 seconds |
| Maximum retry delay | 60 seconds |
| Backoff strategy | Exponential |
| Backoff multiplier | 2x |

On network interruption, the client automatically reconnects and resumes
the event stream. The exponential backoff prevents overwhelming the server
during extended outages.

## cp-system Dependency

Home Chat requires the **cp-system** instance to be provisioned and running.
cp-system is the built-in management instance that hosts the system-pilot
agent responsible for platform administration.

### Setup Wizard

If cp-system is not yet provisioned, the Home Chat area displays the
**setup wizard** instead of the chat interface. The wizard guides the user
through initial platform configuration:

1. Select an AI provider and enter credentials.
2. Choose a primary model for the system-pilot agent.
3. Confirm and provision the cp-system instance.

Once cp-system is running, the Home Chat becomes available automatically.

## Comparison with Pilot View

| Feature | Home Chat | Pilot View |
|--------------------------|-------------------------------|-------------------------------|
| Agent | system-pilot (cp-system only) | Any instance agent |
| Event filtering | HOME_FILTERS applied | Full unfiltered stream |
| Context panel | Not available | Available |
| Tool call visualization | Hidden | Visible with details |
| Session history browser | Current session only | All sessions accessible |
| Location | Dashboard home screen | Instance detail page |

## Message Routing

Messages typed in Home Chat are sent to the cp-system instance runtime:

```
POST /api/instances/cp-system/runtime/chat
```

The system-pilot agent processes the message using its configured tools,
which include instance management, provider configuration, and platform
health operations.

## Session Behavior

Home Chat uses the permanent session of the cp-system primary agent. This
session persists across browser sessions and is shared with other channels
(Telegram, if configured for cp-system). Previous conversation context is
retained automatically.

## Notes

- Home Chat is available only to authenticated dashboard users with
  appropriate permissions.
- The chat input supports plain text only; structured commands should be
  expressed as natural language requests.
- If cp-system is stopped or unhealthy, Home Chat displays a status
  indicator and connection retry controls.

*ClawPilot v0.74.1*
