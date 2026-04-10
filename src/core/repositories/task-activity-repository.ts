// src/core/repositories/task-activity-repository.ts
//
// Repository for task activity timeline — chronological log of all task mutations.

import type Database from "better-sqlite3";
import type { TaskRow, UpdateTaskInput } from "./task-repository.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskActivityType =
  | "created"
  | "status_changed"
  | "assigned"
  | "priority_changed"
  | "title_changed"
  | "description_changed"
  | "labels_changed"
  | "parent_changed"
  | "comment";

export interface TaskActivityRow {
  id: number;
  task_id: number;
  activity_type: TaskActivityType;
  actor_id: string;
  details_json: string | null;
  created_at: string;
}

export interface InsertActivityInput {
  taskId: number;
  activityType: TaskActivityType;
  actorId: string;
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Insert
// ---------------------------------------------------------------------------

/** Insert a single activity entry and return the row. */
export function insertActivity(db: Database.Database, input: InsertActivityInput): TaskActivityRow {
  const detailsJson = input.details ? JSON.stringify(input.details) : null;
  const result = db
    .prepare(
      `INSERT INTO rt_task_activities (task_id, activity_type, actor_id, details_json)
       VALUES (?, ?, ?, ?)`,
    )
    .run(input.taskId, input.activityType, input.actorId, detailsJson);
  return db
    .prepare("SELECT * FROM rt_task_activities WHERE id = ?")
    .get(result.lastInsertRowid) as TaskActivityRow;
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/** Get activities for a task in chronological order (oldest first). */
export function getActivities(
  db: Database.Database,
  taskId: number,
  opts?: { limit?: number; offset?: number },
): TaskActivityRow[] {
  const limit = Math.min(opts?.limit ?? 100, 500);
  const offset = opts?.offset ?? 0;
  return db
    .prepare(
      `SELECT * FROM rt_task_activities
       WHERE task_id = ?
       ORDER BY created_at ASC, id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(taskId, limit, offset) as TaskActivityRow[];
}

/** Get total activity count for a task. */
export function getActivityCount(db: Database.Database, taskId: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS cnt FROM rt_task_activities WHERE task_id = ?")
    .get(taskId) as { cnt: number };
  return row.cnt;
}

// ---------------------------------------------------------------------------
// Field change detection
// ---------------------------------------------------------------------------

/**
 * Compare a before-snapshot with the requested updates and insert one activity
 * per actually-changed field. Returns the number of activities inserted.
 */
export function recordFieldChanges(
  db: Database.Database,
  taskId: number,
  actorId: string,
  before: TaskRow,
  updates: UpdateTaskInput,
): number {
  let count = 0;

  if (updates.title !== undefined && updates.title !== before.title) {
    insertActivity(db, {
      taskId,
      activityType: "title_changed",
      actorId,
      details: { from: before.title, to: updates.title },
    });
    count++;
  }

  if (updates.description !== undefined && updates.description !== (before.description ?? "")) {
    insertActivity(db, {
      taskId,
      activityType: "description_changed",
      actorId,
    });
    count++;
  }

  if (updates.priority !== undefined && updates.priority !== before.priority) {
    insertActivity(db, {
      taskId,
      activityType: "priority_changed",
      actorId,
      details: { from: before.priority, to: updates.priority },
    });
    count++;
  }

  if (updates.assigneeId !== undefined && updates.assigneeId !== before.assignee_id) {
    insertActivity(db, {
      taskId,
      activityType: "assigned",
      actorId,
      details: { from: before.assignee_id, to: updates.assigneeId },
    });
    count++;
  }

  if (updates.labels !== undefined) {
    const beforeLabels = before.labels ? (JSON.parse(before.labels) as string[]) : [];
    const afterLabels = updates.labels;
    if (JSON.stringify(beforeLabels) !== JSON.stringify(afterLabels)) {
      insertActivity(db, {
        taskId,
        activityType: "labels_changed",
        actorId,
        details: { from: beforeLabels, to: afterLabels },
      });
      count++;
    }
  }

  if (updates.parentId !== undefined && updates.parentId !== before.parent_id) {
    insertActivity(db, {
      taskId,
      activityType: "parent_changed",
      actorId,
      details: { from: before.parent_id, to: updates.parentId },
    });
    count++;
  }

  return count;
}
