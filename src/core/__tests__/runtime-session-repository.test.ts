/**
 * core/__tests__/runtime-session-repository.test.ts
 *
 * Unit tests for runtime-session-repository functions.
 * Uses in-memory SQLite with seeded sessions, messages, and parts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { initDatabase } from "../../db/schema.js";
import {
  listEnrichedSessions,
  purgeArchivedSessions,
  deleteSessionsByAgent,
} from "../repositories/runtime-session-repository.js";
import { createSession, archiveSession } from "../../runtime/session/session.js";
import { createUserMessage, createAssistantMessage } from "../../runtime/session/message.js";
import { createPart } from "../../runtime/session/part.js";

let db: Database.Database;
const SLUG = "test-inst";
let instanceId: number;

function seedInstance(): void {
  db.prepare(
    "INSERT OR IGNORE INTO servers (hostname, openclaw_home) VALUES ('localhost', '/opt/test')",
  ).run();
  const server = db.prepare("SELECT id FROM servers LIMIT 1").get() as { id: number };
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO instances (server_id, slug, port, config_path, state_dir, systemd_unit)
       VALUES (?, ?, 18789, '/tmp/rt.json', '/tmp/state', 'test.service')`,
    )
    .run(server.id, SLUG);
  instanceId = result.lastInsertRowid as number;

  // Seed agent so the LEFT JOIN on agents resolves
  db.prepare(
    `INSERT OR IGNORE INTO agents (instance_id, agent_id, name, workspace_path, is_default)
     VALUES (?, 'agent-1', 'Agent One', '/ws/agent-1', 1)`,
  ).run(instanceId);
}

function createSessionWithMessage(opts: {
  agentId?: string;
  channel?: string;
  persistent?: boolean;
}): string {
  const session = createSession(db, {
    instanceSlug: SLUG,
    agentId: opts.agentId ?? "agent-1",
    channel: opts.channel ?? "web",
    persistent: opts.persistent ?? false,
  });
  const _userMsg = createUserMessage(db, { sessionId: session.id, text: "hello" });
  const assistantMsg = createAssistantMessage(db, {
    sessionId: session.id,
    agentId: opts.agentId ?? "agent-1",
    model: "anthropic/claude-sonnet-4-6",
  });
  createPart(db, { messageId: assistantMsg.id, type: "text", content: "reply" });
  // Set some cost data on the assistant message
  db.prepare(
    "UPDATE rt_messages SET cost_usd = 0.01, tokens_in = 100, tokens_out = 50 WHERE id = ?",
  ).run(assistantMsg.id);
  return session.id;
}

beforeEach(() => {
  db = initDatabase(":memory:");
  seedInstance();
});

afterEach(() => {
  db.close();
});

// ---------------------------------------------------------------------------
// listEnrichedSessions
// ---------------------------------------------------------------------------

describe("listEnrichedSessions", () => {
  it("returns active sessions by default", () => {
    createSessionWithMessage({});
    const result = listEnrichedSessions(db, SLUG);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]!.state).toBe("active");
    expect(result.hasMore).toBe(false);
  });

  it("returns archived sessions when state=archived", () => {
    const id = createSessionWithMessage({});
    archiveSession(db, id);
    const result = listEnrichedSessions(db, SLUG, { state: "archived" });
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]!.state).toBe("archived");
  });

  it("returns all sessions when state=all", () => {
    const id1 = createSessionWithMessage({});
    createSessionWithMessage({});
    archiveSession(db, id1);
    const result = listEnrichedSessions(db, SLUG, { state: "all" });
    expect(result.sessions).toHaveLength(2);
  });

  it("filters by agentId", () => {
    db.prepare(
      `INSERT OR IGNORE INTO agents (instance_id, agent_id, name, workspace_path, is_default)
       VALUES (?, 'agent-2', 'Agent Two', '/ws/agent-2', 0)`,
    ).run(instanceId);
    createSessionWithMessage({ agentId: "agent-1" });
    createSessionWithMessage({ agentId: "agent-2" });

    const result = listEnrichedSessions(db, SLUG, { agentId: "agent-2" });
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]!.agentId).toBe("agent-2");
  });

  it("excludes internal channel by default", () => {
    createSessionWithMessage({ channel: "internal" });
    createSessionWithMessage({ channel: "web" });
    const result = listEnrichedSessions(db, SLUG);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]!.channel).toBe("web");
  });

  it("includes internal channel with includeInternal=true", () => {
    createSessionWithMessage({ channel: "internal" });
    createSessionWithMessage({ channel: "web" });
    const result = listEnrichedSessions(db, SLUG, { includeInternal: true });
    expect(result.sessions).toHaveLength(2);
  });

  it("aggregates cost, message count, and tokens", () => {
    createSessionWithMessage({});
    const result = listEnrichedSessions(db, SLUG);
    const s = result.sessions[0]!;
    expect(s.totalCostUsd).toBeGreaterThan(0);
    expect(s.messageCount).toBeGreaterThan(0);
    expect(s.totalTokens).toBeGreaterThan(0);
  });

  it("hasMore=true when more sessions exist than limit", () => {
    createSessionWithMessage({});
    createSessionWithMessage({});
    createSessionWithMessage({});
    const result = listEnrichedSessions(db, SLUG, { limit: 2 });
    expect(result.sessions).toHaveLength(2);
    expect(result.hasMore).toBe(true);
  });

  it("filters by persistent", () => {
    createSessionWithMessage({ persistent: true });
    createSessionWithMessage({ persistent: false });
    const result = listEnrichedSessions(db, SLUG, { persistent: 1 });
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]!.persistent).toBe(true);
  });

  it("includes agent name and is_default from JOIN", () => {
    createSessionWithMessage({});
    const result = listEnrichedSessions(db, SLUG);
    expect(result.sessions[0]!.agentName).toBe("Agent One");
    expect(result.sessions[0]!.agentIsDefault).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// purgeArchivedSessions
// ---------------------------------------------------------------------------

describe("purgeArchivedSessions", () => {
  it("deletes archived ephemeral sessions with their messages and parts", () => {
    const id = createSessionWithMessage({});
    archiveSession(db, id);

    const result = purgeArchivedSessions(db, SLUG);
    expect(result.sessionsDeleted).toBe(1);
    expect(result.messagesDeleted).toBeGreaterThan(0);
    expect(result.partsDeleted).toBeGreaterThan(0);
  });

  it("does not delete permanent sessions even if archived", () => {
    const id = createSessionWithMessage({ persistent: true });
    archiveSession(db, id);

    const result = purgeArchivedSessions(db, SLUG);
    expect(result.sessionsDeleted).toBe(0);
  });

  it("does not delete active sessions", () => {
    createSessionWithMessage({});
    const result = purgeArchivedSessions(db, SLUG);
    expect(result.sessionsDeleted).toBe(0);
  });

  it("returns zeros when no archived sessions exist", () => {
    const result = purgeArchivedSessions(db, SLUG);
    expect(result).toEqual({ sessionsDeleted: 0, messagesDeleted: 0, partsDeleted: 0 });
  });
});

// ---------------------------------------------------------------------------
// deleteSessionsByAgent
// ---------------------------------------------------------------------------

describe("deleteSessionsByAgent", () => {
  it("deletes all sessions for a specific agent", () => {
    createSessionWithMessage({ agentId: "agent-1" });
    createSessionWithMessage({ agentId: "agent-1" });
    const deleted = deleteSessionsByAgent(db, SLUG, "agent-1");
    expect(deleted).toBe(2);

    const remaining = listEnrichedSessions(db, SLUG, { state: "all" });
    expect(remaining.sessions).toHaveLength(0);
  });

  it("does not delete sessions for other agents", () => {
    db.prepare(
      `INSERT OR IGNORE INTO agents (instance_id, agent_id, name, workspace_path, is_default)
       VALUES (?, 'agent-2', 'Agent Two', '/ws/agent-2', 0)`,
    ).run(instanceId);
    createSessionWithMessage({ agentId: "agent-1" });
    createSessionWithMessage({ agentId: "agent-2" });
    deleteSessionsByAgent(db, SLUG, "agent-1");

    const remaining = listEnrichedSessions(db, SLUG, { state: "all" });
    expect(remaining.sessions).toHaveLength(1);
    expect(remaining.sessions[0]!.agentId).toBe("agent-2");
  });

  it("returns 0 when no sessions exist for the agent", () => {
    expect(deleteSessionsByAgent(db, SLUG, "nonexistent")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Timestamp normalisation — regression test for #14
// ---------------------------------------------------------------------------

describe("listEnrichedSessions — timestamp normalisation", () => {
  it("returns createdAt as an ISO-8601 string for ISO-stored rows", () => {
    const id = createSessionWithMessage({});
    const { sessions } = listEnrichedSessions(db, SLUG);
    expect(sessions).toHaveLength(1);
    const s = sessions[0]!;
    void id;
    // Must be parseable by new Date() and not NaN
    expect(new Date(s.createdAt).getTime()).not.toBeNaN();
    // Must look like an ISO string (contains 'T')
    expect(s.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns updatedAt as an ISO-8601 string for ISO-stored rows", () => {
    createSessionWithMessage({});
    const { sessions } = listEnrichedSessions(db, SLUG);
    const s = sessions[0]!;
    expect(new Date(s.updatedAt ?? "").getTime()).not.toBeNaN();
    expect(s.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("normalises createdAt when stored as Unix ms integer string", () => {
    const id = createSessionWithMessage({});
    // Simulate a legacy row with Unix ms timestamp
    const unixMs = new Date("2025-01-15T10:00:00.000Z").getTime();
    db.prepare("UPDATE rt_sessions SET created_at = ? WHERE id = ?").run(String(unixMs), id);
    const { sessions } = listEnrichedSessions(db, SLUG);
    const s = sessions[0]!;
    expect(new Date(s.createdAt).getTime()).not.toBeNaN();
    expect(s.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
