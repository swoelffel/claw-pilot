# Epics

Epics are parent containers that group related tasks into coherent projects. An epic is a task with the `is_epic` flag set to true. Child tasks reference the epic via their `epic_id` field, forming a one-level hierarchy for organizing multi-step work.

## What Is an Epic

An epic represents a large initiative or project that breaks down into smaller tasks. Examples: "Migrate authentication to OAuth2", "Redesign dashboard home screen", "Implement budget enforcement". Each child task tracks a discrete unit of work within the epic.

## Epic Structure

| Property | Type | Description |
|---|---|---|
| `id` | string | Unique identifier (same as any task) |
| `title` | string | Epic name displayed in the epic tree |
| `description` | string | Detailed description of the initiative |
| `is_epic` | boolean | Must be `true` to mark this task as an epic |
| `priority` | enum | `low`, `medium`, `high`, or `critical` |
| `status` | enum | `pending`, `in_progress`, `completed`, `blocked`, `cancelled` |

## Creating an Epic

Create an epic by posting a task with the `is_epic` flag:

```
POST /api/instances/:slug/tasks
Content-Type: application/json

{
  "title": "Implement multi-provider support",
  "description": "Add support for OpenAI, Mistral, and Google alongside Anthropic",
  "priority": "high",
  "is_epic": true
}
```

The epic appears in both the task board (as a regular task card with an epic badge) and the epic tree component.

## Linking Tasks to an Epic

When creating or updating a child task, set the `epic_id` field to the epic's ID:

```
POST /api/instances/:slug/tasks
Content-Type: application/json

{
  "title": "Add OpenAI provider adapter",
  "priority": "medium",
  "epic_id": "epic-abc123"
}
```

A child task can belong to at most one epic. Changing or removing `epic_id` generates `epic_linked` or `epic_unlinked` activity entries in the task timeline.

## Epic API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/instances/:slug/epics` | List all epics for the instance |
| `GET` | `/api/instances/:slug/epics/:id/children` | Get child tasks of an epic |

The list epics endpoint returns epic objects with an additional `progress` field.

## Progress Tracking

Epic progress is derived from child task statuses. The calculation is straightforward:

```
progress = completed_children / total_children
```

For example, if an epic has 8 child tasks and 3 are completed, progress is 37.5%. The epic tree component displays this as a progress bar. An epic with zero children shows 0% progress.

## Epic Tree Component

The dashboard displays epics in a tree view component. Each epic node expands to show its child tasks. The tree supports:

- Expand/collapse individual epics
- Progress bar per epic (completed vs total children)
- Status icon for each child task
- Click-through to task detail panel

## Best Practices

- Use epics to organize multi-step projects that span several agent tasks
- Keep epic titles descriptive and outcome-focused
- Set epic status to `in_progress` once the first child task starts
- Mark the epic `completed` when all child tasks are done or cancelled
- Assign epics a priority that reflects the overall initiative importance

*ClawPilot v0.74.1*
