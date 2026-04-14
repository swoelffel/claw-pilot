# Component — Task Detail (`cp-task-detail`)

> **Source**: `ui/src/components/task-detail.ts`
> **Used in**: Task Board (`cp-task-board`) — right panel

Side panel showing full task details with editing, comments, and activity timeline.

## Mockup

```
┌─ Task Detail ──────────────────────────────────────────────┐
│  Fix login timeout                             [✎] [✕]    │
│  ──────────────────────────────────────────────────────    │
│  Status: [in_progress ▾]   Priority: [high ▾]            │
│  Assignee: [pilot ▾]       Epic: [Auth System ▾]          │
│  Labels: [auth] [urgent] [+ add]                          │
│                                                            │
│  ── Description ───────────────────────────────────────    │
│  The login form times out after 30s on slow connections.  │
│                                                            │
│  ── Comments (3) ──────────────────────────────────────    │
│  pilot · 2h ago                                            │
│  Investigated — the issue is in the auth middleware.       │
│                                                            │
│  [Write a comment...                          ] [Send]     │
│                                                            │
│  ── Activity ──────────────────────────────────────────    │
│  Apr 14 10:32  status changed: pending → in_progress      │
│  Apr 14 10:30  assigned to pilot                           │
│  Apr 14 10:28  created by admin                            │
└────────────────────────────────────────────────────────────┘
```

## Props

| Property | Type | Description |
|---|---|---|
| `slug` | `string` | Instance slug |
| `taskId` | `number` | Task ID |

## Sections

### Header
Task title (editable on click), edit and close buttons.

### Metadata
Inline editable fields: status (dropdown), priority (dropdown), assignee (dropdown from agent list), epic parent (dropdown from epics), labels (tag pills with add/remove).

### Description
Markdown-rendered description. Click to edit.

### Comments
Chronological list of comments with author and relative timestamp. Input bar at bottom for adding comments.

### Activity Timeline
9 activity types from `rt_task_activities` with field-level diff tracking:

| Activity type | Description |
|---|---|
| `created` | Task creation |
| `status_changed` | Status transition (old → new) |
| `assigned` | Agent assignment |
| `unassigned` | Agent removal |
| `priority_changed` | Priority change |
| `labels_changed` | Labels added/removed |
| `title_changed` | Title edit |
| `parent_changed` | Epic parent change |
| `comment_added` | New comment |

## Data Fetching

| Endpoint | Description |
|---|---|
| `GET /api/instances/:slug/tasks/:id` | Full task with comments and activities |
| `PATCH /api/instances/:slug/tasks/:id` | Update fields |
| `PATCH /api/instances/:slug/tasks/:id/status` | Change status |
| `POST /api/instances/:slug/tasks/:id/comments` | Add comment |

## Events

| Event | Direction | Description |
|---|---|---|
| `task-updated` | detail → board | Task was modified (refresh board) |
| `detail-close` | detail → board | Panel closed |

## i18n

Uses `msg("...", { id: "task-detail.*" })` prefix.

---

*Since v0.64.0 (TASK-001), activity timeline since v0.66.0 (TIMELINE-001)*
