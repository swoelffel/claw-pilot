// src/core/repositories/notification-repository.ts
//
// Repository for the persistent notification inbox (notifications table).
// Cross-instance notifications with deduplication, read state, and cleanup.

import type Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationSeverity = "info" | "warning" | "error" | "success";

export interface NotificationRow {
  id: number;
  instance_slug: string | null;
  event_type: string;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  link_route: string | null;
  dedup_key: string | null;
  is_read: number;
  created_at: string;
}

export interface NotificationsPage {
  notifications: NotificationRow[];
  nextCursor: number | null;
}

export interface InsertNotificationParams {
  instanceSlug?: string;
  eventType: string;
  severity: NotificationSeverity;
  title: string;
  body?: string;
  linkRoute?: string;
  dedupKey?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEDUP_WINDOW_MINUTES = 15;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

// ---------------------------------------------------------------------------
// Insert (with deduplication)
// ---------------------------------------------------------------------------

/**
 * Insert a notification with optional deduplication.
 * If `dedupKey` is provided and a notification with the same key exists within
 * the last DEDUP_WINDOW_MINUTES, the insert is skipped and null is returned.
 */
export function insertNotification(
  db: Database.Database,
  params: InsertNotificationParams,
): NotificationRow | null {
  // 1. Dedup check
  if (params.dedupKey) {
    const existing = db
      .prepare(
        `SELECT id FROM notifications
         WHERE dedup_key = ? AND created_at > datetime('now', '-${DEDUP_WINDOW_MINUTES} minutes')
         LIMIT 1`,
      )
      .get(params.dedupKey) as { id: number } | undefined;
    if (existing) return null;
  }

  // 2. Insert
  const result = db
    .prepare(
      `INSERT INTO notifications (instance_slug, event_type, severity, title, body, link_route, dedup_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    .run(
      params.instanceSlug ?? null,
      params.eventType,
      params.severity,
      params.title,
      params.body ?? null,
      params.linkRoute ?? null,
      params.dedupKey ?? null,
    );

  // 3. Return the inserted row
  return db
    .prepare("SELECT * FROM notifications WHERE id = ?")
    .get(result.lastInsertRowid) as NotificationRow;
}

// ---------------------------------------------------------------------------
// Query (cursor-based pagination)
// ---------------------------------------------------------------------------

export interface ListNotificationsParams {
  cursor?: number;
  limit?: number;
  unreadOnly?: boolean;
}

/** List notifications with cursor-based pagination (newest first). */
export function listNotifications(
  db: Database.Database,
  params: ListNotificationsParams = {},
): NotificationsPage {
  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (params.cursor !== undefined) {
    conditions.push("id < ?");
    bindings.push(params.cursor);
  }

  if (params.unreadOnly) {
    conditions.push("is_read = 0");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = db
    .prepare(`SELECT * FROM notifications ${where} ORDER BY id DESC LIMIT ?`)
    .all(...bindings, limit + 1) as NotificationRow[];

  const hasMore = rows.length > limit;
  const notifications = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? notifications[notifications.length - 1]!.id : null;

  return { notifications, nextCursor };
}

// ---------------------------------------------------------------------------
// Count unread
// ---------------------------------------------------------------------------

/** Count unread notifications. */
export function countUnread(db: Database.Database): number {
  const row = db.prepare("SELECT COUNT(*) AS cnt FROM notifications WHERE is_read = 0").get() as {
    cnt: number;
  };
  return row.cnt;
}

// ---------------------------------------------------------------------------
// Mark read
// ---------------------------------------------------------------------------

/** Mark a single notification as read. */
export function markRead(db: Database.Database, id: number): void {
  db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ?").run(id);
}

/** Mark all notifications as read. */
export function markAllRead(db: Database.Database): void {
  db.prepare("UPDATE notifications SET is_read = 1 WHERE is_read = 0").run();
}

// ---------------------------------------------------------------------------
// Prune
// ---------------------------------------------------------------------------

/** Delete notifications older than the specified number of days. Returns deleted count. */
export function pruneNotifications(db: Database.Database, olderThanDays = 30): number {
  const result = db
    .prepare(
      `DELETE FROM notifications
       WHERE created_at < datetime('now', '-' || ? || ' days')`,
    )
    .run(olderThanDays);
  return result.changes;
}
