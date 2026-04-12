// src/dashboard/routes/instances/tasks-crud.ts
// Routes: GET tasks, GET tasks/counts, GET tasks/:id, POST tasks, PATCH tasks/:id, DELETE tasks/:id
import { z } from "zod";
import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { getInstanceContext } from "../_instance-middleware.js";
import {
  createTask,
  getTask,
  getTasksForInstance,
  updateTask,
  deleteTask,
  getTaskCountsByStatus,
  getEpicsForInstance,
  getChildTasks,
  getEpicProgress,
  getComments,
  type TaskStatus,
  type TaskType,
  type TaskRow,
} from "../../../core/repositories/task-repository.js";
import {
  insertActivity,
  recordFieldChanges,
} from "../../../core/repositories/task-activity-repository.js";
import {
  upsertSearchEntry,
  removeSearchEntry,
} from "../../../core/repositories/search-repository.js";
import { notifyAndWakeAgent, toJson, VALID_STATUSES, VALID_TYPES } from "./_tasks-shared.js";

// ---------------------------------------------------------------------------
// Zod schemas for request validation
// ---------------------------------------------------------------------------

const PRIORITIES = ["low", "medium", "high", "critical"] as const;
const TASK_TYPES = ["epic", "task"] as const;

const CreateTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(PRIORITIES).optional(),
  assigneeId: z.string().optional(),
  labels: z.array(z.string()).optional(),
  createdBy: z.string().optional(),
  type: z.enum(TASK_TYPES).optional(),
  parentId: z.number().optional(),
});

const UpdateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  priority: z.enum(PRIORITIES).optional(),
  assigneeId: z.string().nullable().optional(),
  labels: z.array(z.string()).optional(),
  parentId: z.number().nullable().optional(),
});

