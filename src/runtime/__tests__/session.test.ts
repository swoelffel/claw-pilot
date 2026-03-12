/**
 * runtime/__tests__/session.test.ts
 *
 * Unit tests for session CRUD, message model, and part model.
 * Uses an in-memory SQLite database (":memory:") via initDatabase().
 */

import { describe, it, expect, beforeEach } from "vitest";
import { initDatabase } from "../../db/schema.js";
import type Database from "better-sqlite3";
import {
  createSession,
  getSession,
  listSessions,
  updateSessionTitle,
  archiveSession,
  forkSession,
} from "../session/session.js";
import {
  createUserMessage,
  createAssistantMessage,
  updateMessageMetadata,
  listMessages,
  getMessage,
} from "../session/message.js";
import { createPart, updatePartState, listParts, getNextSortOrder } from "../session/part.js";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let db: Database.Database;

// We need a fake instance in the instances table for FK constraints
function seedInstance(db: Database.Database, slug: string) {
  // Insert a server first
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
// Session CRUD
// ---------------------------------------------------------------------------

describe("createSession", () => {
  it("creates a session with a generated ID", () => {
    const session = createSession(db, {
      instanceSlug: "test-instance",
      agentId: "main",
    });

    expect(session.id).toBeTruthy();
    expect(session.instanceSlug).toBe("test-instance");
    expect(session.agentId).toBe("main");
    expect(session.channel).toBe("web"); // default
    expect(session.state).toBe("active");
    expect(session.parentId).toBeUndefined();
    expect(session.peerId).toBeUndefined();
    expect(session.title).toBeUndefined();
    expect(session.createdAt).toBeInstanceOf(Date);
    expect(session.updatedAt).toBeInstanceOf(Date);
  });

  it("creates a session with custom channel and peerId", () => {
    const session = createSession(db, {
      instanceSlug: "test-instance",
      agentId: "main",
      channel: "telegram",
      peerId: "user-123",
    });

    expect(session.channel).toBe("telegram");
    expect(session.peerId).toBe("user-123");
  });

  it("creates a child session with parentId", () => {
    const parent = createSession(db, { instanceSlug: "test-instance", agentId: "main" });
    const child = createSession(db, {
      instanceSlug: "test-instance",
      agentId: "sub",
      parentId: parent.id,
    });

    expect(child.parentId).toBe(parent.id);
  });
});

describe("getSession", () => {
  it("returns the session by ID", () => {
    const created = createSession(db, { instanceSlug: "test-instance", agentId: "main" });
    const found = getSession(db, created.id);

    expect(found).toBeDefined();
    expect(found?.id).toBe(created.id);
  });

  it("returns undefined for non-existent ID", () => {
    const result = getSession(db, "nonexistent-id");
    expect(result).toBeUndefined();
  });
});

describe("listSessions", () => {
  it("returns sessions for an instance", () => {
    createSession(db, { instanceSlug: "test-instance", agentId: "main" });
    createSession(db, { instanceSlug: "test-instance", agentId: "sub" });

    const sessions = listSessions(db, "test-instance");
    expect(sessions).toHaveLength(2);
  });

  it("filters by state", () => {
    const s1 = createSession(db, { instanceSlug: "test-instance", agentId: "main" });
    createSession(db, { instanceSlug: "test-instance", agentId: "sub" });
    archiveSession(db, s1.id);

    const active = listSessions(db, "test-instance", { state: "active" });
    const archived = listSessions(db, "test-instance", { state: "archived" });

    expect(active).toHaveLength(1);
    expect(archived).toHaveLength(1);
    expect(archived[0]?.id).toBe(s1.id);
  });

  it("returns empty array for unknown instance", () => {
    const sessions = listSessions(db, "unknown-instance");
    expect(sessions).toHaveLength(0);
  });
});

describe("updateSessionTitle", () => {
  it("updates the title", () => {
    const session = createSession(db, { instanceSlug: "test-instance", agentId: "main" });
    updateSessionTitle(db, session.id, "My Session");

    const updated = getSession(db, session.id);
    expect(updated?.title).toBe("My Session");
  });
});

describe("archiveSession", () => {
  it("changes state to archived", () => {
    const session = createSession(db, { instanceSlug: "test-instance", agentId: "main" });
    archiveSession(db, session.id);

    const updated = getSession(db, session.id);
    expect(updated?.state).toBe("archived");
  });

  it("is idempotent — double archive does not throw", () => {
    const session = createSession(db, { instanceSlug: "test-instance", agentId: "main" });
    archiveSession(db, session.id);
    expect(() => archiveSession(db, session.id)).not.toThrow();

    const updated = getSession(db, session.id);
    expect(updated?.state).toBe("archived");
  });
});

describe("forkSession", () => {
  it("creates a new session with parentId = sourceId", () => {
    const source = createSession(db, {
      instanceSlug: "test-instance",
      agentId: "main",
      channel: "telegram",
      peerId: "user-42",
    });

    const fork = forkSession(db, source.id);

    expect(fork.id).not.toBe(source.id);
    expect(fork.parentId).toBe(source.id);
    expect(fork.instanceSlug).toBe(source.instanceSlug);
    expect(fork.agentId).toBe(source.agentId);
    expect(fork.channel).toBe(source.channel);
    expect(fork.peerId).toBe(source.peerId);
    expect(fork.state).toBe("active");
    expect(fork.title).toBeUndefined();
  });

  it("allows overriding agentId", () => {
    const source = createSession(db, { instanceSlug: "test-instance", agentId: "main" });
    const fork = forkSession(db, source.id, { agentId: "sub-agent" });

    expect(fork.agentId).toBe("sub-agent");
  });

  it("throws for non-existent source", () => {
    expect(() => forkSession(db, "nonexistent")).toThrow("Session not found: nonexistent");
  });
});

// ---------------------------------------------------------------------------
// Message model
// ---------------------------------------------------------------------------

describe("createUserMessage", () => {
  it("creates a user message with a text part", () => {
    const session = createSession(db, { instanceSlug: "test-instance", agentId: "main" });
    const msg = createUserMessage(db, { sessionId: session.id, text: "Hello!" });

    expect(msg.id).toBeTruthy();
    expect(msg.sessionId).toBe(session.id);
    expect(msg.role).toBe("user");
    expect(msg.isCompaction).toBe(false);

    const parts = listParts(db, msg.id);
    expect(parts).toHaveLength(1);
    expect(parts[0]?.type).toBe("text");
    expect(parts[0]?.content).toBe("Hello!");
  });
});

describe("createAssistantMessage", () => {
  it("creates an empty assistant message", () => {
    const session = createSession(db, { instanceSlug: "test-instance", agentId: "main" });
    const msg = createAssistantMessage(db, {
      sessionId: session.id,
      agentId: "main",
      model: "anthropic/claude-sonnet-4-5",
    });

    expect(msg.role).toBe("assistant");
    expect(msg.agentId).toBe("main");
    expect(msg.model).toBe("anthropic/claude-sonnet-4-5");

    const parts = listParts(db, msg.id);
    expect(parts).toHaveLength(0); // empty — parts added separately
  });
});

describe("updateMessageMetadata", () => {
  it("updates token counts and cost", () => {
    const session = createSession(db, { instanceSlug: "test-instance", agentId: "main" });
    const msg = createAssistantMessage(db, { sessionId: session.id });

    updateMessageMetadata(db, msg.id, {
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
      finishReason: "stop",
    });

    const updated = getMessage(db, msg.id);
    expect(updated?.tokensIn).toBe(100);
    expect(updated?.tokensOut).toBe(50);
    expect(updated?.costUsd).toBeCloseTo(0.001);
    expect(updated?.finishReason).toBe("stop");
  });
});

describe("listMessages", () => {
  it("returns messages in chronological order", () => {
    const session = createSession(db, { instanceSlug: "test-instance", agentId: "main" });
    const m1 = createUserMessage(db, { sessionId: session.id, text: "First" });
    const m2 = createAssistantMessage(db, { sessionId: session.id });
    const m3 = createUserMessage(db, { sessionId: session.id, text: "Second" });

    const messages = listMessages(db, session.id);
    expect(messages).toHaveLength(3);
    expect(messages[0]?.id).toBe(m1.id);
    expect(messages[1]?.id).toBe(m2.id);
    expect(messages[2]?.id).toBe(m3.id);
  });
});

// ---------------------------------------------------------------------------
// Part model
// ---------------------------------------------------------------------------

describe("createPart", () => {
  it("creates a text part with auto sort_order", () => {
    const session = createSession(db, { instanceSlug: "test-instance", agentId: "main" });
    const msg = createAssistantMessage(db, { sessionId: session.id });

    const p1 = createPart(db, { messageId: msg.id, type: "text", content: "Hello" });
    const p2 = createPart(db, { messageId: msg.id, type: "text", content: "World" });

    expect(p1.sortOrder).toBe(0);
    expect(p2.sortOrder).toBe(1);
  });

  it("creates a tool_call part with metadata", () => {
    const session = createSession(db, { instanceSlug: "test-instance", agentId: "main" });
    const msg = createAssistantMessage(db, { sessionId: session.id });

    const meta = JSON.stringify({ toolCallId: "tc-1", toolName: "read", args: { path: "/tmp" } });
    const part = createPart(db, {
      messageId: msg.id,
      type: "tool_call",
      metadata: meta,
    });

    expect(part.type).toBe("tool_call");
    expect(part.metadata).toBe(meta);
    expect(part.state).toBeUndefined();
  });
});

describe("updatePartState", () => {
  it("updates state and content", () => {
    const session = createSession(db, { instanceSlug: "test-instance", agentId: "main" });
    const msg = createAssistantMessage(db, { sessionId: session.id });
    const part = createPart(db, { messageId: msg.id, type: "tool_call" });

    updatePartState(db, part.id, "completed", "tool output");

    const parts = listParts(db, msg.id);
    expect(parts[0]?.state).toBe("completed");
    expect(parts[0]?.content).toBe("tool output");
  });

  it("updates state without changing content", () => {
    const session = createSession(db, { instanceSlug: "test-instance", agentId: "main" });
    const msg = createAssistantMessage(db, { sessionId: session.id });
    const part = createPart(db, { messageId: msg.id, type: "tool_call", content: "original" });

    updatePartState(db, part.id, "running");

    const parts = listParts(db, msg.id);
    expect(parts[0]?.state).toBe("running");
    expect(parts[0]?.content).toBe("original"); // unchanged
  });
});

describe("getNextSortOrder", () => {
  it("returns 0 for empty message", () => {
    const session = createSession(db, { instanceSlug: "test-instance", agentId: "main" });
    const msg = createAssistantMessage(db, { sessionId: session.id });

    expect(getNextSortOrder(db, msg.id)).toBe(0);
  });

  it("returns MAX + 1 after parts are added", () => {
    const session = createSession(db, { instanceSlug: "test-instance", agentId: "main" });
    const msg = createAssistantMessage(db, { sessionId: session.id });

    createPart(db, { messageId: msg.id, type: "text" });
    createPart(db, { messageId: msg.id, type: "text" });

    expect(getNextSortOrder(db, msg.id)).toBe(2);
  });
});
