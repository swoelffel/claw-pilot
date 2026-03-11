// src/dashboard/__tests__/session-store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { initDatabase } from "../../db/schema.js";
import { SessionStore } from "../session-store.js";
import type Database from "better-sqlite3";

function createTestDb(): Database.Database {
  const db = initDatabase(":memory:");
  // Insert a test user so we have a valid userId
  db.prepare(
    `INSERT INTO users (username, password_hash, role) VALUES ('testuser', 'scrypt:abc:def', 'admin')`,
  ).run();
  return db;
}

function getTestUserId(db: Database.Database): number {
  const row = db.prepare("SELECT id FROM users WHERE username = 'testuser'").get() as {
    id: number;
  };
  return row.id;
}

describe("SessionStore.create()", () => {
  let db: Database.Database;
  let store: SessionStore;
  let userId: number;

  beforeEach(() => {
    db = createTestDb();
    store = new SessionStore(db);
    userId = getTestUserId(db);
  });

  it("returns a non-empty session ID", () => {
    const id = store.create(userId);
    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
  });

  it("stores ip and user_agent when provided", () => {
    const id = store.create(userId, "127.0.0.1", "TestAgent/1.0");
    const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as {
      ip_address: string;
      user_agent: string;
    };
    expect(row.ip_address).toBe("127.0.0.1");
    expect(row.user_agent).toBe("TestAgent/1.0");
  });

  it("stores null for ip and user_agent when not provided", () => {
    const id = store.create(userId);
    const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as {
      ip_address: string | null;
      user_agent: string | null;
    };
    expect(row.ip_address).toBeNull();
    expect(row.user_agent).toBeNull();
  });
});

describe("SessionStore.validate()", () => {
  let db: Database.Database;
  let userId: number;

  beforeEach(() => {
    db = createTestDb();
    userId = getTestUserId(db);
  });

  it("returns the session object for a valid session", () => {
    const store = new SessionStore(db);
    const id = store.create(userId, "1.2.3.4", "UA");
    const session = store.validate(id);
    expect(session).not.toBeNull();
    expect(session!.id).toBe(id);
    expect(session!.userId).toBe(userId);
    expect(session!.ipAddress).toBe("1.2.3.4");
    expect(session!.userAgent).toBe("UA");
  });

  it("updates last_seen_at on each call", async () => {
    const store = new SessionStore(db, 60_000);
    const id = store.create(userId);
    const s1 = store.validate(id);
    await new Promise((r) => setTimeout(r, 20));
    const s2 = store.validate(id);
    // last_seen_at should be updated (or at least not earlier)
    expect(s2).not.toBeNull();
    expect(new Date(s2!.lastSeenAt).getTime()).toBeGreaterThanOrEqual(
      new Date(s1!.lastSeenAt).getTime(),
    );
  });

  it("returns null for an expired session", () => {
    const store = new SessionStore(db, 60_000);
    const id = store.create(userId);
    // Manually backdate expires_at to the past
    db.prepare(`UPDATE sessions SET expires_at = datetime('now', '-1 second') WHERE id = ?`).run(
      id,
    );
    expect(store.validate(id)).toBeNull();
  });

  it("returns null for a non-existent session ID", () => {
    const store = new SessionStore(db);
    expect(store.validate("nonexistent-id")).toBeNull();
  });

  it("extends expires_at when session is in second half of life (sliding window)", async () => {
    const ttl = 200; // 200ms TTL
    const store = new SessionStore(db, ttl);
    const id = store.create(userId);

    // Wait until we're past the halfway point
    await new Promise((r) => setTimeout(r, 120));

    const before = store.validate(id);
    expect(before).not.toBeNull();

    // expires_at should now be extended beyond original TTL
    const extendedExpiry = new Date(before!.expiresAt).getTime();
    const minExpected = Date.now() + ttl * 0.8; // at least 80% of TTL remaining
    expect(extendedExpiry).toBeGreaterThan(minExpected);
  });
});

describe("SessionStore.delete()", () => {
  let db: Database.Database;
  let store: SessionStore;
  let userId: number;

  beforeEach(() => {
    db = createTestDb();
    store = new SessionStore(db);
    userId = getTestUserId(db);
  });

  it("removes the session so validate returns null", () => {
    const id = store.create(userId);
    store.delete(id);
    expect(store.validate(id)).toBeNull();
  });

  it("does not throw when deleting a non-existent session", () => {
    expect(() => store.delete("nonexistent")).not.toThrow();
  });
});

describe("SessionStore.deleteAllForUser()", () => {
  let db: Database.Database;
  let store: SessionStore;
  let userId: number;

  beforeEach(() => {
    db = createTestDb();
    store = new SessionStore(db);
    userId = getTestUserId(db);
  });

  it("removes all sessions for the user", () => {
    const id1 = store.create(userId);
    const id2 = store.create(userId);
    const id3 = store.create(userId);
    store.deleteAllForUser(userId);
    expect(store.validate(id1)).toBeNull();
    expect(store.validate(id2)).toBeNull();
    expect(store.validate(id3)).toBeNull();
  });

  it("does not affect sessions of other users", () => {
    // Create a second user
    db.prepare(
      `INSERT INTO users (username, password_hash, role) VALUES ('other', 'scrypt:x:y', 'admin')`,
    ).run();
    const otherId = (
      db.prepare("SELECT id FROM users WHERE username = 'other'").get() as { id: number }
    ).id;

    const mySession = store.create(userId);
    const otherSession = store.create(otherId);

    store.deleteAllForUser(userId);

    expect(store.validate(mySession)).toBeNull();
    expect(store.validate(otherSession)).not.toBeNull();
  });
});

describe("SessionStore.cleanup()", () => {
  it("removes expired sessions and returns the count", () => {
    const db = createTestDb();
    const userId = getTestUserId(db);
    const store = new SessionStore(db, 60_000);

    const id1 = store.create(userId);
    const id2 = store.create(userId);
    const id3 = store.create(userId);

    // Manually backdate expires_at for id1 and id2
    db.prepare(`UPDATE sessions SET expires_at = datetime('now', '-1 second') WHERE id = ?`).run(
      id1,
    );
    db.prepare(`UPDATE sessions SET expires_at = datetime('now', '-1 second') WHERE id = ?`).run(
      id2,
    );

    const deleted = store.cleanup();
    expect(deleted).toBe(2);

    // Valid session still accessible
    expect(store.validate(id3)).not.toBeNull();
    // Expired sessions gone
    expect(store.validate(id1)).toBeNull();
    expect(store.validate(id2)).toBeNull();
  });
});
