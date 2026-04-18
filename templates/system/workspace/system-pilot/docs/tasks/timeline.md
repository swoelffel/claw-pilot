# Task Timeline

The task timeline is a chronological activity log that records every change to a task. It provides a complete audit trail of status transitions, field updates, comments, assignments, and epic associations. Timeline entries are stored in the `rt_task_activities` table.

## Activity Types

The timeline tracks 9 distinct activity types:

| Activity Type | Description | Example |
|---|---|---|
| `created` | Task was created | New task added to the board |
| `status_change` | Task status transitioned | `pending` to `in_progress` |
| `field_update` | A task field was modified | Description or title edited |
| `priority_change` | Task priority was changed | `medium` to `critical` |
| `assigned` | Agent or user assigned to task | `code-reviewer` assigned |
| `unassigned` | Assignee removed from task | Agent unassigned after completion |
| `comment_added` | A comment was posted on the task | Status update or discussion note |
| `epic_linked` | Task was linked to an epic | Added to "Auth Migration" epic |
| `epic_unlinked` | Task was removed from an epic | Moved out of parent epic |

## Activity Entry Schema

Each timeline entry contains the following fields:

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique activity identifier |
| `task_id` | string | The task this activity belongs to |
| `timestamp` | ISO 8601 | When the activity occurred |
| `actor` | string | Who performed the action (agent ID or user ID) |
| `activity_type` | enum | One of the 9 types listed above |
| `old_value` | string or null | Previous value before the change |
| `new_value` | string or null | New value after the change |

## How Activities Are Recorded

Activities are recorded automatically by the task management system. No manual intervention is needed. When a task is created, a `created` activity is logged. When an agent changes a task's status using the task tool, a `status_change` activity is logged with the old and new status values. When a comment is posted, a `comment_added` activity is logged with the comment text in `new_value`.

## Viewing the Timeline

The task detail panel in the dashboard includes a **Timeline** tab. This tab displays all activities for the selected task in reverse chronological order (newest first). Each entry shows:

- Timestamp (relative, e.g. "2 hours ago")
- Actor name with icon (agent or user)
- Activity description with old/new values highlighted
- Comment text (for `comment_added` entries)

## Querying Activities via API

Retrieve timeline entries for a specific task:

```
GET /api/instances/:slug/tasks/:id/activities
```

Returns an array of activity objects sorted by timestamp descending. Supports pagination with `limit` and `offset` query parameters.

## Use Cases

### Auditing Task Progress

Review the full history of a task to understand how it evolved. Identify when status changed, who worked on it, and what decisions were made through comments.

### Understanding Delays

When a task is `blocked`, the timeline shows when the block occurred and any comments explaining the reason. Status change entries reveal how long the task spent in each status.

### Agent Accountability

Since every activity records the actor, the timeline provides accountability for agent actions. Track which agent picked up a task, how long it took, and whether it was reassigned.

### Change Tracking

Field update activities capture modifications to task title, description, and other properties. The old and new values are preserved, making it easy to see what changed and when.

## Storage

Timeline entries are append-only in the `rt_task_activities` table. They are never modified or deleted. This ensures a tamper-proof audit trail for all task mutations.

*ClawPilot v0.74.1*
