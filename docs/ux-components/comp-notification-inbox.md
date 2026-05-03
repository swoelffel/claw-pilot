# Component — Notification Inbox (`cp-notification-inbox`)

> **Source**: `ui/src/components/notification-inbox.ts`
> **Used in**: `app.ts` header (right cluster)

Persistent notification dropdown. Bell icon with unread badge; clicking opens a scrollable panel of notification items. Real-time updates via WebSocket `notification` messages.

## Mockup

```
[Bell] [3]
   |
   v
+-- panel ---------------------------+
| Notifications        [Mark all read]|
| ---                                  |
| [WARN] cp-system: budget exceeded   |
|        2m  · my-instance            |
| [INFO] flow daily-summary done      |
|        1h  · my-instance            |
| ...                                  |
+-------------------------------------+
```

## State

| Field | Purpose |
|---|---|
| `_items` | Loaded notifications (from `fetchNotifications`) |
| `_unread` | Unread count (from `fetchUnreadCount`, also bumped via WS) |
| `_open` | Panel visibility |

## Severity colors

Maps to design tokens via `SEVERITY_COLORS`:

| Severity | Token |
|---|---|
| `info` | `--state-info` |
| `warning` | `--state-warning` |
| `error` | `--state-error` |
| `success` | `--state-running` |

## Behaviors

- Bell button: opens/closes panel; outside-click closes.
- Items are auto-pruned server-side after 30 days (table `notifications`).
- `markNotificationRead(id)` on click; `markAllNotificationsRead()` from header link.
- Time formatting via `timeAgo()` helper (`now`, `Nm`, `Nh`, `Nd`).

## Data sources

- `GET /api/notifications` — paged list.
- `GET /api/notifications/unread-count` — bell badge.
- WS `notification` payloads — increment unread + prepend item.

## Related

- Backend table: `notifications` (see `docs/registry-db.md`).
- Header: see "Global navigation" in [`docs/ux-design.md`](../ux-design.md).

---

*Since v0.78+*
