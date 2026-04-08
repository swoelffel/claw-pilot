import type Database from "better-sqlite3";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { initDatabase } from "../../../db/schema.js";
import { cleanupEphemeralSessions } from "../cleanup.js";

vi.mock("../system-prompt-dirty.js", () => ({ clearSessionDirtyState: vi.fn() }));
vi.mock("../system-prompt-cache.js", () => ({ clearCachedSystemPrompt: vi.fn() }));

import { clearSessionDirtyState } from "../system-prompt-dirty.js";
import { clearCachedSystemPrompt } from "../system-prompt-cache.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INSTANCE_SLUG = "test-instance";

function seedInstance(db: Database.Database, slug: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO servers (hostname, openclaw_home) VALUES ('localhost', '/opt/openclaw')`,
  ).run();
  const server = db.prepare("SELECT id FROM servers LIMIT 1").get() as { id: number };
  db.prepare(
    `INSERT OR IGNORE INTO instances (server_id, slug, port, config_path, state_dir, systemd_unit) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(server.id, slug, 19010, "/tmp/config.json", "/tmp/state", "test.service");
}

function insertSession(
  db: Database.Database,
  opts: { id: string; slug: string; state: string; persistent: number; updatedAt: string },
): void {
  db.prepare(
    `INSERT INTO rt_sessions (id, instance_slug, agent_id, session_key, state, persistent, created_at, updated_at) VALUES (?, ?, 'main', ?, ?, ?, ?, ?)`,
  ).run(
    opts.id,
    opts.slug,
    `${opts.slug}:main:web:${opts.id}`,
    opts.state,
    opts.persistent,
    opts.updatedAt,
    opts.updatedAt,
  );
}

function insertMessage(db: Database.Database, id: string, sessionId: string): void {
  db.prepare(
    `INSERT INTO rt_messages (id, session_id, role, agent_id, created_at) VALUES (?, ?, 'user', 'main', datetime('now'))`,
  ).run(id, sessionId);
}

function insertPart(db: Database.Database, messageId: string, id: string): void {
  db.prepare(
    `INSERT INTO rt_parts (id, message_id, type, content, created_at) VALUES (?, ?, 'text', 'hello', datetime('now'))`,
  ).run(id, messageId);
}

/** Timestamp N hours ago in ISO format */
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

