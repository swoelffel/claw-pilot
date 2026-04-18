# Heartbeat

Periodic autonomous agent check-in system. Heartbeat enables agents to execute on a schedule without external triggers, running tasks like monitoring, reporting, and proactive maintenance during configured active hours.

## Configuration

Heartbeat schedules are configured per agent via `HEARTBEAT.md` in the agent directory or through agent configuration fields.

### Schedule Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| interval | Duration | Check-in frequency (5m to 24h) |
| activeHours | Time range | Hours during which heartbeat runs |
| timezone | IANA timezone | Timezone for active hours (e.g., `Europe/Paris`) |
| enabled | Boolean | Enable or disable heartbeat for this agent |

### Interval Range

Supported intervals range from 5 minutes to 24 hours. Common configurations:

| Interval | Use Case |
|----------|----------|
| 5m | High-frequency monitoring, alerting |
| 15m | Regular status checks |
| 1h | Hourly report generation |
| 6h | Periodic maintenance tasks |
| 24h | Daily summary, daily cleanup |

### Active Hours and Timezone

Active hours restrict heartbeat execution to a specific time window. The timezone parameter accepts IANA timezone identifiers (e.g., `Europe/Paris`, `America/New_York`, `Asia/Tokyo`). Invalid timezone strings are rejected at configuration time.

Agents only execute heartbeat ticks during their configured active hours. Ticks that fall outside the active window are silently skipped. This prevents unnecessary LLM calls during off-hours.

## Session Behavior

Each heartbeat tick creates a session for the agent to operate in:

- **Primary agents** (with permanent sessions): The heartbeat reuses the existing permanent session, preserving conversation context across ticks
- **Other agents**: An ephemeral session is created for each tick and disposed after completion

## Events

| Event | Description |
|-------|-------------|
| `heartbeat.tick` | Agent heartbeat executed successfully |
| `heartbeat.alert` | Heartbeat detected an issue requiring attention |

Events are stored in `rt_events` and visible in the activity console.

## Budget Gate

Heartbeat ticks respect the agent budget system. If an agent has exceeded its configured budget limit, heartbeat ticks are skipped until the budget resets or is increased. This prevents runaway costs from autonomous scheduled execution.

The skip is logged as a `heartbeat.tick` event with a note indicating budget exhaustion.

## Finish Reason Tagging

Each heartbeat tick completion is tagged with a structured `finish_reason` indicating the outcome. This enables filtering and analysis of heartbeat effectiveness over time.

## Heatmap Visualization

The dashboard displays a heatmap grid showing heartbeat activity:

- **X-axis**: Hours of the day (0-23)
- **Y-axis**: Days (recent history)
- **Cell color**: Intensity based on tick count or alert presence

The heatmap provides a quick visual overview of agent activity patterns, making it easy to spot gaps (missed ticks) or anomalies (unexpected alerts).

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/instances/:slug/heartbeat/history` | Heartbeat tick history with timestamps and outcomes |

The history endpoint returns paginated results with tick timestamps, finish reasons, and any alert details.

## Use Cases

- **Monitoring**: Agents periodically check system health, service availability, or resource usage
- **Daily reports**: Generate and deliver summary reports on a 24h schedule
- **Proactive maintenance**: Detect and fix issues before users report them
- **Scheduled workflows**: Trigger flows or tasks at regular intervals
- **Log rotation**: Periodic cleanup of old data or temporary files

## Troubleshooting

If heartbeat ticks are not firing, check:

1. Heartbeat is enabled in agent configuration
2. Current time falls within configured active hours (accounting for timezone)
3. Agent budget has not been exceeded
4. Instance runtime is running

*ClawPilot v0.74.1*
