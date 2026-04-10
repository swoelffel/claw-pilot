// src/core/repositories/task-repository.ts
//
// Repository for task board — CRUD, atomic checkout, status transitions,
// position management for Kanban drag & drop, and comments.

import type Database from "better-sqlite3";
import { insertActivity } from "./task-activity-repository.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStatus = "pending" | "in_progress" | "completed" | "blocked" | "cancelled";
export type TaskPriority = "low" | "medium" | "high" | "critical";
export type TaskType = "epic" | "task";

export interface TaskRow {
  id: number;
  instance_slug: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string | null;
  labels: string | null;
  created_by: string;
  session_id: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  type: TaskType;
  parent_id: number | null;
}

/** Extended row returned by getActiveTasksForAgent — includes parent epic context. */
export interface TaskRowWithEpic extends TaskRow {
  epic_id: number | null;
  epic_title: string | null;
}

export interface TaskCommentRow {
  id: number;
  task_id: number;
  author_id: string;
  content: string;
  created_at: string;
}

export interface CreateTaskInput {
  instanceSlug: string;
  title: string;
  description?: string;
  priority?: TaskPriority;
  assigneeId?: string;
  labels?: string[];
  createdBy: string;
  type?: TaskType;
  parentId?: number;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  assigneeId?: string | null;
  labels?: string[];
  parentId?: number | null;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/** Create a task or epic. Position is set to MAX+100 within the pending column. */
export function createTask(db: Database.Database, input: CreateTaskInput): TaskRow {
  const parentId = input.parentId ?? null;
  if (parentId !== null) {
    const err = validateParentId(db, null, parentId, input.instanceSlug);
    if (err) throw new Error(err);
  }

  const maxPos = db
    .prepare(
      `SELECT COALESCE(MAX(position), 0) AS max_pos FROM rt_tasks
       WHERE instance_slug = ? AND status = 'pending'`,
    )
    .get(input.instanceSlug) as { max_pos: number };

  const result = db
    .prepare(
      `INSERT INTO rt_tasks (instance_slug, title, description, priority, assignee_id, labels, created_by, position, type, parent_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.instanceSlug,
      input.title,
      input.description ?? null,
      input.priority ?? "medium",
      input.assigneeId ?? null,
      input.labels ? JSON.stringify(input.labels) : null,
      input.createdBy,
      maxPos.max_pos + 100,
      input.type ?? "task",
      parentId,
    );
  return getTask(db, Number(result.lastInsertRowid))!;
}

/** Get a single task by id. */
export function getTask(db: Database.Database, id: number): TaskRow | undefined {
  return db.prepare("SELECT * FROM rt_tasks WHERE id = ?").get(id) as TaskRow | undefined;
}

/** List tasks for an instance, optionally filtered by status. Ordered by position ASC. */
export function getTasksForInstance(
  db: Database.Database,
  slug: string,
  status?: TaskStatus,
): TaskRow[] {
  if (status) {
    return db
      .prepare(
        "SELECT * FROM rt_tasks WHERE instance_slug = ? AND status = ? ORDER BY position ASC",
      )
      .all(slug, status) as TaskRow[];
  }
  return db
    .prepare("SELECT * FROM rt_tasks WHERE instance_slug = ? ORDER BY status, position ASC")
    .all(slug) as TaskRow[];
}

/** Update mutable task fields. */
export function updateTask(
  db: Database.Database,
  id: number,
  updates: UpdateTaskInput,
): TaskRow | undefined {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.title !== undefined) {
    sets.push("title = ?");
    params.push(updates.title);
  }
  if (updates.description !== undefined) {
    sets.push("description = ?");
    params.push(updates.description);
  }
  if (updates.priority !== undefined) {
    sets.push("priority = ?");
    params.push(updates.priority);
  }
  if (updates.assigneeId !== undefined) {
    sets.push("assignee_id = ?");
    params.push(updates.assigneeId);
  }
  if (updates.labels !== undefined) {
    sets.push("labels = ?");
    params.push(JSON.stringify(updates.labels));
  }
  if (updates.parentId !== undefined) {
    if (updates.parentId !== null) {
      const task = getTask(db, id);
      const err = validateParentId(db, id, updates.parentId, task?.instance_slug);
      if (err) throw new Error(err);
    }
    sets.push("parent_id = ?");
    params.push(updates.parentId);
  }

  if (sets.length === 0) return getTask(db, id);

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(`UPDATE rt_tasks SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return getTask(db, id);
}

/** Delete a task and its comments (CASCADE). */
export function deleteTask(db: Database.Database, id: number): boolean {
  const result = db.prepare("DELETE FROM rt_tasks WHERE id = ?").run(id);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

/** Change task status. Optionally set a new position (for drag & drop). */
export function changeStatus(
  db: Database.Database,
  id: number,
  status: TaskStatus,
  position?: number,
): TaskRow | undefined {
  const task = getTask(db, id);
  if (!task) return undefined;

  // Calculate position if not provided: append at end of target column
  const pos =
    position ??
    (
      db
        .prepare(
          `SELECT COALESCE(MAX(position), 0) AS max_pos FROM rt_tasks
           WHERE instance_slug = ? AND status = ?`,
        )
        .get(task.instance_slug, status) as { max_pos: number }
    ).max_pos + 100;

  const completedAt = status === "completed" || status === "cancelled" ? "datetime('now')" : "NULL";

  db.prepare(
    `UPDATE rt_tasks
     SET status = ?, position = ?, updated_at = datetime('now'), completed_at = ${completedAt}
     WHERE id = ?`,
  ).run(status, pos, id);
  const updated = getTask(db, id);
  // Auto-complete parent epic if all children are done
  if (updated?.parent_id) {
    tryAutoCompleteEpic(db, updated.parent_id);
  }
  return updated;
}

/** Reorder a task within the same status column. */
export function reorderTask(db: Database.Database, id: number, newPosition: number): void {
  db.prepare("UPDATE rt_tasks SET position = ?, updated_at = datetime('now') WHERE id = ?").run(
    newPosition,
    id,
  );
}

// ---------------------------------------------------------------------------
// Atomic checkout
// ---------------------------------------------------------------------------

/**
 * Atomically claim a pending task for an agent.
 * Sets status = in_progress, assignee_id, session_id.
 * Returns undefined if task is not pending (already claimed or does not exist).
 */
export function checkoutTask(
  db: Database.Database,
  id: number,
  sessionId: string,
  assigneeId: string,
): TaskRow | undefined {
  const result = db
    .prepare(
      `UPDATE rt_tasks
       SET status = 'in_progress', assignee_id = ?, session_id = ?, updated_at = datetime('now')
       WHERE id = ? AND status = 'pending'`,
    )
    .run(assigneeId, sessionId, id);
  if (result.changes === 0) return undefined;
  return getTask(db, id);
}

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

/** Get task counts by status for an instance. */
export function getTaskCountsByStatus(
  db: Database.Database,
  slug: string,
): Record<TaskStatus, number> {
  const rows = db
    .prepare("SELECT status, COUNT(*) AS cnt FROM rt_tasks WHERE instance_slug = ? GROUP BY status")
    .all(slug) as { status: TaskStatus; cnt: number }[];

  const counts: Record<TaskStatus, number> = {
    pending: 0,
    in_progress: 0,
    completed: 0,
    blocked: 0,
    cancelled: 0,
  };
  for (const row of rows) {
    counts[row.status] = row.cnt;
  }
  return counts;
}

/** Get active tasks (pending + in_progress) assigned to a specific agent, with epic context. */
export function getActiveTasksForAgent(
  db: Database.Database,
  slug: string,
  agentId: string,
): TaskRowWithEpic[] {
  return db
    .prepare(
      `SELECT t.*, p.id AS epic_id, p.title AS epic_title
       FROM rt_tasks t
       LEFT JOIN rt_tasks p ON t.parent_id = p.id
       WHERE t.instance_slug = ? AND t.assignee_id = ?
       AND t.status IN ('pending', 'in_progress')
       AND t.type = 'task'
       ORDER BY
         CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                         WHEN 'medium' THEN 2 ELSE 3 END,
         t.position ASC`,
    )
    .all(slug, agentId) as TaskRowWithEpic[];
}

// ---------------------------------------------------------------------------
// Epic hierarchy
// ---------------------------------------------------------------------------

/** List all epics for an instance, ordered by position. */
export function getEpicsForInstance(db: Database.Database, slug: string): TaskRow[] {
  return db
    .prepare(
      "SELECT * FROM rt_tasks WHERE instance_slug = ? AND type = 'epic' ORDER BY position ASC",
    )
    .all(slug) as TaskRow[];
}

/** List child tasks of an epic, ordered by priority then position. */
export function getChildTasks(db: Database.Database, epicId: number): TaskRow[] {
  return db
    .prepare(
      `SELECT * FROM rt_tasks WHERE parent_id = ?
       ORDER BY
         CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                       WHEN 'medium' THEN 2 ELSE 3 END,
         position ASC`,
    )
    .all(epicId) as TaskRow[];
}

/** Get completion progress for an epic: total children and completed+cancelled count. */
export function getEpicProgress(
  db: Database.Database,
  epicId: number,
): { total: number; completed: number } {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status IN ('completed', 'cancelled') THEN 1 ELSE 0 END) AS completed
       FROM rt_tasks WHERE parent_id = ?`,
    )
    .get(epicId) as { total: number; completed: number };
  return { total: row.total, completed: row.completed ?? 0 };
}

/**
 * Walk up parent_id from a task to build the ancestry chain.
 * Returns ancestors from immediate parent to root (max 10 levels).
 */
export function getAncestryChain(db: Database.Database, taskId: number): TaskRow[] {
  const chain: TaskRow[] = [];
  let current = getTask(db, taskId);
  let depth = 0;
  while (current?.parent_id && depth < 10) {
    const parent = getTask(db, current.parent_id);
    if (!parent) break;
    chain.push(parent);
    current = parent;
    depth++;
  }
  return chain;
}

/**
 * Validate a proposed parent_id assignment.
 * Returns an error message string if invalid, null if valid.
 * @param taskId — the task being updated (null for new tasks)
 * @param parentId — the proposed parent
 * @param instanceSlug — the instance scope (for cross-instance check)
 */
export function validateParentId(
  db: Database.Database,
  taskId: number | null,
  parentId: number,
  instanceSlug?: string,
): string | null {
  if (taskId !== null && parentId === taskId) {
    return "A task cannot be its own parent";
  }
  const parent = getTask(db, parentId);
  if (!parent) {
    return `Parent task #${parentId} not found`;
  }
  if (parent.type !== "epic") {
    return `Parent #${parentId} is not an epic (type: ${parent.type})`;
  }
  if (instanceSlug && parent.instance_slug !== instanceSlug) {
    return "Parent epic belongs to a different instance";
  }
  // Cycle detection: walk up from parent to ensure we don't reach taskId
  if (taskId !== null) {
    let current: TaskRow | undefined = parent;
    let depth = 0;
    while (current?.parent_id && depth < 10) {
      if (current.parent_id === taskId) {
        return "Assigning this parent would create a cycle";
      }
      current = getTask(db, current.parent_id);
      depth++;
    }
  }
  return null;
}

/**
 * If all children of an epic are completed or cancelled, auto-complete the epic.
 * Returns the updated epic row if auto-completed, undefined otherwise.
 */
export function tryAutoCompleteEpic(db: Database.Database, epicId: number): TaskRow | undefined {
  const epic = getTask(db, epicId);
  if (!epic || epic.type !== "epic") return undefined;
  if (epic.status === "completed" || epic.status === "cancelled") return undefined;

  const progress = getEpicProgress(db, epicId);
  if (progress.total === 0) return undefined;
  if (progress.completed < progress.total) return undefined;

  const oldStatus = epic.status;
  db.prepare(
    `UPDATE rt_tasks SET status = 'completed', completed_at = datetime('now'),
     updated_at = datetime('now') WHERE id = ?`,
  ).run(epicId);
  insertActivity(db, {
    taskId: epicId,
    activityType: "status_changed",
    actorId: "system",
    details: { from: oldStatus, to: "completed" },
  });
  return getTask(db, epicId);
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

/** Add a comment to a task. */
export function addComment(
  db: Database.Database,
  input: { taskId: number; authorId: string; content: string },
): TaskCommentRow {
  const result = db
    .prepare("INSERT INTO rt_task_comments (task_id, author_id, content) VALUES (?, ?, ?)")
    .run(input.taskId, input.authorId, input.content);
  return db
    .prepare("SELECT * FROM rt_task_comments WHERE id = ?")
    .get(Number(result.lastInsertRowid)) as TaskCommentRow;
}

/** List comments for a task, most recent first. */
export function getComments(db: Database.Database, taskId: number, limit = 50): TaskCommentRow[] {
  return db
    .prepare("SELECT * FROM rt_task_comments WHERE task_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(taskId, limit) as TaskCommentRow[];
}
