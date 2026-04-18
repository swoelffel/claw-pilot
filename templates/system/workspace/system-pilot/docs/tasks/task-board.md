# Task Board (Kanban)

The task board provides a Kanban-style interface for managing structured tasks assigned to agents. Tasks flow through status columns, can be filtered and reordered, and are tracked with a full activity timeline.

## Task Statuses

| Status | Column | Description |
|---|---|---|
| `pending` | Backlog | Task created but not yet started |
| `in_progress` | In Progress | An agent or user is actively working on it |
| `completed` | Done | Task finished successfully |
| `blocked` | Blocked | Waiting on an external dependency or another task |
| `cancelled` | Cancelled | Task abandoned, no longer relevant |

## Task Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | yes | Short summary of what needs to be done |
| `description` | string | no | Detailed task description, supports Markdown |
| `priority` | enum | yes | `low`, `medium`, `high`, or `critical` |
| `assignee` | string | no | Agent ID that owns the task |
| `status` | enum | yes | One of the five statuses above |
| `epic_id` | string | no | Parent epic ID for grouping related tasks |

## Creating Tasks

Tasks can be created from the dashboard UI or the REST API.

### Dashboard UI

Open the instance task board, click the **+ New Task** button. Fill in title, priority, and optionally assign to an agent. The task appears in the Pending column.

### REST API

```
POST /api/instances/:slug/tasks
Content-Type: application/json

{
  "title": "Review pull request #42",
  "description": "Check code quality and test coverage",
  "priority": "high",
  "assignee": "code-reviewer"
}
```

Returns the created task object with its generated `id` and default status `pending`.

## Drag-and-Drop Reorder

Within each Kanban column, tasks can be reordered by dragging. The new position is persisted immediately. Dragging a task between columns changes its status to match the target column.

## Agent Task Checkout

Agents can pick up pending tasks using the task tool. When an agent checks out a task:

1. Task status transitions from `pending` to `in_progress`
2. The `assignee` field is set to the agent's ID
3. A `status_change` activity is recorded in `rt_task_activities`

This enables autonomous task processing where agents self-assign work from the backlog.

## Task Comments

Add comments to any task for discussion or status updates:

```
POST /api/instances/:slug/tasks/:id/comments
Content-Type: application/json

{
  "text": "Identified three issues, working on fixes now.",
  "author": "code-reviewer"
}
```

Comments appear in the task detail panel and generate a `comment_added` activity in the timeline.

## Filtering and Search

The task board supports filtering by multiple criteria:

| Filter | Parameter | Example |
|---|---|---|
| Status | `status` | `?status=pending,in_progress` |
| Assignee | `assignee` | `?assignee=code-reviewer` |
| Priority | `priority` | `?priority=high,critical` |

Filters combine with AND logic. Text search over title and description is available via the search bar (backed by FTS5).

## Task Counts Endpoint

Retrieve task counts grouped by status for dashboard badges:

```
GET /api/instances/:slug/tasks/counts
```

Returns an object like `{ pending: 5, in_progress: 2, completed: 12, blocked: 1, cancelled: 0 }`. Used by the navigation sidebar to display unread-style badges on the task board link.

## Activity Tracking

Every task mutation is recorded in the `rt_task_activities` table. This includes status changes, field updates, comments, assignment changes, and priority changes. See the timeline documentation for the full list of activity types.

*ClawPilot v0.74.1*