export function registerTaskCrudRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, db } = deps;

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/tasks
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/tasks", (c) => {
    const { slug } = getInstanceContext(c);

    const status = c.req.query("status") as TaskStatus | undefined;
    if (status && !VALID_STATUSES.has(status)) {
      return apiError(c, 400, "INVALID_STATUS", "Invalid status filter");
    }
    const type = c.req.query("type") as TaskType | undefined;
    if (type && !VALID_TYPES.has(type)) {
      return apiError(c, 400, "INVALID_TYPE", "Invalid type filter");
    }
    let rows = getTasksForInstance(db, slug, status);
    if (type) {
      rows = rows.filter((r) => r.type === type);
    }
    return c.json(rows.map(toJson));
  });

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/tasks/counts
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/tasks/counts", (c) => {
    const { slug } = getInstanceContext(c);

    return c.json(getTaskCountsByStatus(db, slug));
  });

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/tasks/:id
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/tasks/:id", (c) => {
    const { slug } = getInstanceContext(c);

    const id = Number(c.req.param("id"));
    const task = getTask(db, id);
    if (!task || task.instance_slug !== slug) {
      return apiError(c, 404, "NOT_FOUND", "Task not found");
    }
    const comments = getComments(db, id);
    const json: Record<string, unknown> = {
      ...toJson(task),
      comments: comments.map((cm) => ({
        id: cm.id,
        taskId: cm.task_id,
        authorId: cm.author_id,
        content: cm.content,
        createdAt: cm.created_at,
      })),
    };

    // If child task, include parent info
    if (task.parent_id) {
      const parent = getTask(db, task.parent_id);
      if (parent) json.parent = { id: parent.id, title: parent.title };
    }
    // If epic, include children + progress
    if (task.type === "epic") {
      const children = getChildTasks(db, id);
      json.children = children.map(toJson);
      json.progress = getEpicProgress(db, id);
    }

    return c.json(json);
  });

  // ---------------------------------------------------------------------------
  // POST /api/instances/:slug/tasks
  // ---------------------------------------------------------------------------
  app.post("/api/instances/:slug/tasks", async (c) => {
    const { slug } = getInstanceContext(c);

    const body = await c.req.json().catch(() => null);
    const parsed = CreateTaskSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(c, 400, "INVALID_BODY", parsed.error.message);
    }
    const data = parsed.data;

    let row: TaskRow;
    try {
      row = createTask(db, {
        instanceSlug: slug,
        title: data.title,
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.priority !== undefined ? { priority: data.priority } : {}),
        ...(data.assigneeId !== undefined ? { assigneeId: data.assigneeId } : {}),
        ...(data.labels !== undefined ? { labels: data.labels } : {}),
        createdBy: data.createdBy ?? "user",
        ...(data.type !== undefined ? { type: data.type } : {}),
        ...(data.parentId !== undefined ? { parentId: data.parentId } : {}),
      });
    } catch (err) {
      return apiError(c, 400, "INVALID_PARENT", String(err));
    }

    // Log activity
    insertActivity(db, {
      taskId: row.id,
      activityType: "created",
      actorId: data.createdBy ?? "user",
      details: { status: row.status, priority: row.priority },
    });

    upsertSearchEntry(db, {
      entityType: "task",
      entityId: String(row.id),
      title: row.title,
      subtitle: `${slug} · ${row.status}`,
      routeHash: `/instances/${slug}/tasks`,
    });

    // Inject notification + trigger prompt loop if task was created with an assignee
    if (data.assigneeId) {
      notifyAndWakeAgent(db, registry, slug, data.assigneeId, row.id, row.title, row.description);
    }

    return c.json(toJson(row), 201);
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/instances/:slug/tasks/:id
  // ---------------------------------------------------------------------------
  app.patch("/api/instances/:slug/tasks/:id", async (c) => {
    const { slug } = getInstanceContext(c);

    const id = Number(c.req.param("id"));
    const existing = getTask(db, id);
    if (!existing || existing.instance_slug !== slug) {
      return apiError(c, 404, "NOT_FOUND", "Task not found");
    }

    const body = await c.req.json().catch(() => null);
    const parsed = UpdateTaskSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(c, 400, "INVALID_BODY", parsed.error.message);
    }
    const data = parsed.data;

    let updated: TaskRow | undefined;
    try {
      updated = updateTask(db, id, {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.priority !== undefined ? { priority: data.priority } : {}),
        ...(data.assigneeId !== undefined ? { assigneeId: data.assigneeId } : {}),
        ...(data.labels !== undefined ? { labels: data.labels } : {}),
        ...(data.parentId !== undefined ? { parentId: data.parentId } : {}),
      });
    } catch (err) {
      return apiError(c, 400, "INVALID_PARENT", String(err));
    }
    if (!updated) return apiError(c, 404, "NOT_FOUND", "Task not found");

    // Log field changes
    recordFieldChanges(db, id, "user", existing, {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.priority !== undefined ? { priority: data.priority } : {}),
      ...(data.assigneeId !== undefined ? { assigneeId: data.assigneeId } : {}),
      ...(data.labels !== undefined ? { labels: data.labels } : {}),
      ...(data.parentId !== undefined ? { parentId: data.parentId } : {}),
    });

    upsertSearchEntry(db, {
      entityType: "task",
      entityId: String(id),
      title: updated.title,
      subtitle: `${slug} · ${updated.status}`,
      routeHash: `/instances/${slug}/tasks`,
    });

    // Inject notification + trigger prompt loop when assignee changes
    if (
      data.assigneeId !== undefined &&
      data.assigneeId !== null &&
      data.assigneeId !== existing.assignee_id
    ) {
      notifyAndWakeAgent(
        db,
        registry,
        slug,
        data.assigneeId,
        id,
        updated.title,
        updated.description,
      );
    }

    return c.json(toJson(updated));
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/instances/:slug/tasks/:id
  // ---------------------------------------------------------------------------
  app.delete("/api/instances/:slug/tasks/:id", (c) => {
    const { slug } = getInstanceContext(c);

    const id = Number(c.req.param("id"));
    const existing = getTask(db, id);
    if (!existing || existing.instance_slug !== slug) {
      return apiError(c, 404, "NOT_FOUND", "Task not found");
    }

    deleteTask(db, id);
    removeSearchEntry(db, "task", String(id));
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/epics
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/epics", (c) => {
    const { slug } = getInstanceContext(c);

    const epics = getEpicsForInstance(db, slug);
    return c.json(
      epics.map((e) => ({
        ...toJson(e),
        progress: getEpicProgress(db, e.id),
      })),
    );
  });

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/epics/:id/children
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/epics/:id/children", (c) => {
    const { slug } = getInstanceContext(c);

    const id = Number(c.req.param("id"));
    const epic = getTask(db, id);
    if (!epic || epic.instance_slug !== slug || epic.type !== "epic") {
      return apiError(c, 404, "NOT_FOUND", "Epic not found");
    }

    const children = getChildTasks(db, id);
    return c.json(children.map(toJson));
  });
}
