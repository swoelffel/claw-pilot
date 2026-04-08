// src/core/repositories/task-repository.ts
//
// Repository for task board — CRUD, atomic checkout, status transitions,
// position management for Kanban drag & drop, and comments.

import type Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStatus = "pending" | "in_progress" | "completed" | "blocked" | "cancelled";
export type TaskPriority = "low" | "medium" | "high" | "critical";

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
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  assigneeId?: string | null;
  labels?: string[];
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/** Create a task. Position is set to MAX+100 within the pending column. */
export function createTask(db: Database.Database, input: CreateTaskInput): TaskRow {
  const maxPos = db
    .prepare(
      `SELECT COALESCE(MAX(position), 0) AS max_pos FROM rt_tasks
       WHERE instance_slug = ? AND status = 'pending'`,
    )
    .get(input.instanceSlug) as { max_pos: number };

  const result = db
    .prepare(
      `INSERT INTO rt_tasks (instance_slug, title, description, priority, assignee_id, labels, created_by, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
  return getTask(db, id);
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

/** Get active tasks (pending + in_progress) assigned to a specific agent. */
export function getActiveTasksForAgent(
  db: Database.Database,
  slug: string,
  agentId: string,
): TaskRow[] {
  return db
    .prepare(
      `SELECT * FROM rt_tasks
       WHERE instance_slug = ? AND assignee_id = ?
       AND status IN ('pending', 'in_progress')
       ORDER BY
         CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                       WHEN 'medium' THEN 2 ELSE 3 END,
         position ASC`,
    )
    .all(slug, agentId) as TaskRow[];
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
