// src/dashboard/routes/notifications.ts
//
// API routes for the persistent notification inbox.
// Cross-instance notifications with read state and pagination.

import type { Hono } from "hono";
import type { RouteDeps } from "../route-deps.js";
import { apiError } from "../route-deps.js";
import {
  listNotifications,
  countUnread,
  markRead,
  markAllRead,
} from "../../core/repositories/notification-repository.js";
import { permission } from "../middleware/permission.js";
import { ACTIONS } from "../middleware/permission-actions.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerNotificationRoutes(app: Hono, deps: RouteDeps): void {
  const { db } = deps;

  // GET /api/notifications — paginated list
  app.get(
    "/api/notifications",
    permission({ action: ACTIONS.NOTIFICATION_LIST, resource: { kind: "notification" } }),
    (c) => {
      const cursor = parseNumber(c.req.query("cursor"));
      const limit = parseNumber(c.req.query("limit"));
      const unreadOnly = c.req.query("unread_only") === "true";

      const page = listNotifications(db, {
        ...(cursor !== undefined ? { cursor } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(unreadOnly ? { unreadOnly } : {}),
      });
      return c.json(page);
    },
  );

  // GET /api/notifications/unread-count — badge count
  app.get(
    "/api/notifications/unread-count",
    permission({ action: ACTIONS.NOTIFICATION_UNREAD_COUNT, resource: { kind: "notification" } }),
    (c) => {
      const count = countUnread(db);
      return c.json({ count });
    },
  );

  // PATCH /api/notifications/:id/read — mark single as read
  app.patch(
    "/api/notifications/:id/read",
    permission({
      action: ACTIONS.NOTIFICATION_MARK_READ,
      resource: { kind: "notification", id: (c) => c.req.param("id") },
    }),
    (c) => {
      const id = Number(c.req.param("id"));
      if (!Number.isFinite(id)) {
        return apiError(c, 400, "INVALID_ID", "Notification ID must be a number");
      }
      markRead(db, id);
      return c.json({ ok: true });
    },
  );

  // POST /api/notifications/mark-all-read — mark all as read
  app.post(
    "/api/notifications/mark-all-read",
    permission({ action: ACTIONS.NOTIFICATION_MARK_ALL_READ, resource: { kind: "notification" } }),
    (c) => {
      markAllRead(db);
      return c.json({ ok: true });
    },
  );
}
