// src/dashboard/routes/instances/tasks.ts
// Routes: CRUD for task board + status changes + comments + counts

import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { instanceGuard } from "../../../lib/guards.js";
import {
  createTask,
  getTask,
  getTasksForInstance,
  updateTask,
  deleteTask,
  changeStatus,
  reorderTask,
  addComment,
  getComments,
  getTaskCountsByStatus,
  type TaskStatus,
  type TaskPriority,
} from "../../../core/repositories/task-repository.js";
import { getBus } from "../../../runtime/bus/index.js";
import { TaskAssigned } from "../../../runtime/bus/events.js";
import type { InstanceSlug } from "../../../runtime/types.js";

const VALID_STATUSES = new Set<TaskStatus>([
  "pending",
  "in_progress",
  "completed",
  "blocked",
  "cancelled",
]);
const VALID_PRIORITIES = new Set<TaskPriority>(["low", "medium", "high", "critical"]);

function toJson(r: {
  id: number;
  instance_slug: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assignee_id: string | null;
  labels: string | null;
  created_by: string;
  session_id: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    priority: r.priority,
    assigneeId: r.assignee_id,
    labels: r.labels ? (JSON.parse(r.labels) as string[]) : null,
    createdBy: r.created_by,
    sessionId: r.session_id,
    position: r.position,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
  };
}

export function registerTaskRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, db } = deps;

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/tasks
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/tasks", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const status = c.req.query("status") as TaskStatus | undefined;
    if (status && !VALID_STATUSES.has(status)) {
      return apiError(c, 400, "INVALID_STATUS", "Invalid status filter");
    }
    const rows = getTasksForInstance(db, slug, status);
    return c.json(rows.map(toJson));
  });

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/tasks/counts
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/tasks/counts", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    return c.json(getTaskCountsByStatus(db, slug));
  });

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/tasks/:id
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/tasks/:id", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const id = Number(c.req.param("id"));
    const task = getTask(db, id);
    if (!task || task.instance_slug !== slug) {
      return apiError(c, 404, "NOT_FOUND", "Task not found");
    }
    const comments = getComments(db, id);
    return c.json({
      ...toJson(task),
      comments: comments.map((cm) => ({
        id: cm.id,
        taskId: cm.task_id,
        authorId: cm.author_id,
        content: cm.content,
        createdAt: cm.created_at,
      })),
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/instances/:slug/tasks
  // ---------------------------------------------------------------------------
  app.post("/api/instances/:slug/tasks", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const body = await c.req.json<{
      title?: string;
      description?: string;
      priority?: string;
      assigneeId?: string;
      labels?: string[];
      createdBy?: string;
    }>();

    if (!body.title || body.title.trim().length === 0) {
      return apiError(c, 400, "MISSING_TITLE", "title is required");
    }
    if (body.priority && !VALID_PRIORITIES.has(body.priority as TaskPriority)) {
      return apiError(c, 400, "INVALID_PRIORITY", "Invalid priority");
    }

    const row = createTask(db, {
      instanceSlug: slug,
      title: body.title,
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.priority !== undefined ? { priority: body.priority as TaskPriority } : {}),
      ...(body.assigneeId !== undefined ? { assigneeId: body.assigneeId } : {}),
      ...(body.labels !== undefined ? { labels: body.labels } : {}),
      createdBy: body.createdBy ?? "user",
    });
    return c.json(toJson(row), 201);
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/instances/:slug/tasks/:id
  // ---------------------------------------------------------------------------
  app.patch("/api/instances/:slug/tasks/:id", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const id = Number(c.req.param("id"));
    const existing = getTask(db, id);
    if (!existing || existing.instance_slug !== slug) {
      return apiError(c, 404, "NOT_FOUND", "Task not found");
    }

    const body = await c.req.json<{
      title?: string;
      description?: string;
      priority?: string;
      assigneeId?: string | null;
      labels?: string[];
    }>();

    const updated = updateTask(db, id, {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.priority !== undefined ? { priority: body.priority as TaskPriority } : {}),
      ...(body.assigneeId !== undefined ? { assigneeId: body.assigneeId } : {}),
      ...(body.labels !== undefined ? { labels: body.labels } : {}),
    });
    if (!updated) return apiError(c, 404, "NOT_FOUND", "Task not found");

    // Publish TaskAssigned when assignee changes to a non-null agent
    if (
      body.assigneeId !== undefined &&
      body.assigneeId !== null &&
      body.assigneeId !== existing.assignee_id
    ) {
      const bus = getBus(slug as InstanceSlug);
      bus.publish(TaskAssigned, {
        instanceSlug: slug as InstanceSlug,
        taskId: id,
        assigneeId: body.assigneeId,
        assignedBy: "user",
      });
    }

    return c.json(toJson(updated));
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/instances/:slug/tasks/:id/status
  // ---------------------------------------------------------------------------
  app.patch("/api/instances/:slug/tasks/:id/status", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const id = Number(c.req.param("id"));
    const existing = getTask(db, id);
    if (!existing || existing.instance_slug !== slug) {
      return apiError(c, 404, "NOT_FOUND", "Task not found");
    }

    const body = await c.req.json<{ status?: string; position?: number }>();
    if (!body.status || !VALID_STATUSES.has(body.status as TaskStatus)) {
      return apiError(c, 400, "INVALID_STATUS", "Valid status is required");
    }

    const updated = changeStatus(db, id, body.status as TaskStatus, body.position);
    if (!updated) return apiError(c, 404, "NOT_FOUND", "Task not found");
    return c.json(toJson(updated));
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/instances/:slug/tasks/:id/reorder
  // ---------------------------------------------------------------------------
  app.patch("/api/instances/:slug/tasks/:id/reorder", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const id = Number(c.req.param("id"));
    const existing = getTask(db, id);
    if (!existing || existing.instance_slug !== slug) {
      return apiError(c, 404, "NOT_FOUND", "Task not found");
    }

    const body = await c.req.json<{ position: number }>();
    if (typeof body.position !== "number") {
      return apiError(c, 400, "MISSING_POSITION", "position is required");
    }

    reorderTask(db, id, body.position);
    return c.json(toJson(getTask(db, id)!));
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/instances/:slug/tasks/:id
  // ---------------------------------------------------------------------------
  app.delete("/api/instances/:slug/tasks/:id", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const id = Number(c.req.param("id"));
    const existing = getTask(db, id);
    if (!existing || existing.instance_slug !== slug) {
      return apiError(c, 404, "NOT_FOUND", "Task not found");
    }

    deleteTask(db, id);
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // POST /api/instances/:slug/tasks/:id/comments
  // ---------------------------------------------------------------------------
  app.post("/api/instances/:slug/tasks/:id/comments", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const id = Number(c.req.param("id"));
    const existing = getTask(db, id);
    if (!existing || existing.instance_slug !== slug) {
      return apiError(c, 404, "NOT_FOUND", "Task not found");
    }

    const body = await c.req.json<{ authorId?: string; content?: string }>();
    if (!body.content || body.content.trim().length === 0) {
      return apiError(c, 400, "MISSING_CONTENT", "content is required");
    }

    const comment = addComment(db, {
      taskId: id,
      authorId: body.authorId ?? "user",
      content: body.content,
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
  });
}
