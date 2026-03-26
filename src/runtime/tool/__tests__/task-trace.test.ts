/**
 * runtime/tool/__tests__/task-trace.test.ts
 *
 * Tests for task trace injection (injectTaskTrace):
 * - A2A sync: traces appear in both caller and target permanent sessions
 * - A2A async: traces appear in both sessions before SubagentCompleted
 * - Subagent sync: trace appears only in caller session
 * - Subagent async: trace appears only in caller session
 * - Result text is truncated at 200 chars
 *
 * Patterns: same as task-a2a.test.ts (in-memory DB, mock prompt loop, no network)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock getTools to avoid loading heavy built-in tools in unit tests
vi.mock("../../agent/registry.js", () => ({
  getAgent: vi.fn().mockReturnValue(undefined),
  listAgents: vi.fn().mockReturnValue([]),
  initAgentRegistry: vi.fn(),
}));

import { initDatabase } from "../../../db/schema.js";
import type Database from "better-sqlite3";
import { createSession } from "../../session/session.js";
import { listMessages } from "../../session/message.js";
import { listParts } from "../../session/part.js";
import { getBus, disposeBus } from "../../bus/index.js";
import { SubagentCompleted } from "../../bus/events.js";
import { createTaskTool } from "../task.js";
import type { Tool } from "../tool.js";
import type { ResolvedModel } from "../../provider/provider.js";
import type { RuntimeAgentConfig } from "../../config/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INSTANCE_SLUG = "test-trace";

function seedInstance(db: Database.Database, slug = INSTANCE_SLUG) {
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

function makeResolvedModel(): ResolvedModel {
  return {
    languageModel: {} as ResolvedModel["languageModel"],
    providerId: "anthropic",
    modelId: "claude-sonnet-4-5",
    costPerMillion: { input: 3, output: 15 },
  };
}

function makeToolContext(db: Database.Database, sessionId: string): Tool.Context {
  return {
    sessionId,
    messageId: "msg-test",
    agentId: "pilot",
    abort: new AbortController().signal,
    metadata: vi.fn(),
  };
}

const PILOT_CONFIG: RuntimeAgentConfig = {
  id: "pilot",
  name: "Pilot",
  model: "anthropic/claude-sonnet-4-5",
  permissions: [],
  maxSteps: 20,
  allowSubAgents: true,
  toolProfile: "manager" as const,
  isDefault: true,
};

const LEAD_TECH_CONFIG: RuntimeAgentConfig = {
  id: "lead-tech",
  name: "Lead Tech",
  model: "anthropic/claude-sonnet-4-5",
  permissions: [],
  maxSteps: 20,
  allowSubAgents: true,
  toolProfile: "manager" as const,
  isDefault: false,
};

/**
 * Helper: get all user messages in a session and return their text parts.
 */
