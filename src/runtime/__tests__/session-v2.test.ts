/**
 * runtime/__tests__/session-v2.test.ts
 *
 * Tests for v0.21.0 session features:
 *   - buildSessionKey()
 *   - createSession() — spawnDepth, sessionKey, label, metadata
 *   - getSessionByKey()
 *   - countActiveChildren()
 *   - forkSession() with message/part history copy
 *
 * Uses an in-memory SQLite database (":memory:") via initDatabase().
 * Follows the same setup pattern as session.test.ts.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { initDatabase } from "../../db/schema.js";
import type Database from "better-sqlite3";
import {
  buildSessionKey,
  createSession,
  getSession,
  getSessionByKey,
  countActiveChildren,
  archiveSession,
  forkSession,
} from "../session/session.js";
import { createUserMessage, createAssistantMessage, listMessages } from "../session/message.js";
import { createPart, listParts } from "../session/part.js";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let db: Database.Database;

/** Seed a minimal instance so FK constraints on rt_sessions are satisfied. */
function seedInstance(db: Database.Database, slug: string) {
  db.prepare(
    `INSERT OR IGNORE INTO servers (hostname, openclaw_home) VALUES ('localhost', '/opt/openclaw')`,
  ).run();
  const server = db.prepare("SELECT id FROM servers LIMIT 1").get() as { id: number };

  db.prepare(
    `INSERT OR IGNORE INTO instances
     (server_id, slug, port, config_path, state_dir, systemd_unit)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(server.id, slug, 19001, "/tmp/config.json", "/tmp/state", "openclaw-test.service");
}

beforeEach(() => {
  db = initDatabase(":memory:");
  seedInstance(db, "test-instance");
});

// ---------------------------------------------------------------------------
// Suite 1 — buildSessionKey()
// ---------------------------------------------------------------------------

describe("buildSessionKey()", () => {
  it(// Positive: verifies the happy-path format "<slug>:<agentId>:<channel>:<peerId>"
  "returns '<slug>:<agentId>:<channel>:<peerId>' when peerId is defined", () => {
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

  it(// Negative: verifies that undefined peerId falls back to the literal "unknown"
  "returns '<slug>:<agentId>:<channel>:unknown' when peerId is undefined", () => {
    // Arrange
    const slug = "my-instance";
    const agentId = "main";
    const channel = "web";
    const peerId = undefined;

    // Act
    const key = buildSessionKey(slug, agentId, channel, peerId);

    // Assert
    expect(key).toBe("my-instance:main:web:unknown");
  });

  it(// Positive: verifies that slugs with hyphens and underscores are preserved verbatim
  "handles slugs with hyphens and underscores", () => {
    // Arrange
    const slug = "my_instance-01";
    const agentId = "sub_agent-2";
    const channel = "web";
    const peerId = "peer_id-99";

    // Act
    const key = buildSessionKey(slug, agentId, channel, peerId);

    // Assert
    expect(key).toBe("my_instance-01:sub_agent-2:web:peer_id-99");
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — createSession() — new columns (spawnDepth, sessionKey, label, metadata)
// ---------------------------------------------------------------------------

describe("createSession() — new columns", () => {
  it(// Positive: root session (no parentId) must have spawnDepth = 0
  "sets spawnDepth = 0 for a root session (no parentId)", () => {
    // Arrange + Act
    const session = createSession(db, {
      instanceSlug: "test-instance",
      agentId: "main",
    });

    // Assert
    expect(session.spawnDepth).toBe(0);
  });

  it(// Positive: direct child of a root session must have spawnDepth = 1
  "sets spawnDepth = 1 for a direct child session", () => {
    // Arrange
    const parent = createSession(db, { instanceSlug: "test-instance", agentId: "main" });

    // Act
    const child = createSession(db, {
      instanceSlug: "test-instance",
      agentId: "sub",
      parentId: parent.id,
    });

    // Assert
    expect(child.spawnDepth).toBe(1);
  });

  it(// Positive: grandchild session must have spawnDepth = 2
  "sets spawnDepth = 2 for a grandchild session", () => {
    // Arrange
    const root = createSession(db, { instanceSlug: "test-instance", agentId: "main" });
    const child = createSession(db, {
      instanceSlug: "test-instance",
      agentId: "sub",
      parentId: root.id,
    });

    // Act
    const grandchild = createSession(db, {
      instanceSlug: "test-instance",
      agentId: "sub-sub",
      parentId: child.id,
    });

    // Assert
    expect(grandchild.spawnDepth).toBe(2);
  });

  it(// Positive: sessionKey must match the value produced by buildSessionKey()
  "computes sessionKey automatically and it matches buildSessionKey()", () => {
    // Arrange
    const instanceSlug = "test-instance";
    const agentId = "main";
    const channel = "telegram";
    const peerId = "user-7";

    // Act
    const session = createSession(db, { instanceSlug, agentId, channel, peerId });

    // Assert
    const expectedKey = buildSessionKey(instanceSlug, agentId, channel, peerId);
    expect(session.sessionKey).toBe(expectedKey);
  });

  it(// Positive: label must be undefined when not provided
  "leaves label undefined by default", () => {
    // Arrange + Act
    const session = createSession(db, { instanceSlug: "test-instance", agentId: "main" });

    // Assert
    expect(session.label).toBeUndefined();
  });

  it(// Positive: label must be stored when provided in the input
  "stores label when provided", () => {
    // Arrange + Act
    const session = createSession(db, {
      instanceSlug: "test-instance",
      agentId: "main",
      label: "My custom label",
    });

    // Assert
    expect(session.label).toBe("My custom label");
  });

  it(// Positive: metadata must be undefined when not provided (no default value)
  "leaves metadata undefined by default", () => {
    // Arrange + Act
    const session = createSession(db, { instanceSlug: "test-instance", agentId: "main" });

    // Assert
    expect(session.metadata).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — getSessionByKey()
// ---------------------------------------------------------------------------

describe("getSessionByKey()", () => {
  it(// Positive: must return the session when the key exists in the DB
  "returns the session when the key exists", () => {
    // Arrange
    const session = createSession(db, {
      instanceSlug: "test-instance",
      agentId: "main",
      channel: "web",
      peerId: "peer-1",
    });
    const key = buildSessionKey("test-instance", "main", "web", "peer-1");

    // Act
    const found = getSessionByKey(db, key);

    // Assert
    expect(found).toBeDefined();
    expect(found?.id).toBe(session.id);
  });

  it(// Negative: must return undefined when the key does not exist
  "returns undefined when the key does not exist", () => {
    // Arrange
    const nonExistentKey = "no-instance:no-agent:web:unknown";

    // Act
    const result = getSessionByKey(db, nonExistentKey);

    // Assert
    expect(result).toBeUndefined();
  });

  it(// Positive: O(1) lookup — must return the correct session among several
  "retrieves the correct session among multiple sessions", () => {
    // Arrange — create three sessions with different keys
    const s1 = createSession(db, {
      instanceSlug: "test-instance",
      agentId: "agent-a",
      channel: "web",
      peerId: "peer-a",
    });
    const s2 = createSession(db, {
      instanceSlug: "test-instance",
      agentId: "agent-b",
      channel: "web",
      peerId: "peer-b",
    });
    const s3 = createSession(db, {
      instanceSlug: "test-instance",
      agentId: "agent-c",
      channel: "telegram",
      peerId: "peer-c",
    });

    // Act
    const keyForS2 = buildSessionKey("test-instance", "agent-b", "web", "peer-b");
    const found = getSessionByKey(db, keyForS2);

    // Assert — must return s2, not s1 or s3
    expect(found?.id).toBe(s2.id);
    expect(found?.id).not.toBe(s1.id);
    expect(found?.id).not.toBe(s3.id);
  });
});

// ---------------------------------------------------------------------------
// Suite 4 — countActiveChildren()
// ---------------------------------------------------------------------------

describe("countActiveChildren()", () => {
  it(// Positive: a session with no children must return 0
  "returns 0 when the session has no children", () => {
    // Arrange
    const parent = createSession(db, { instanceSlug: "test-instance", agentId: "main" });

    // Act
    const count = countActiveChildren(db, parent.id);

    // Assert
    expect(count).toBe(0);
  });

  it(// Positive: must return 1 after creating one child session
  "returns 1 after creating one child session", () => {
    // Arrange
    const parent = createSession(db, { instanceSlug: "test-instance", agentId: "main" });

    // Act
    createSession(db, {
      instanceSlug: "test-instance",
      agentId: "sub",
      parentId: parent.id,
    });
    const count = countActiveChildren(db, parent.id);

    // Assert
    expect(count).toBe(1);
  });

  it(// Positive: must return 2 after creating two child sessions
  "returns 2 after creating two child sessions", () => {
    // Arrange
    const parent = createSession(db, { instanceSlug: "test-instance", agentId: "main" });

    // Act
    createSession(db, { instanceSlug: "test-instance", agentId: "sub-1", parentId: parent.id });
    createSession(db, { instanceSlug: "test-instance", agentId: "sub-2", parentId: parent.id });
    const count = countActiveChildren(db, parent.id);

    // Assert
    expect(count).toBe(2);
  });

  it(// Negative: archived children must NOT be counted
  "does not count archived child sessions", () => {
    // Arrange
    const parent = createSession(db, { instanceSlug: "test-instance", agentId: "main" });
    const child = createSession(db, {
      instanceSlug: "test-instance",
      agentId: "sub",
      parentId: parent.id,
    });

    // Act — archive the child
    archiveSession(db, child.id);
    const count = countActiveChildren(db, parent.id);

    // Assert — archived child must not be counted
    expect(count).toBe(0);
  });

  it(// Negative: children of a different parent must NOT be counted
  "does not count children belonging to a different parent", () => {
    // Arrange
    const parentA = createSession(db, { instanceSlug: "test-instance", agentId: "main-a" });
    const parentB = createSession(db, { instanceSlug: "test-instance", agentId: "main-b" });

    // Act — add two children to parentB only
    createSession(db, { instanceSlug: "test-instance", agentId: "sub-1", parentId: parentB.id });
    createSession(db, { instanceSlug: "test-instance", agentId: "sub-2", parentId: parentB.id });

    // Assert — parentA must still have 0 children
    expect(countActiveChildren(db, parentA.id)).toBe(0);
    // Sanity check: parentB has 2
    expect(countActiveChildren(db, parentB.id)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Suite 5 — forkSession() with message/part history copy
// ---------------------------------------------------------------------------

describe("forkSession() — message and part history", () => {
  it(// Positive: forking a session with no messages produces an empty forked session
  "fork without messages: forked session has no messages", () => {
    // Arrange
    const source = createSession(db, { instanceSlug: "test-instance", agentId: "main" });

    // Act
    const fork = forkSession(db, source.id);

    // Assert
    const messages = listMessages(db, fork.id);
    expect(messages).toHaveLength(0);
  });

  it(// Positive: messages from the source session are copied into the forked session
  "fork with messages: messages are copied to the new session", () => {
    // Arrange
    const source = createSession(db, { instanceSlug: "test-instance", agentId: "main" });
    createUserMessage(db, { sessionId: source.id, text: "Hello" });
    createAssistantMessage(db, { sessionId: source.id, agentId: "main" });

    // Act
    const fork = forkSession(db, source.id);

    // Assert
    const forkedMessages = listMessages(db, fork.id);
    expect(forkedMessages).toHaveLength(2);
  });

  it(// Positive: parts of each message are also copied into the forked session
  "fork with messages: parts are copied for each message", () => {
    // Arrange
    const source = createSession(db, { instanceSlug: "test-instance", agentId: "main" });
    const userMsg = createUserMessage(db, { sessionId: source.id, text: "Hello" });
    // createUserMessage already creates one text part; add a second part manually
    createPart(db, { messageId: userMsg.id, type: "text", content: "extra part" });

    // Act
    const fork = forkSession(db, source.id);

    // Assert — the forked user message must have 2 parts
    const forkedMessages = listMessages(db, fork.id);
    expect(forkedMessages).toHaveLength(1);
    const forkedParts = listParts(db, forkedMessages[0]!.id);
    expect(forkedParts).toHaveLength(2);
  });

  it(// Positive: upToMessageId copies only messages up to and including the specified one
  "fork with upToMessageId: copies only messages up to the specified one (inclusive)", () => {
    // Arrange
    const source = createSession(db, { instanceSlug: "test-instance", agentId: "main" });
    const m1 = createUserMessage(db, { sessionId: source.id, text: "First" });
    const m2 = createAssistantMessage(db, { sessionId: source.id });
    createUserMessage(db, { sessionId: source.id, text: "Third" }); // should NOT be copied

    // Act
    const fork = forkSession(db, source.id, { upToMessageId: m2.id });

    // Assert — only m1 and m2 should be in the fork
    const forkedMessages = listMessages(db, fork.id);
    expect(forkedMessages).toHaveLength(2);
    // Verify content of first message (role check)
    expect(forkedMessages[0]?.role).toBe("user");
    expect(forkedMessages[1]?.role).toBe("assistant");
  });

  it(// Negative: copied message IDs must be different from the originals (new nanoid)
  "fork: copied message IDs are different from the original IDs", () => {
    // Arrange
    const source = createSession(db, { instanceSlug: "test-instance", agentId: "main" });
    const original = createUserMessage(db, { sessionId: source.id, text: "Hello" });

    // Act
    const fork = forkSession(db, source.id);

    // Assert — the forked message must have a new ID
    const forkedMessages = listMessages(db, fork.id);
    expect(forkedMessages[0]?.id).not.toBe(original.id);
  });

  it(// Negative: the original session must not be modified after a fork
  "fork: original session message count is unchanged after fork", () => {
    // Arrange
    const source = createSession(db, { instanceSlug: "test-instance", agentId: "main" });
    createUserMessage(db, { sessionId: source.id, text: "First" });
    createAssistantMessage(db, { sessionId: source.id });
    createUserMessage(db, { sessionId: source.id, text: "Second" });

    // Act
    forkSession(db, source.id);

    // Assert — original session still has exactly 3 messages
    const originalMessages = listMessages(db, source.id);
    expect(originalMessages).toHaveLength(3);
  });

  it(// Positive: the first fork label must contain "(fork #1)"
  "fork: label of the first fork contains '(fork #1)'", () => {
    // Arrange
    const source = createSession(db, { instanceSlug: "test-instance", agentId: "main" });

    // Act
    const fork = forkSession(db, source.id);

    // Assert
    expect(fork.label).toContain("(fork #1)");
  });

  it(// Positive: the second fork label must contain "(fork #2)"
  "fork: label of the second fork contains '(fork #2)'", () => {
    // Arrange
    const source = createSession(db, { instanceSlug: "test-instance", agentId: "main" });

    // Act
    forkSession(db, source.id); // fork #1
    const fork2 = forkSession(db, source.id); // fork #2

    // Assert
    expect(fork2.label).toContain("(fork #2)");
  });

  it(// Positive: the forked session's parentId must equal the source session's ID
  "fork: parentId of the new session equals sourceId", () => {
    // Arrange
    const source = createSession(db, { instanceSlug: "test-instance", agentId: "main" });

    // Act
    const fork = forkSession(db, source.id);

    // Assert
    expect(fork.parentId).toBe(source.id);
  });

  it(// Negative: forking a non-existent session must throw with a clear message
  "fork: throws when source session does not exist", () => {
    // Arrange + Act + Assert
    expect(() => forkSession(db, "nonexistent-id")).toThrow("Session not found: nonexistent-id");
  });

  it(// Positive: parts of the source message are preserved in the original after fork
  "fork: parts of the original messages are unchanged after fork", () => {
    // Arrange
    const source = createSession(db, { instanceSlug: "test-instance", agentId: "main" });
    const msg = createUserMessage(db, { sessionId: source.id, text: "Hello" });
    const originalParts = listParts(db, msg.id);

    // Act
    forkSession(db, source.id);

    // Assert — original parts count unchanged
    const partsAfterFork = listParts(db, msg.id);
    expect(partsAfterFork).toHaveLength(originalParts.length);
  });
});
