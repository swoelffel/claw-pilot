# Activity Console

Real-time event stream viewer for monitoring instance activity. The activity console displays bus events as they occur, providing live visibility into agent behavior, tool calls, permission checks, and system operations.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/instances/:slug/events` | Paginated event history |
| GET | `/api/instances/:slug/events/stream` | SSE live event stream |

The paginated endpoint supports standard pagination parameters for browsing historical events. The SSE stream delivers events in real time as they are emitted by the instance runtime.

## Event Filtering

Events can be filtered by three dimensions:

| Filter | Values | Description |
|--------|--------|-------------|
| Event type | Supported event type names | Filter to specific event names |
| Agent ID | Agent identifier string | Show events from a single agent |
| Level | `info`, `warn`, `error` | Filter by severity level |

Filters can be combined to narrow the event stream to exactly the events relevant to a debugging or monitoring task.

## Event Categories

The event families below are examples, not a fixed inventory of every event type:

| Category | Description | Example Events |
|----------|-------------|----------------|
| Runtime | Instance lifecycle events | start, stop, crash, restart |
| Sessions | Session creation and disposal | session.created, session.closed |
| Messages | Incoming and outgoing messages | message.received, message.sent |
| Permissions | Permission checks and grants | permission.requested, permission.granted |
| Provider | LLM provider interactions | provider.request, provider.response, provider.error |
| Agents | Agent lifecycle events | agent.started, agent.stopped |
| Subagents | Subagent spawn and completion | subagent.spawned, subagent.completed |
| Heartbeat | Periodic agent check-ins | heartbeat.tick, heartbeat.alert |
| Budget | Cost tracking and limit events | budget.updated, budget.exceeded |
| Tasks | Task board operations | task.created, task.completed |
| MCP | Model Context Protocol events | mcp.connected, mcp.tool_call |
| Tools | Tool execution events | tool.called, tool.result, tool.error |

## Storage

Events are persisted in the `rt_events` table in the registry database. Each event record includes:

- Event type name
- Agent ID (if applicable)
- Severity level
- Timestamp
- Payload (JSON)
- Instance slug

The database storage enables historical queries and post-mortem analysis after the live stream has scrolled past.

## Live Stream Widget

The dashboard activity console widget maintains a rolling buffer of the most recent 200 events in memory. When the buffer is full, the oldest events are evicted as new events arrive. This keeps the browser performant while providing a meaningful window into recent activity.

The widget auto-scrolls to show the latest events by default. Auto-scroll pauses when the user scrolls up to inspect earlier events, and resumes when scrolled back to the bottom.

## Use Cases

- **Debugging agent behavior**: Watch tool calls, provider requests, and permission checks in real time to understand what an agent is doing and why
- **Monitoring tool calls**: Track which tools agents invoke, how often, and whether they succeed or fail
- **Tracking permissions**: See permission requests and grants to verify agents operate within their allowed scope
- **Diagnosing errors**: Filter by `error` level to quickly find failures across all event categories
- **Budget monitoring**: Watch budget events to see cost accumulation and limit enforcement
- **Session inspection**: Track session creation and message flow to understand conversation patterns

## Event Payload

Each event record includes the following fields:

| Field | Type | Description |
|-------|------|-------------|
| type | string | Event type name (e.g., `tool.called`) |
| agentId | string | Agent that emitted the event (if applicable) |
| level | string | Severity: `info`, `warn`, or `error` |
| timestamp | ISO 8601 | When the event occurred |
| payload | JSON | Event-specific data |
| instanceSlug | string | Instance that owns the event |

## Troubleshooting

If the SSE stream disconnects, the widget automatically reconnects. Durable execution replay and the event-history endpoint are different contracts. Inspect the appropriate persisted record; transient events are not guaranteed replay. See [Recovery and timeouts](recovery-and-timeouts.md).

If no events appear, verify the instance runtime is running with `claw-pilot status <slug>`.

Reviewed against Community 0.84.13. Use [Resource health](resource-health.md) for preflight, circuit breakers, trace/alert access and permission diagnosis.
