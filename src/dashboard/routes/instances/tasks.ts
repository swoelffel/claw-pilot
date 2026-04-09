// src/dashboard/routes/instances/tasks.ts
// Routes: CRUD for task board + status changes + comments + counts

import { z } from "zod";
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
  getEpicsForInstance,
  getChildTasks,
  getEpicProgress,
  type TaskStatus,
  type TaskType,
  type TaskRow,
} from "../../../core/repositories/task-repository.js";
import { getOrCreatePermanentSession } from "../../../runtime/session/session.js";
import { createUserMessage } from "../../../runtime/session/message.js";
import type { InstanceSlug } from "../../../runtime/types.js";
import { wakeupAgent } from "../_wakeup-agent.js";
import { logger } from "../../../lib/logger.js";

// ---------------------------------------------------------------------------
// Zod schemas for request validation
// ---------------------------------------------------------------------------

const STATUSES = ["pending", "in_progress", "completed", "blocked", "cancelled"] as const;
const PRIORITIES = ["low", "medium", "high", "critical"] as const;
const TASK_TYPES = ["epic", "task"] as const;

const VALID_STATUSES = new Set<TaskStatus>(STATUSES);
const VALID_TYPES = new Set<TaskType>(TASK_TYPES);

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

function toJson(r: TaskRow) {
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
    type: r.type,
    parentId: r.parent_id,
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
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

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
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

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

    const body = await c.req.json().catch(() => null);
    const parsed = ChangeStatusSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(c, 400, "INVALID_BODY", parsed.error.message);
    }
    const data = parsed.data;

    const updated = changeStatus(db, id, data.status, data.position);
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

    const body = await c.req.json().catch(() => null);
    const parsed = ReorderTaskSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(c, 400, "INVALID_BODY", parsed.error.message);
    }
    const data = parsed.data;

    reorderTask(db, id, data.position);
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

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/epics
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/epics", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

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
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const id = Number(c.req.param("id"));
    const epic = getTask(db, id);
    if (!epic || epic.instance_slug !== slug || epic.type !== "epic") {
      return apiError(c, 404, "NOT_FOUND", "Epic not found");
    }

    const children = getChildTasks(db, id);
    return c.json(children.map(toJson));
  });
}

// ---------------------------------------------------------------------------
// Helper: inject notification message + trigger prompt loop
// ---------------------------------------------------------------------------

function notifyAndWakeAgent(
  db: Parameters<typeof createUserMessage>[0],
  registry: RouteDeps["registry"],
  slug: string,
  agentId: string,
  taskId: number,
  title: string,
  description: string | null,
): void {
  const lines = [`[task_assigned:#${taskId}] "${title}" has been assigned to you.`];
  if (description) lines.push(`Description: ${description}`);
  lines.push("Use the task_board tool to checkout and work on this task.");
  const text = lines.join("\n");

  try {
    const session = getOrCreatePermanentSession(db, {
      instanceSlug: slug as InstanceSlug,
      agentId,
      channel: "internal",
    });
    createUserMessage(db, { sessionId: session.id, text });
  } catch (err) {
    logger.debug("[route:tasks] task notification session creation failed", { error: String(err) });
    // Non-critical — agent may not have a permanent session yet
    return;
  }

  // Fire-and-forget: trigger the agent's prompt loop
  wakeupAgent({ db, registry, slug, agentId, messageText: text });
}