function countRows(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cleanupEphemeralSessions", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
    seedInstance(db, INSTANCE_SLUG);
    vi.clearAllMocks();
  });

  // 1. retentionHours=0 returns early with all zeros
  it("returns early with all zeros when retentionHours is 0", () => {
    const result = cleanupEphemeralSessions(db, INSTANCE_SLUG, 0);
    expect(result).toEqual({
      sessionsDeleted: 0,
      messagesDeleted: 0,
      partsDeleted: 0,
      durationMs: 0,
    });
  });

  // 2. retentionHours negative returns early with all zeros
  it("returns early with all zeros when retentionHours is negative", () => {
    const result = cleanupEphemeralSessions(db, INSTANCE_SLUG, -5);
    expect(result).toEqual({
      sessionsDeleted: 0,
      messagesDeleted: 0,
      partsDeleted: 0,
      durationMs: 0,
    });
  });

  // 3. no matching sessions returns zeros (with durationMs >= 0)
  it("returns zeros when no matching sessions exist", () => {
    const result = cleanupEphemeralSessions(db, INSTANCE_SLUG, 24);
    expect(result.sessionsDeleted).toBe(0);
    expect(result.messagesDeleted).toBe(0);
    expect(result.partsDeleted).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  // 4. deletes only archived + ephemeral sessions older than cutoff
  it("deletes archived ephemeral sessions past the retention window", () => {
    insertSession(db, {
      id: "s-old",
      slug: INSTANCE_SLUG,
      state: "archived",
      persistent: 0,
      updatedAt: hoursAgo(48),
    });

    const result = cleanupEphemeralSessions(db, INSTANCE_SLUG, 24);
    expect(result.sessionsDeleted).toBe(1);
    expect(countRows(db, "rt_sessions")).toBe(0);
  });

  // 5. does NOT delete persistent sessions
  it("does NOT delete persistent sessions even if archived and old", () => {
    insertSession(db, {
      id: "s-persistent",
      slug: INSTANCE_SLUG,
      state: "archived",
      persistent: 1,
      updatedAt: hoursAgo(48),
    });

    const result = cleanupEphemeralSessions(db, INSTANCE_SLUG, 24);
    expect(result.sessionsDeleted).toBe(0);
    expect(countRows(db, "rt_sessions")).toBe(1);
  });

  // 6. does NOT delete non-archived sessions
  it("does NOT delete active sessions even if ephemeral and old", () => {
    insertSession(db, {
      id: "s-active",
      slug: INSTANCE_SLUG,
      state: "active",
      persistent: 0,
      updatedAt: hoursAgo(48),
    });

    const result = cleanupEphemeralSessions(db, INSTANCE_SLUG, 24);
    expect(result.sessionsDeleted).toBe(0);
    expect(countRows(db, "rt_sessions")).toBe(1);
  });

  // 7. respects time cutoff — recent sessions not deleted
  it("does NOT delete sessions within the retention window", () => {
    insertSession(db, {
      id: "s-recent",
      slug: INSTANCE_SLUG,
      state: "archived",
      persistent: 0,
      updatedAt: hoursAgo(1), // only 1 hour old, retention is 24
    });

    const result = cleanupEphemeralSessions(db, INSTANCE_SLUG, 24);
    expect(result.sessionsDeleted).toBe(0);
    expect(countRows(db, "rt_sessions")).toBe(1);
  });

  // 8. cascade delete: parts -> messages -> sessions all deleted
  it("cascade deletes parts, messages, and sessions", () => {
    insertSession(db, {
      id: "s1",
      slug: INSTANCE_SLUG,
      state: "archived",
      persistent: 0,
      updatedAt: hoursAgo(48),
    });
    insertMessage(db, "m1", "s1");
    insertMessage(db, "m2", "s1");
    insertPart(db, "m1", "p1");
    insertPart(db, "m1", "p2");
    insertPart(db, "m2", "p3");

    const result = cleanupEphemeralSessions(db, INSTANCE_SLUG, 24);
    expect(result.sessionsDeleted).toBe(1);
    expect(result.messagesDeleted).toBe(2);
    expect(result.partsDeleted).toBe(3);
    expect(countRows(db, "rt_sessions")).toBe(0);
    expect(countRows(db, "rt_messages")).toBe(0);
    expect(countRows(db, "rt_parts")).toBe(0);
  });

  // 9. clears in-memory caches for deleted sessions
  it("clears in-memory caches for every deleted session", () => {
    insertSession(db, {
      id: "s-cache-1",
      slug: INSTANCE_SLUG,
      state: "archived",
      persistent: 0,
      updatedAt: hoursAgo(48),
    });
    insertSession(db, {
      id: "s-cache-2",
      slug: INSTANCE_SLUG,
      state: "archived",
      persistent: 0,
      updatedAt: hoursAgo(72),
    });

    cleanupEphemeralSessions(db, INSTANCE_SLUG, 24);

    expect(clearSessionDirtyState).toHaveBeenCalledWith("s-cache-1");
    expect(clearSessionDirtyState).toHaveBeenCalledWith("s-cache-2");
    expect(clearCachedSystemPrompt).toHaveBeenCalledWith("s-cache-1");
    expect(clearCachedSystemPrompt).toHaveBeenCalledWith("s-cache-2");
    expect(clearSessionDirtyState).toHaveBeenCalledTimes(2);
    expect(clearCachedSystemPrompt).toHaveBeenCalledTimes(2);
  });

  // 10. handles multiple sessions with messages and parts — mixed eligibility
  it("handles a mix of eligible and ineligible sessions correctly", () => {
    // Eligible: archived, ephemeral, old
    insertSession(db, {
      id: "s-del-1",
      slug: INSTANCE_SLUG,
      state: "archived",
      persistent: 0,
      updatedAt: hoursAgo(100),
    });
    insertMessage(db, "m-del-1", "s-del-1");
    insertPart(db, "m-del-1", "p-del-1");

    insertSession(db, {
      id: "s-del-2",
      slug: INSTANCE_SLUG,
      state: "archived",
      persistent: 0,
      updatedAt: hoursAgo(50),
    });
    insertMessage(db, "m-del-2", "s-del-2");
    insertPart(db, "m-del-2", "p-del-2a");
    insertPart(db, "m-del-2", "p-del-2b");

    // NOT eligible: persistent
    insertSession(db, {
      id: "s-keep-persistent",
      slug: INSTANCE_SLUG,
      state: "archived",
      persistent: 1,
      updatedAt: hoursAgo(100),
    });
    insertMessage(db, "m-keep-1", "s-keep-persistent");
    insertPart(db, "m-keep-1", "p-keep-1");

    // NOT eligible: active
    insertSession(db, {
      id: "s-keep-active",
      slug: INSTANCE_SLUG,
      state: "active",
      persistent: 0,
      updatedAt: hoursAgo(100),
    });
    insertMessage(db, "m-keep-2", "s-keep-active");

    // NOT eligible: recent
    insertSession(db, {
      id: "s-keep-recent",
      slug: INSTANCE_SLUG,
      state: "archived",
      persistent: 0,
      updatedAt: hoursAgo(1),
    });

    const result = cleanupEphemeralSessions(db, INSTANCE_SLUG, 24);

    // Only the 2 eligible sessions deleted
    expect(result.sessionsDeleted).toBe(2);
    expect(result.messagesDeleted).toBe(2);
    expect(result.partsDeleted).toBe(3);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Remaining rows: 3 sessions, 2 messages, 1 part
    expect(countRows(db, "rt_sessions")).toBe(3);
    expect(countRows(db, "rt_messages")).toBe(2);
    expect(countRows(db, "rt_parts")).toBe(1);

    // Cache cleared only for deleted sessions
    expect(clearSessionDirtyState).toHaveBeenCalledTimes(2);
    expect(clearCachedSystemPrompt).toHaveBeenCalledTimes(2);
  });
});
