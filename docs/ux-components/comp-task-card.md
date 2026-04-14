# Component — Task Card (`cp-task-card`)

> **Source**: `ui/src/components/task-card.ts`
> **Used in**: Task Board (`cp-task-board`)

Compact card rendered in Kanban columns. Shows task title, assignee, priority, labels, and type indicator.

## Mockup

```
┌─ Task Card ──────────────────────────────┐
│  ● Fix login timeout              [!]    │
│  pilot · in_progress                     │
│  [auth] [urgent]                         │
└──────────────────────────────────────────┘
```

## Props

| Property | Type | Description |
|---|---|---|
| `task` | `TaskInfo` | Task record from API |
| `selected` | `boolean` | Whether card is selected (highlight border) |

## Elements

| Element | Description |
|---|---|
| **Status dot** | Color-coded by status |
| **Title** | Task title (truncated if long) |
| **Priority icon** | `[!]` high, `[!!]` critical (hidden for normal/low) |
| **Assignee** | Agent ID (mono, muted) |
| **Status** | Status label |
| **Labels** | Tag pills (small, `--accent-subtle` background) |
| **Type** | Epic indicator (folder icon) if `type === "epic"` |

## Events

| Event | Direction | Description |
|---|---|---|
| `task-click` | card → board | User clicked the card |

## Status Colors

| Status | Color |
|---|---|
| `pending` | `--text-muted` |
| `in_progress` | `--state-info` |
| `completed` | `--state-running` |
| `blocked` | `--state-error` |
| `cancelled` | `--text-secondary` |

## Drag & Drop

Cards support drag for Kanban reordering. Drag data includes task ID and current status.

---

*Since v0.64.0 (TASK-001)*
