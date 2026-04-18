# Bus Event Types Reference

The ClawPilot event bus broadcasts 43 typed events across 15 categories. All events carry structured payloads and are persisted in the `rt_events` table for dashboard consumption. Subscribers register handlers via `getBus(slug).on(eventType, handler)`.

## Event Categories Overview

| Category | Count | Description |
|---|---|---|
| Runtime | 4 | Lifecycle events for instance start, stop, state changes, errors |
| Sessions | 5 | Session creation, updates, status changes, system prompt injection |
| Messages | 3 | Message creation, updates, streaming deltas |
| Permissions | 2 | Permission requests and user replies |
| Provider | 2 | Authentication failures and provider failover |
| Agents | 3 | Subagent completion, inter-agent messaging, timeouts |
| Heartbeat | 2 | Health check ticks and alerts |
| Budget | 2 | Spending threshold alerts and hard stops |
| Tasks | 3 | Task creation, status transitions, assignment changes |
| MCP | 2 | Server reconnection and tool list changes |
| Tools | 6 | Doom loops, timeouts, guardrails, errors, call lifecycle |
| Questions/Suggestions | 2 | User questions and auto-generated suggestions |
| Flows | 3 | Flow run start, step completion, run completion |
| Workspace/System | 2 | Workspace file changes and system state transitions |
| Channels | 2 | Inbound and outbound channel messages |

## Runtime Events

| Event Type | Key Payload Fields | Description |
|---|---|---|
| `runtime.started` | `slug`, `port`, `pid` | Instance runtime process has started |
| `runtime.stopped` | `slug`, `exitCode` | Instance runtime process has stopped |
| `runtime.state_changed` | `slug`, `from`, `to` | Instance state transition (running, stopped, error) |
| `runtime.error` | `slug`, `error`, `stack` | Unhandled runtime error |

## Session Events

| Event Type | Key Payload Fields | Description |
|---|---|---|
| `session.created` | `sessionId`, `agentId`, `permanent` | New session opened |
| `session.updated` | `sessionId`, `tokenCount`, `cost` | Session metadata updated (tokens, cost) |
| `session.ended` | `sessionId`, `reason` | Session closed or expired |
| `session.status` | `sessionId`, `status` | Session status changed (active, idle, error) |
| `session.system_prompt` | `sessionId`, `length` | System prompt injected into session |

## Message Events

| Event Type | Key Payload Fields | Description |
|---|---|---|
| `message.created` | `sessionId`, `messageId`, `role` | New message added to session |
| `message.updated` | `sessionId`, `messageId`, `parts` | Message content updated (streaming complete) |
| `message.part.delta` | `sessionId`, `messageId`, `delta` | Streaming chunk received from LLM |

## Permission Events

| Event Type | Key Payload Fields | Description |
|---|---|---|
| `permission.asked` | `sessionId`, `tool`, `scope`, `pattern` | Agent requests permission for a gated tool |
| `permission.replied` | `sessionId`, `tool`, `allowed`, `remember` | User grants or denies the permission request |

## Provider Events

| Event Type | Key Payload Fields | Description |
|---|---|---|
| `provider.auth_failed` | `provider`, `keyLabel`, `error` | API key authentication failure |
| `provider.failover` | `provider`, `fromKey`, `toKey` | Automatic failover to next priority key |

## Agent Events

| Event Type | Key Payload Fields | Description |
|---|---|---|
| `subagent.completed` | `parentSessionId`, `agentId`, `result` | Subagent finished its delegated work |
| `agent.message.sent` | `fromSlug`, `toSlug`, `agentId`, `content` | A2A message sent between agents |
| `agent.timeout` | `sessionId`, `agentId`, `elapsed` | Agent exceeded maximum response time |

## Heartbeat Events

| Event Type | Key Payload Fields | Description |
|---|---|---|
| `heartbeat.tick` | `slug`, `agentId`, `status`, `latency` | Scheduled health check completed |
| `heartbeat.alert` | `slug`, `agentId`, `reason`, `severity` | Health check detected an issue |

## Budget Events

| Event Type | Key Payload Fields | Description |
|---|---|---|
| `budget.soft_alert` | `slug`, `spent`, `limit`, `percent` | Spending reached soft threshold (warning) |
| `budget.hard_stop` | `slug`, `spent`, `limit` | Spending reached hard limit, instance paused |

## Task Events

| Event Type | Key Payload Fields | Description |
|---|---|---|
| `task.created` | `taskId`, `title`, `assignee`, `priority` | New task added to the task board |
| `task.status_changed` | `taskId`, `from`, `to` | Task status transition (backlog, in-progress, done, blocked) |
| `task.assigned` | `taskId`, `assignee`, `previousAssignee` | Task reassigned to a different agent |

## MCP Events

| Event Type | Key Payload Fields | Description |
|---|---|---|
| `mcp.server.reconnected` | `serverName`, `toolCount` | MCP server reconnected after disconnect |
| `mcp.tools.changed` | `serverName`, `added`, `removed` | MCP server tool list changed |

## Tool Events

| Event Type | Key Payload Fields | Description |
|---|---|---|
| `tool.call.started` | `sessionId`, `tool`, `params` | Tool execution began |
| `tool.call.ended` | `sessionId`, `tool`, `duration`, `success` | Tool execution completed |
| `tool.doom_loop` | `sessionId`, `tool`, `count` | Repeated identical failing tool calls detected |
| `llm.chunk_timeout` | `sessionId`, `elapsed` | LLM response stream stalled |
| `guardrail.blocked` | `sessionId`, `tool`, `reason` | Tool call blocked by guardrail rule |
| `tool.error.recovered` | `sessionId`, `tool`, `error` | Tool error returned to agent for retry |

## Question and Suggestion Events

| Event Type | Key Payload Fields | Description |
|---|---|---|
| `question.asked` | `sessionId`, `question`, `options` | Agent asked the user a question |
| `suggestions.generated` | `sessionId`, `suggestions` | Auto-generated follow-up suggestions |

## Flow Events

| Event Type | Key Payload Fields | Description |
|---|---|---|
| `flow.run.started` | `flowId`, `runId`, `stepCount` | Flow execution began |
| `flow.step.completed` | `runId`, `stepIndex`, `status`, `outcome` | Individual flow step finished |
| `flow.run.completed` | `runId`, `status`, `totalCost` | Entire flow run finished |

## Workspace and System Events

| Event Type | Key Payload Fields | Description |
|---|---|---|
| `workspace.file.changed` | `slug`, `agentId`, `filePath`, `action` | Workspace file created, updated, or deleted |
| `system.state.changed` | `component`, `from`, `to` | System-level state transition |

## Channel Events

| Event Type | Key Payload Fields | Description |
|---|---|---|
| `channel.message.received` | `channel`, `chatId`, `peerId`, `text` | Inbound message from external channel |
| `channel.message.sent` | `channel`, `chatId`, `text` | Outbound message sent to external channel |

## Event Persistence

All bus events are written to the `rt_events` table with a timestamp, instance slug, event type, and JSON payload. The dashboard SSE stream replays recent events on connection and broadcasts new events in real time. Events older than the configured retention period are pruned automatically.

*ClawPilot v0.74.1*