function getUserMessageTexts(db: Database.Database, sessionId: string): string[] {
  const messages = listMessages(db, sessionId).filter((m) => m.role === "user");
  const texts: string[] = [];
  for (const msg of messages) {
    const parts = listParts(db, msg.id);
    for (const part of parts) {
      if (part.type === "text" && part.content) {
        texts.push(part.content);
      }
    }
  }
  return texts;
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let db: Database.Database;

beforeEach(() => {
  db = initDatabase(":memory:");
  seedInstance(db);
  disposeBus(INSTANCE_SLUG);
});

afterEach(() => {
  db.close();
  disposeBus(INSTANCE_SLUG);
});

// ---------------------------------------------------------------------------
// A2A sync trace
// ---------------------------------------------------------------------------

describe("task trace injection — A2A sync", () => {
  it("injects traces into both caller and target permanent sessions", async () => {
    // Arrange
    const callerSession = createSession(db, {
      instanceSlug: INSTANCE_SLUG,
      agentId: "pilot",
      persistent: true,
    });
    const ctx = makeToolContext(db, callerSession.id);

    const mockRunPromptLoop = vi.fn().mockResolvedValue({
      messageId: "msg-result",
      text: "WebSocket ping/pong recommended",
      tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
      costUsd: 0,
      steps: 1,
    });

    const toolInfo = createTaskTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(),
      workDir: undefined,
      callerAgentConfig: PILOT_CONFIG,
      runtimeAgentConfigs: [PILOT_CONFIG, LEAD_TECH_CONFIG],
      runPromptLoop: mockRunPromptLoop,
    });
    const def = await toolInfo.init();

    // Act
    await def.execute(
      {
        description: "heartbeat architecture",
        prompt: "What architecture do you recommend for heartbeat?",
        subagent_type: "lead-tech",
        lifecycle: "run",
        mode: "sync",
      },
      ctx,
    );

    // Assert: caller session has a delegation trace
    const callerTexts = getUserMessageTexts(db, callerSession.id);
    const callerTrace = callerTexts.find((t) => t.startsWith("[delegation]"));
    expect(callerTrace).toBeDefined();
    expect(callerTrace).toContain("Asked lead-tech");
    expect(callerTrace).toContain("heartbeat architecture");
    expect(callerTrace).toContain("WebSocket ping/pong recommended");

    // Assert: target (lead-tech) permanent session also has a trace
    // The task tool creates/gets the permanent session for lead-tech
    const targetSessionKey = `${INSTANCE_SLUG}:lead-tech`;
    const targetSession = db
      .prepare("SELECT id FROM rt_sessions WHERE session_key = ?")
      .get(targetSessionKey) as { id: string } | undefined;
    expect(targetSession).toBeDefined();

    const targetTexts = getUserMessageTexts(db, targetSession!.id);
    const targetTrace = targetTexts.find((t) => t.startsWith("[delegation]"));
    expect(targetTrace).toBeDefined();
    expect(targetTrace).toContain("pilot asked");
    expect(targetTrace).toContain("heartbeat architecture");
    expect(targetTrace).toContain("I responded");
  });
});

// ---------------------------------------------------------------------------
// A2A async trace
// ---------------------------------------------------------------------------

describe("task trace injection — A2A async", () => {
  it("injects traces before publishing SubagentCompleted", async () => {
    // Arrange
    const callerSession = createSession(db, {
      instanceSlug: INSTANCE_SLUG,
      agentId: "pilot",
      persistent: true,
    });
    const ctx = makeToolContext(db, callerSession.id);
    const bus = getBus(INSTANCE_SLUG);

    let capturedEvent: unknown;
    bus.subscribe(SubagentCompleted, (payload) => {
      capturedEvent = payload;
    });

    const mockRunPromptLoop = vi.fn().mockResolvedValue({
      messageId: "msg-async",
      text: "async lead-tech response",
      tokens: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0 },
      costUsd: 0,
      steps: 1,
    });

    const toolInfo = createTaskTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(),
      workDir: undefined,
      callerAgentConfig: PILOT_CONFIG,
      runtimeAgentConfigs: [PILOT_CONFIG, LEAD_TECH_CONFIG],
      runPromptLoop: mockRunPromptLoop,
    });
    const def = await toolInfo.init();

    // Act
    await def.execute(
      {
        description: "async heartbeat review",
        prompt: "Review heartbeat plan",
        subagent_type: "lead-tech",
        lifecycle: "run",
        mode: "async",
      },
      ctx,
    );

    // Wait for async completion
    await vi.waitFor(() => capturedEvent !== undefined, { timeout: 2000 });

    // Assert: caller session has a delegation trace
    const callerTexts = getUserMessageTexts(db, callerSession.id);
    const callerTrace = callerTexts.find((t) => t.startsWith("[delegation]"));
    expect(callerTrace).toBeDefined();
    expect(callerTrace).toContain("Asked lead-tech");

    // Assert: target session also has trace
    const targetSessionKey = `${INSTANCE_SLUG}:lead-tech`;
    const targetSession = db
      .prepare("SELECT id FROM rt_sessions WHERE session_key = ?")
      .get(targetSessionKey) as { id: string } | undefined;
    expect(targetSession).toBeDefined();

    const targetTexts = getUserMessageTexts(db, targetSession!.id);
    const targetTrace = targetTexts.find((t) => t.startsWith("[delegation]"));
    expect(targetTrace).toBeDefined();
    expect(targetTrace).toContain("pilot asked");
  });
});

