// src/dashboard/session-store.ts
import { nanoid } from "nanoid";
import type Database from "better-sqlite3";

export interface Session {
  id: string;
  userId: number;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

interface SessionRow {
  id: string;
  user_id: number;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
  ip_address: string | null;
  user_agent: string | null;
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
  };
}

export class SessionStore {
  constructor(
    private db: Database.Database,
    private ttlMs: number = 24 * 60 * 60 * 1000, // 24h default
  ) {}

  /**
   * Create a new session for a user.
   * Returns the session ID (nanoid).
   */
  create(userId: number, ip?: string, ua?: string): string {
    const id = nanoid();
    const expiresAt = new Date(Date.now() + this.ttlMs).toISOString();
    this.db
      .prepare(
        `INSERT INTO sessions (id, user_id, expires_at, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, userId, expiresAt, ip ?? null, ua ?? null);
    return id;
  }

  /**
   * Validate a session ID.
   * Returns the Session if valid and not expired, null otherwise.
   * Updates last_seen_at on every call.
   * Applies sliding window: if the session is in its second half of life,
   * extends expires_at by ttlMs.
   */
  validate(sessionId: string): Session | null {
    const row = this.db
      .prepare(
        `SELECT * FROM sessions
         WHERE id = ? AND expires_at > datetime('now')`,
      )
      .get(sessionId) as SessionRow | undefined;

    if (!row) return null;

    const now = Date.now();
    const createdAt = new Date(row.created_at).getTime();
    const halfLife = createdAt + this.ttlMs / 2;

    if (now > halfLife) {
      // In second half of life — extend expiry (sliding window)
      const newExpiresAt = new Date(now + this.ttlMs).toISOString();
      this.db
        .prepare(
          `UPDATE sessions
           SET last_seen_at = datetime('now'), expires_at = ?
           WHERE id = ?`,
        )
        .run(newExpiresAt, sessionId);
      return rowToSession({ ...row, expires_at: newExpiresAt });
    } else {
      // In first half — just update last_seen_at
      this.db
        .prepare(
          `UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?`,
        )
        .run(sessionId);
      return rowToSession(row);
    }
  }

  /**
   * Delete a specific session (logout).
   */
  delete(sessionId: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
  }

  /**
   * Delete all sessions for a user (e.g. after password reset).
   */
  deleteAllForUser(userId: number): void {
    this.db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
  }

  /**
   * Remove all expired sessions.
   * Returns the number of sessions deleted.
   */
  cleanup(): number {
    const result = this.db
      .prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`)
      .run();
    return result.changes;
  }
}
