/**
 * runtime/session/cleanup.ts
 *
 * Periodic cleanup of archived ephemeral sessions.
 * Deletes sessions, messages, and parts of subagents beyond the retention period.
 *
 * Rules:
 * - Only deletes sessions with persistent=0 (ephemeral)
 * - Only deletes sessions with state='archived'
 * - Respects the configurable retention period
 * - Deletes in cascade: parts → messages → sessions (FK order)
 */

import type Database from "better-sqlite3";

export interface CleanupResult {
  sessionsDeleted: number;
  messagesDeleted: number;
  partsDeleted: number;
  durationMs: number;
}

/**
 * Delete archived ephemeral sessions older than retentionHours.
 * Returns deletion statistics.
 * retentionHours=0 means keep forever (no cleanup).
 */
export function cleanupEphemeralSessions(
  db: Database.Database,
  instanceSlug: string,
  retentionHours: number,
): CleanupResult {
  if (retentionHours <= 0) {
    return { sessionsDeleted: 0, messagesDeleted: 0, partsDeleted: 0, durationMs: 0 };
  }

  const start = Date.now();
  const cutoff = new Date(Date.now() - retentionHours * 3_600_000).toISOString();

  const sessionsToDelete = db
    .prepare(
      `SELECT id FROM rt_sessions
       WHERE instance_slug = ?
         AND state = 'archived'
         AND persistent = 0
         AND updated_at < ?`,
    )
    .all(instanceSlug, cutoff) as Array<{ id: string }>;

  if (sessionsToDelete.length === 0) {
    return {
      sessionsDeleted: 0,
      messagesDeleted: 0,
      partsDeleted: 0,
      durationMs: Date.now() - start,
    };
  }

  const sessionIds = sessionsToDelete.map((s) => s.id);
  const placeholders = sessionIds.map(() => "?").join(", ");

  const deleteAll = db.transaction(() => {
    const partsResult = db
      .prepare(
        `DELETE FROM rt_parts
         WHERE message_id IN (
           SELECT id FROM rt_messages WHERE session_id IN (${placeholders})
         )`,
      )
      .run(...sessionIds);

    const messagesResult = db
      .prepare(`DELETE FROM rt_messages WHERE session_id IN (${placeholders})`)
      .run(...sessionIds);

    const sessionsResult = db
      .prepare(`DELETE FROM rt_sessions WHERE id IN (${placeholders})`)
      .run(...sessionIds);

    return {
      partsDeleted: partsResult.changes,
      messagesDeleted: messagesResult.changes,
      sessionsDeleted: sessionsResult.changes,
    };
  });

  const result = deleteAll();
  return { ...result, durationMs: Date.now() - start };
}
