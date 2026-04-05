# Screen — Task Board (`cp-task-board`)

> **Source**: `ui/src/components/task-board.ts`, `task-card.ts`, `task-detail.ts`
> **Route**: `#/instances/:slug/tasks`
> **Entry point**: Instance card "Tasks" action

Kanban-style task board with 5 status columns, drag & drop between columns, inline task creation, and a slide-in detail panel.

## Mockup

```
+- Header ---------------------------------------------------------------+
|  <- Back   Tasks -- my-instance                          [+ New Task]  |
+------------------------------------------------------------------------+

+- Columns (horizontal scroll) -----------------------------------------+
| +-----------+ +-----------+ +-----------+ +-----------+ +-----------+ |
| | PENDING 3 | |IN PROGRESS| | BLOCKED 1 | | COMPLETED | | CANCELLED | |
| +-----------+ +-----------+ +-----------+ +-----------+ +-----------+ |
| | +-------+ | | +-------+ | | +-------+ | |           | |           | |
| | | Card  | | | | Card  | | | | Card  | | | No tasks  | | No tasks  | |
| | +-------+ | | +-------+ | | +-------+ | |           | |           | |
| | +-------+ | |           | |           | |           | |           | |
| | | Card  | | |           | |           | |           | |           | |
| | +-------+ | |           | |           | |           | |           | |
| +-----------+ +-----------+ +-----------+ +-----------+ +-----------+ |
+------------------------------------------------------------------------+

+- Detail pane (right, 360px, when a card is selected) --+
| #42                                               [x]  |
| TITLE: [Fix login bug                           ]      |
| STATUS: [In Progress v]   PRIORITY: [High v]           |
| ASSIGNEE: agent-dev   View session                     |
| DESCRIPTION: [textarea                          ]      |
| CREATED: 2026-04-05 by user                            |
| --- COMMENTS (2) ---                                    |
| agent-dev  04-05 12:30  Started working on it          |
| user       04-05 13:00  Any progress?                  |
| [Add a comment...                          ] [Send]    |
+---------------------------------------------------------+
```

## Header

| Element | Description |
|---|---|
| **<- Back** | Gray outline button, accent hover. Emits `navigate { slug: null }`. |
| **Title** | "Tasks -- {slug}" (`font-size: 20px`, `font-weight: 700`). |
| **+ New Task** | Accent outline button. Toggles inline create form. |

## Create form (inline, below header)

Appears when "+ New Task" is clicked. Surface background, border, rounded.

| Element | Description |
|---|---|
| **Title input** | Text input, placeholder "Task title..." |
| **Priority select** | Dropdown: Low, Medium, High, Critical (default: Medium) |
| **Create** | Accent filled button. Calls `POST /api/instances/:slug/tasks`. |
| **Cancel** | Muted outline button. Hides the form. |

## Columns

5 columns in horizontal flex layout, each `min-width: 200px`, `max-width: 280px`.

| Column | Status value |
|---|---|
| Pending | `pending` |
| In Progress | `in_progress` |
| Blocked | `blocked` |
| Completed | `completed` |
| Cancelled | `cancelled` |

Column header: uppercase label + count badge (mono font, surface background).
Empty column shows "No tasks" centered muted text.

### Drag & drop

- Cards have `draggable="true"`, `@dragstart` sets `dataTransfer` with task ID.
- Columns listen to `@dragover` (preventDefault, set `.drag-over` class), `@dragleave`, `@drop`.
- Drop calculates new position (max position in target column + 100) and calls `PATCH .../status`.
- **Optimistic update**: card moves immediately, reverts on API failure.

## Task Card (`cp-task-card`)

Small draggable card inside columns.

| Element | Description |
|---|---|
| **Title** | 13px, bold, primary text color |
| **Priority** | Uppercase badge, color-coded: critical=`--state-error`, high=`--state-warning`, medium=`--text-secondary`, low=`--text-muted` |
| **Assignee** | Mono font, muted, shown if assigned |
| **Labels** | Accent pills, shown if present |

Click emits `task-selected` event opening the detail pane.

## Task Detail (`cp-task-detail`)

Slide-in panel on the right (360px wide, border-left).

| Element | Description |
|---|---|
| **Task ID** | Mono `#id` + close button |
| **Title** | Editable text input, patches on change |
| **Status** | Select dropdown (5 statuses), emits `task-status-change` |
| **Priority** | Select dropdown (4 levels), patches on change |
| **Assignee** | Mono display + optional "View session" link |
| **Description** | Editable textarea, patches on change |
| **Created** | Timestamp + creator ID |
| **Comments** | Scrollable list (max 200px) + input + Send button |

## Data refresh

- Auto-refresh every 30 seconds via polling.
- Manual refresh on task creation, status change, or field update.

## i18n

All visible strings use `msg()` with `task-*` IDs (35 keys across 6 locales).

## Instance card integration

The instance card shows a task count in the status bar:
- Format: `N task(s)` with blocked count warning if > 0
- "Tasks" menu item navigates to this screen