// ---------------------------------------------------------------------------
// Subagent sync trace (caller only)
// ---------------------------------------------------------------------------

describe("task trace injection — subagent sync", () => {
  it("injects trace only in caller session (not target — ephemeral)", async () => {
    // Arrange: use built-in "Build" agent by mocking the registry
    const { getAgent } = await import("../../agent/registry.js");
    const mockedGetAgent = vi.mocked(getAgent);
    mockedGetAgent.mockReturnValue({
      name: "Build",
      mode: "subagent",
      kind: "subagent",
      category: "tool",
      archetype: null,
      native: true,
      hidden: false,
      permission: [{ permission: "*", pattern: "**", action: "allow" as const }],
      steps: 10,
      options: {},
    });

    const callerSession = createSession(db, {
      instanceSlug: INSTANCE_SLUG,
      agentId: "pilot",
      persistent: true,
    });
    const ctx = makeToolContext(db, callerSession.id);

    const mockRunPromptLoop = vi.fn().mockResolvedValue({
      messageId: "msg-sub",
      text: "function created",
      tokens: { input: 8, output: 4, cacheRead: 0, cacheWrite: 0 },
      costUsd: 0,
      steps: 1,
    });

    const toolInfo = createTaskTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(),
      workDir: undefined,
      callerAgentConfig: PILOT_CONFIG,
      runtimeAgentConfigs: [PILOT_CONFIG, LEAD_TECH_CONFIG],
      runPromptLoop: mockRunPromptLoop,
    });
    const def = await toolInfo.init();

    // Act
    await def.execute(
      {
        description: "code a parseConfig function",
        prompt: "Write parseConfig",
        subagent_type: "Build",
        lifecycle: "run",
        mode: "sync",
      },
      ctx,
    );

    // Assert: caller has trace
    const callerTexts = getUserMessageTexts(db, callerSession.id);
    const callerTrace = callerTexts.find((t) => t.startsWith("[delegation]"));
    expect(callerTrace).toBeDefined();
    expect(callerTrace).toContain("Asked Build");
    expect(callerTrace).toContain("code a parseConfig function");

    // Assert: no trace in target (it's an ephemeral session, no permanent key for "Build")
    const targetSessionKey = `${INSTANCE_SLUG}:Build`;
    const targetSession = db
      .prepare("SELECT id FROM rt_sessions WHERE session_key = ?")
      .get(targetSessionKey) as { id: string } | undefined;
    expect(targetSession).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Truncation
// ---------------------------------------------------------------------------

describe("task trace injection — truncation", () => {
  it("truncates result text exceeding 200 chars", async () => {
    // Arrange
    const callerSession = createSession(db, {
      instanceSlug: INSTANCE_SLUG,
      agentId: "pilot",
      persistent: true,
    });
    const ctx = makeToolContext(db, callerSession.id);

    const longText = "A".repeat(300);
    const mockRunPromptLoop = vi.fn().mockResolvedValue({
      messageId: "msg-long",
      text: longText,
      tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
      costUsd: 0,
      steps: 1,
    });

    const toolInfo = createTaskTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(),
      workDir: undefined,
      callerAgentConfig: PILOT_CONFIG,
      runtimeAgentConfigs: [PILOT_CONFIG, LEAD_TECH_CONFIG],
      runPromptLoop: mockRunPromptLoop,
    });
    const def = await toolInfo.init();

    // Act
    await def.execute(
      {
        description: "long result test",
        prompt: "Do something verbose",
        subagent_type: "lead-tech",
        lifecycle: "run",
        mode: "sync",
      },
      ctx,
    );

    // Assert: trace is truncated at 200 chars + "..."
    const callerTexts = getUserMessageTexts(db, callerSession.id);
    const callerTrace = callerTexts.find((t) => t.startsWith("[delegation]"));
    expect(callerTrace).toBeDefined();
    expect(callerTrace).toContain("...");
    // The full 300-char string should NOT appear
    expect(callerTrace).not.toContain(longText);
    // But the first 200 chars should
    expect(callerTrace).toContain("A".repeat(200));
  });
});
