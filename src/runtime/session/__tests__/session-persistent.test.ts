/**
 * runtime/session/__tests__/session-persistent.test.ts
 *
 * Tests for PLAN-15a Phase 0 — persistent session features:
 *   - buildPermanentSessionKey() — cross-channel key format
 *   - buildSessionKey() — unchanged ephemeral key format
 *   - createSession({ persistent: true/false }) — persistent flag storage
 *   - Session key format differs between permanent and ephemeral sessions
 *   - archiveSession() guard: permanent sessions resist archiving without force
 *   - archiveSession({ force: true }) bypasses the guard
 *
 * Uses an in-memory SQLite database (":memory:") via initDatabase().
 */

import { describe, it, expect, beforeEach } from "vitest";
import { initDatabase } from "../../../db/schema.js";
import type Database from "better-sqlite3";
import {
  buildSessionKey,
  buildPermanentSessionKey,
  createSession,
  getSession,
  archiveSession,
} from "../session.js";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let db: Database.Database;

/** Seed a minimal instance so FK constraints on rt_sessions are satisfied. */
function seedInstance(db: Database.Database, slug: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO servers (hostname, openclaw_home) VALUES ('localhost', '/opt/openclaw')`,
  ).run();
  const server = db.prepare("SELECT id FROM servers LIMIT 1").get() as { id: number };
  db.prepare(
    `INSERT OR IGNORE INTO instances
       (server_id, slug, port, config_path, state_dir, systemd_unit)
       VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(server.id, slug, 19010, "/tmp/config.json", "/tmp/state", "test.service");
}

beforeEach(() => {
  db = initDatabase(":memory:");
  seedInstance(db, "test-instance");
});

// ---------------------------------------------------------------------------
// Suite 1 — buildPermanentSessionKey()
// ---------------------------------------------------------------------------

