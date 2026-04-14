# Component — Epic Tree (`cp-epic-tree`)

> **Source**: `ui/src/components/epic-tree.ts`
> **Used in**: Task Board (`cp-task-board`)

Collapsible tree view showing epics with their child tasks and progress.

## Mockup

```
┌─ Epic Tree ──────────────────────────────────────────┐
│  ▾ Authentication System            3/5 completed    │
│    ├ Login form                     ● completed      │
│    ├ OAuth integration              ● in_progress    │
│    ├ Session management             ○ pending        │
│    ├ Password reset                 ○ pending        │
│    └ Rate limiting                  ● completed      │
│                                                       │
│  ▸ API Refactoring                  0/3 completed    │
└──────────────────────────────────────────────────────┘
```

## Props

| Property | Type | Description |
|---|---|---|
| `slug` | `string` | Instance slug |
| `epics` | `EpicInfo[]` | List of epic records |

## Behavior

- **Collapsed**: shows epic title + progress (completed/total)
- **Click expand**: lazy-fetches children via `GET /api/instances/:slug/epics/:id/children`
- **Click child**: emits `task-selected` event with `{ taskId }`
- Children are cached in component state after first fetch

## Events

| Event | Payload | Description |
|---|---|---|
| `task-selected` | `{ taskId: number }` | User clicked a child task |

## Data Fetching

| Endpoint | Description |
|---|---|
| `GET /api/instances/:slug/epics/:id/children` | Lazy-loaded children for epic |

## i18n

Uses `msg("...", { id: "epic.*" })` prefix.

---

*Since v0.65.0 (GOAL-001)*
