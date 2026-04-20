// src/dashboard/routes/instances/tasks-actions.ts
// Routes: PATCH tasks/:id/status, PATCH tasks/:id/reorder, POST tasks/:id/comments, GET tasks/:id/timeline
import { z } from "zod";
import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { getInstanceContext } from "../_instance-middleware.js";
import {
  getTask,
  changeStatus,
  reorderTask,
  addComment,
} from "../../../core/repositories/task-repository.js";
import {
  insertActivity,
  getActivities,
  getActivityCount,
} from "../../../core/repositories/task-activity-repository.js";
import { upsertSearchEntry } from "../../../core/repositories/search-repository.js";
import { toJson } from "./_tasks-shared.js";
import { permission } from "../../middleware/permission.js";
import { ACTIONS } from "../../middleware/permission-actions.js";

// ---------------------------------------------------------------------------
// Zod schemas for request validation
// ---------------------------------------------------------------------------

const STATUSES = ["pending", "in_progress", "completed", "blocked", "cancelled"] as const;

const ChangeStatusSchema = z.object({
  status: z.enum(STATUSES),
  position: z.number().optional(),
});

const ReorderTaskSchema = z.object({
  position: z.number(),
});

const AddCommentSchema = z.object({
  authorId: z.string().optional(),
  content: z.string().min(1),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HonoContext = any;

export function registerTaskActionRoutes(app: Hono, deps: RouteDeps): void {
  const { db } = deps;
  const attr = (c: HonoContext) => ({ slug: c.req.param("slug") });
  const rid = (c: HonoContext) => c.req.param("id");

  // ---------------------------------------------------------------------------
  // PATCH /api/instances/:slug/tasks/:id/status
  // ---------------------------------------------------------------------------
  app.patch(
    "/api/instances/:slug/tasks/:id/status",
    permission({
      action: ACTIONS.TASK_STATUS,
      resource: { kind: "task", id: rid },
      attributes: attr,
    }),
    async (c) => {
      const { slug } = getInstanceContext(c);

      const id = Number(c.req.param("id"));
      const existing = getTask(db, id);
      if (!existing || existing.instance_slug !== slug) {
        return apiError(c, 404, "NOT_FOUND", "Task not found");
      }

      const body = await c.req.json().catch(() => null);
      const parsed = ChangeStatusSchema.safeParse(body);
      if (!parsed.success) {
        return apiError(c, 400, "INVALID_BODY", parsed.error.message);
      }
      const data = parsed.data;

      const updated = changeStatus(db, id, data.status, data.position);
      if (!updated) return apiError(c, 404, "NOT_FOUND", "Task not found");

      // Log activity
      if (existing.status !== data.status) {
        insertActivity(db, {
          taskId: id,
          activityType: "status_changed",
          actorId: "user",
          details: { from: existing.status, to: data.status },
        });

        upsertSearchEntry(db, {
          entityType: "task",
          entityId: String(id),
          title: updated.title,
          subtitle: `${slug} · ${updated.status}`,
          routeHash: `/instances/${slug}/tasks`,
        });
      }

      return c.json(toJson(updated));
    },
  );

  // ---------------------------------------------------------------------------
  // PATCH /api/instances/:slug/tasks/:id/reorder
  // ---------------------------------------------------------------------------
  app.patch(
    "/api/instances/:slug/tasks/:id/reorder",
    permission({
      action: ACTIONS.TASK_REORDER,
      resource: { kind: "task", id: rid },
      attributes: attr,
    }),
    async (c) => {
      const { slug } = getInstanceContext(c);

      const id = Number(c.req.param("id"));
      const existing = getTask(db, id);
      if (!existing || existing.instance_slug !== slug) {
        return apiError(c, 404, "NOT_FOUND", "Task not found");
      }

      const body = await c.req.json().catch(() => null);
      const parsed = ReorderTaskSchema.safeParse(body);
      if (!parsed.success) {
        return apiError(c, 400, "INVALID_BODY", parsed.error.message);
      }
      const data = parsed.data;

      reorderTask(db, id, data.position);
      return c.json(toJson(getTask(db, id)!));
    },
  );

  // ---------------------------------------------------------------------------
  // POST /api/instances/:slug/tasks/:id/comments
  // ---------------------------------------------------------------------------
  app.post(
    "/api/instances/:slug/tasks/:id/comments",
    permission({
      action: ACTIONS.TASK_COMMENT,
      resource: { kind: "task", id: rid },
      attributes: attr,
    }),
    async (c) => {
      const { slug } = getInstanceContext(c);

      const id = Number(c.req.param("id"));
      const existing = getTask(db, id);
      if (!existing || existing.instance_slug !== slug) {
        return apiError(c, 404, "NOT_FOUND", "Task not found");
      }

      const body = await c.req.json().catch(() => null);
      const parsed = AddCommentSchema.safeParse(body);
      if (!parsed.success) {
        return apiError(c, 400, "INVALID_BODY", parsed.error.message);
      }
      const data = parsed.data;

      const comment = addComment(db, {
        taskId: id,
        authorId: data.authorId ?? "user",
        content: data.content,
      });

      // Log activity
      insertActivity(db, {
        taskId: id,
        activityType: "comment",
        actorId: data.authorId ?? "user",
        details: { commentId: comment.id },
      });

      return c.json(
        {
          id: comment.id,
          taskId: comment.task_id,
          authorId: comment.author_id,
          content: comment.content,
          createdAt: comment.created_at,
        },
        201,
      );
    },
  );

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/tasks/:id/timeline
  // ---------------------------------------------------------------------------
  app.get(
    "/api/instances/:slug/tasks/:id/timeline",
    permission({
      action: ACTIONS.TASK_TIMELINE_READ,
      resource: { kind: "task", id: rid },
      attributes: attr,
    }),
    (c) => {
      const { slug } = getInstanceContext(c);

      const id = Number(c.req.param("id"));
      const task = getTask(db, id);
      if (!task || task.instance_slug !== slug) {
        return apiError(c, 404, "NOT_FOUND", "Task not found");
      }

      const limit = Math.min(Number(c.req.query("limit") ?? 50), 500);
      const offset = Number(c.req.query("offset") ?? 0);
      const activities = getActivities(db, id, { limit, offset });
      const total = getActivityCount(db, id);

      return c.json({
        activities: activities.map((a) => ({
          id: a.id,
          taskId: a.task_id,
          activityType: a.activity_type,
          actorId: a.actor_id,
          details: a.details_json ? (JSON.parse(a.details_json) as Record<string, unknown>) : null,
          createdAt: a.created_at,
        })),
        total,
      });
    },
  );
}