describe("buildPermanentSessionKey()", () => {
  it(// Positive: verifies the cross-channel format "<slug>:<agentId>:<peerId>"
  // (no channel component — permanent sessions are shared across channels).
  "returns '<slug>:<agentId>' when slug and agentId are provided", () => {
    // Arrange
    const slug = "my-instance";
    const agentId = "main";

    // Act
    const key = buildPermanentSessionKey(slug, agentId);

    // Assert
    expect(key).toBe("my-instance:main");
  });

  it("permanent key is independent of peerId", () => {
    // Arrange
    const slug = "my-instance";
    const agentId = "main";

    // Act
    const key = buildPermanentSessionKey(slug, agentId);

    // Assert — same key regardless of peerId
    expect(key).toBe("my-instance:main");
  });

  it("permanent key has fewer segments than ephemeral key", () => {
    // Arrange
    const slug = "inst";
    const agentId = "build";
    const peerId = "peer-1";

    // Act
    const permanentKey = buildPermanentSessionKey(slug, agentId);
    const ephemeralKey = buildSessionKey(slug, agentId, "web", peerId);

    // Assert — permanent key has 1 colon (2 segments), ephemeral has 3 colons (4 segments)
    expect(permanentKey.split(":").length).toBe(2);
    expect(ephemeralKey.split(":").length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — buildSessionKey() — unchanged ephemeral format
// ---------------------------------------------------------------------------

describe("buildSessionKey() — unchanged ephemeral format", () => {
  it(// Positive: verifies the existing format "<slug>:<agentId>:<channel>:<peerId>"
  // is unchanged by the v13 changes (no regression).
  "returns '<slug>:<agentId>:<channel>:<peerId>' — format unchanged", () => {
    // Arrange
    const slug = "my-instance";
    const agentId = "main";
    const channel = "telegram";
    const peerId = "user-42";

    // Act
    const key = buildSessionKey(slug, agentId, channel, peerId);

    // Assert
    expect(key).toBe("my-instance:main:telegram:user-42");
  });

  it(// Negative: undefined peerId falls back to "unknown" — same as before v13.
  "returns '<slug>:<agentId>:<channel>:unknown' when peerId is undefined", () => {
    // Arrange + Act
    const key = buildSessionKey("inst", "agent", "web", undefined);

    // Assert
    expect(key).toBe("inst:agent:web:unknown");
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — createSession() — persistent flag
// ---------------------------------------------------------------------------

describe("createSession() — persistent flag", () => {
  it(// Positive: createSession with persistent: true must store persistent = true.
  "createSession({ persistent: true }) → session.persistent === true", () => {
    // Arrange + Act
    const session = createSession(db, {
      instanceSlug: "test-instance",
      agentId: "main",
      peerId: "user-1",
      persistent: true,
    });

    // Assert
    expect(session.persistent).toBe(true);
  });

  it(// Positive: createSession with persistent: false must store persistent = false.
  "createSession({ persistent: false }) → session.persistent === false", () => {
    // Arrange + Act
    const session = createSession(db, {
      instanceSlug: "test-instance",
      agentId: "main",
      persistent: false,
    });

    // Assert
    expect(session.persistent).toBe(false);
  });

  it(// Positive: createSession without persistent must default to false (ephemeral).
  // Backward-compat: existing callers that don't pass persistent get ephemeral sessions.
  "createSession({}) → session.persistent === false (default)", () => {
    // Arrange + Act
    const session = createSession(db, {
      instanceSlug: "test-instance",
      agentId: "main",
    });

    // Assert
    expect(session.persistent).toBe(false);
  });

  it(// Positive: persistent flag must be stored in the DB (not just in the returned object).
  // Verifies the INTEGER column is correctly written and read back.
  "persistent flag is persisted in the DB (read back via getSession)", () => {
    // Arrange
    const session = createSession(db, {
      instanceSlug: "test-instance",
      agentId: "main",
      peerId: "user-2",
      persistent: true,
    });

    // Act — read back from DB
    const reloaded = getSession(db, session.id);

    // Assert
    expect(reloaded?.persistent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suite 4 — Session key format: permanent vs ephemeral
// ---------------------------------------------------------------------------

describe("session key format — permanent vs ephemeral", () => {
  it(// Positive: a permanent session must use the agent-scoped key format
  // "<slug>:<agentId>" (2 segments, no channel, no peerId).
  "permanent session has a session_key without channel or peerId (2 segments)", () => {
    // Arrange + Act
    const session = createSession(db, {
      instanceSlug: "test-instance",
      agentId: "main",
      peerId: "user-3",
      persistent: true,
    });

    // Assert — key has exactly 2 segments (no channel, no peerId)
    expect(session.sessionKey).toBeDefined();
    expect(session.sessionKey!.split(":").length).toBe(2);
    expect(session.sessionKey).toBe("test-instance:main");
  });

  it(// Positive: an ephemeral session must use the channel-scoped key format
  // "<slug>:<agentId>:<channel>:<peerId>" (4 segments).
  "ephemeral session has a session_key with channel (4 segments)", () => {
    // Arrange + Act
    const session = createSession(db, {
      instanceSlug: "test-instance",
      agentId: "main",
      channel: "telegram",
      peerId: "user-4",
      persistent: false,
    });

    // Assert — key has exactly 4 segments (includes channel)
    expect(session.sessionKey).toBeDefined();
    expect(session.sessionKey!.split(":").length).toBe(4);
    expect(session.sessionKey).toBe("test-instance:main:telegram:user-4");
  });
});

// ---------------------------------------------------------------------------
// Suite 5 — archiveSession() guard for permanent sessions
// ---------------------------------------------------------------------------

describe("archiveSession() — permanent session guard", () => {
  it(// Negative: archiveSession() without force on a persistent session must be a no-op.
  // The session must remain 'active' — the guard protects permanent sessions.
  "archiveSession(db, id) on persistent=true → session remains 'active' (guard)", () => {
    // Arrange
    const session = createSession(db, {
      instanceSlug: "test-instance",
      agentId: "main",
      peerId: "user-5",
      persistent: true,
    });
    expect(session.state).toBe("active");

    // Act — attempt to archive without force
    archiveSession(db, session.id);

    // Assert — session must still be active
    const reloaded = getSession(db, session.id);
    expect(reloaded?.state).toBe("active");
  });

  it(// Positive: archiveSession({ force: true }) on a persistent session must archive it.
  // The force flag bypasses the guard for admin cleanup.
  "archiveSession(db, id, { force: true }) on persistent=true → session archived", () => {
    // Arrange
    const session = createSession(db, {
      instanceSlug: "test-instance",
      agentId: "main",
      peerId: "user-6",
      persistent: true,
    });

    // Act — archive with force
    archiveSession(db, session.id, { force: true });

    // Assert — session must now be archived
    const reloaded = getSession(db, session.id);
    expect(reloaded?.state).toBe("archived");
  });

  it(// Positive: archiveSession() on a non-persistent session must archive it normally.
  // Verifies the guard does not affect ephemeral sessions (no regression).
  "archiveSession(db, id) on persistent=false → session archived normally", () => {
    // Arrange
    const session = createSession(db, {
      instanceSlug: "test-instance",
      agentId: "main",
      persistent: false,
    });
    expect(session.state).toBe("active");

    // Act
    archiveSession(db, session.id);

    // Assert — ephemeral session must be archived
    const reloaded = getSession(db, session.id);
    expect(reloaded?.state).toBe("archived");
  });
});
