# Notification Inbox

The notification system provides persistent, categorized alerts for important platform events. Notifications are stored in the database, displayed in the dashboard header, and automatically pruned after 30 days.

## Notification Categories

| Category | Trigger Events | Typical Severity |
|---|---|---|
| Budget alerts | `budget.soft_alert`, `budget.hard_stop` | warning, critical |
| Permission requests | `permission.asked` | info |
| Heartbeat alerts | `heartbeat.alert` | warning, error |
| Flow completions | `flow.run.completed` | info |
| System errors | `runtime.error`, `provider.auth_failed` | error, critical |
| Agent timeouts | `agent.timeout` | warning |
| MCP disconnects | `mcp.server.reconnected` | info |

## Severity Levels

| Level | Color | Description |
|---|---|---|
| `info` | Blue | Informational event, no action required |
| `warning` | Yellow | Attention recommended, non-critical issue |
| `error` | Red | Something failed, investigation needed |
| `critical` | Red (pulsing) | Immediate action required (budget hard stop, runtime crash) |

## Database Schema

Notifications are stored in the `notifications` table.

| Column | Type | Description |
|---|---|---|
| `id` | TEXT | Unique notification identifier (UUID) |
| `instance_slug` | TEXT | Associated instance (nullable for system-wide notifications) |
| `category` | TEXT | Notification category (budget, permission, heartbeat, etc.) |
| `severity` | TEXT | Severity level (info, warning, error, critical) |
| `title` | TEXT | Short notification title |
| `body` | TEXT | Detailed notification message |
| `dedup_key` | TEXT | Deduplication key to prevent duplicate notifications |
| `is_read` | INTEGER | Read status (0 = unread, 1 = read) |
| `created_at` | TEXT | ISO 8601 timestamp |

## Deduplication

Notifications with the same `dedup_key` are deduplicated within a configurable time window. When a duplicate arrives, the existing notification's timestamp is updated instead of creating a new entry. This prevents notification flooding from repeated events like heartbeat failures or budget threshold crossings.

| Scenario | Dedup Key Example |
|---|---|
| Budget soft alert | `budget:soft:<slug>` |
| Heartbeat failure | `heartbeat:<slug>:<agentId>` |
| Provider auth failure | `provider:auth:<provider>:<keyLabel>` |
| Runtime error | `runtime:error:<slug>` |

## Auto-Pruning

Notifications older than 30 days are automatically deleted during the daily maintenance cycle. Read notifications are pruned first. The retention period is not currently configurable.

## Dashboard UI

### Bell Icon

The notification bell icon is displayed in the dashboard header bar. An unread count badge appears when there are unread notifications. The badge shows the count number (up to 99, then "99+").

### Dropdown Panel

Clicking the bell icon opens a dropdown panel listing recent notifications.

| Element | Description |
|---|---|
| Notification list | Scrollable list sorted by creation time (newest first) |
| Severity icon | Color-coded icon matching the severity level |
| Title and body | Notification content with truncated preview |
| Timestamp | Relative time (e.g., "5 min ago") |
| Mark as read | Click a notification to mark it as read |
| Mark all read | Button at the top to clear all unread indicators |
| Instance link | Click to navigate to the related instance |

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/notifications` | List notifications (paginated, filterable by severity and category) |
| `PATCH` | `/api/notifications/:id/read` | Mark a single notification as read |
| `PATCH` | `/api/notifications/read-all` | Mark all notifications as read |
| `DELETE` | `/api/notifications/:id` | Delete a single notification |

### Query Parameters (GET)

| Parameter | Type | Description |
|---|---|---|
| `page` | number | Page number (default 1) |
| `limit` | number | Items per page (default 20, max 100) |
| `severity` | string | Filter by severity level |
| `category` | string | Filter by notification category |
| `is_read` | boolean | Filter by read status |

## Real-Time Push

New notifications are broadcast in real time via the WebSocket `health_update` channel. The dashboard UI receives these updates and increments the unread badge without requiring a page refresh. Critical notifications also trigger a browser notification (if permitted by the user's browser settings).

*ClawPilot v0.74.1*
