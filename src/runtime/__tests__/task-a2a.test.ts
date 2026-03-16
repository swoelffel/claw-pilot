/**
 * runtime/__tests__/task-a2a.test.ts
 *
 * Tests for A2A (Agent-to-Agent) features:
 * - Double gate permission filtering in createTaskTool()
 * - Enriched output (steps_used, tokens_used, model, task_id, <task_result>)
 * - Lifecycle modes: "run" (archive) vs "session" (keep active)
 * - Async mode: fire-and-forget + SubagentCompleted bus event
 * - SubagentCompleted event shape
 * - registerSubagentCompletedHandler: unsubscribe, ignore archived/missing parent
 *
 * Patterns:
 * - DB in-memory via initDatabase(":memory:")
 * - MockLanguageModelV3 from ai/test (no network)
 * - getBus(slug) + disposeBus(slug) in afterEach
 * - initAgentRegistry([]) in beforeEach to reset
 * - getTools() mocked to return [] (fast, no heavy built-ins)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";

// Mock getTools to avoid loading heavy built-in tools in unit tests
vi.mock("../tool/registry.js", () => ({
  getTools: vi.fn().mockResolvedValue([]),
}));

import { initDatabase } from "../../db/schema.js";
import type Database from "better-sqlite3";
import { createSession, getSession } from "../session/session.js";
import { getBus, disposeBus } from "../bus/index.js";
import { SubagentCompleted } from "../bus/events.js";
import { initAgentRegistry } from "../agent/registry.js";
import { createTaskTool, checkA2APolicy } from "../tool/task.js";
import { registerSubagentCompletedHandler } from "../channel/router.js";
import type { Tool } from "../tool/tool.js";
import type { ResolvedModel } from "../provider/provider.js";
import type { RuntimeConfig } from "../config/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INSTANCE_SLUG = "test-a2a";

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

/**
 * Build a MockLanguageModelV3 that streams a simple text response.
 * Uses AI SDK v6 chunk format.
 */
function textStreamModel(text: string, inputTokens = 10, outputTokens = 5): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "1" },
          { type: "text-delta", id: "1", delta: text },
          { type: "text-end", id: "1" },
          {
            type: "finish",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            finishReason: { unified: "stop", raw: "stop" } as any,
            usage: {
              inputTokens: {
                total: inputTokens,
                noCache: undefined,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: { total: outputTokens, text: undefined, reasoning: undefined },
            },
          },
        ],
        initialDelayInMs: 0,
        chunkDelayInMs: 0,
      }),
      rawCall: { rawPrompt: null, rawSettings: {} },
    }),
  });
}

function makeResolvedModel(mockModel: MockLanguageModelV3): ResolvedModel {
  return {
    languageModel: mockModel as unknown as ResolvedModel["languageModel"],
    providerId: "anthropic",
    modelId: "claude-sonnet-4-5",
    costPerMillion: { input: 3, output: 15 },
  };
}

function makeToolContext(db: Database.Database, sessionId: string): Tool.Context {
  return {
    sessionId,
    messageId: "msg-test",
    agentId: "build",
    abort: new AbortController().signal,
    metadata: vi.fn(),
  };
}

/**
 * Build a minimal RuntimeConfig for registerSubagentCompletedHandler tests.
 */
function makeRuntimeConfig(): RuntimeConfig {
  return {
    version: 1,
    defaultModel: "anthropic/claude-sonnet-4-5",
    providers: [],
    agents: [
      {
        id: "build",
        name: "build",
        model: "anthropic/claude-sonnet-4-5",
        permissions: [],
        maxSteps: 5,
        allowSubAgents: true,
        toolProfile: "coding",
        isDefault: true,
      },
    ],
    globalPermissions: [],
    models: [],
    telegram: {
      enabled: false,
      botTokenEnvVar: "TELEGRAM_BOT_TOKEN",
      pollingIntervalMs: 1000,
      allowedUserIds: [],
      dmPolicy: "pairing" as const,
      groupPolicy: "allowlist" as const,
    },
    webChat: { enabled: true, maxSessions: 10 },
    compaction: { auto: true, threshold: 0.85, reservedTokens: 8000 },
    subagents: { maxSpawnDepth: 3, maxChildrenPerSession: 5 },
    mcpEnabled: false,
    mcpServers: [],
  };
}

// ---------------------------------------------------------------------------
// Shared mock for runPromptLoop (injected to break circular dependency)
// ---------------------------------------------------------------------------

const mockRunPromptLoop = vi.fn().mockResolvedValue({
  messageId: "msg-mock",
  text: "mock result",
  tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
  costUsd: 0,
  steps: 1,
});

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let db: Database.Database;

beforeEach(() => {
  db = initDatabase(":memory:");
  seedInstance(db);
  disposeBus(INSTANCE_SLUG);
  // Reset agent registry to built-ins only
  initAgentRegistry([]);
});

afterEach(() => {
  db.close();
  disposeBus(INSTANCE_SLUG);
});

// ---------------------------------------------------------------------------
// Double gate permission — description filtering (first gate)
// ---------------------------------------------------------------------------

describe("createTaskTool — first gate: description filtering", () => {
  /**
   * Objective: when agentPermissions denies "task" for "explore",
   * the "explore" agent must NOT appear in the tool description.
   *
   * Positive test: agent "general" (not denied) appears in description.
   * Negative test: agent "explore" (denied) does NOT appear in description.
   */
  it("[positive] agent not denied by agentPermissions appears in description", async () => {
    // Arrange: deny only "explore", not "general"
    const agentPermissions = [{ permission: "task", pattern: "explore", action: "deny" as const }];

    // Act
    const toolInfo = createTaskTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(textStreamModel("ok")),
      workDir: undefined,
      agentPermissions,
      runPromptLoop: mockRunPromptLoop,
    });
    const def = await toolInfo.init();

    // Assert: "general" is visible (not denied)
    expect(def.description).toContain("general");
  });

  it("[negative] agent denied by agentPermissions does NOT appear in description", async () => {
    // Arrange: deny "explore" via agentPermissions
    const agentPermissions = [{ permission: "task", pattern: "explore", action: "deny" as const }];

    // Act
    const toolInfo = createTaskTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(textStreamModel("ok")),
      workDir: undefined,
      agentPermissions,
      runPromptLoop: mockRunPromptLoop,
    });
    const def = await toolInfo.init();

    // Assert: "explore" is filtered out of the description
    // The description lists agents as "- explore: ..." — it must not appear
    expect(def.description).not.toMatch(/^- explore:/m);
  });

  it("[positive] empty agentPermissions → all subagents appear in description", async () => {
    // Arrange: no permission restrictions
    const toolInfo = createTaskTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(textStreamModel("ok")),
      workDir: undefined,
      agentPermissions: [],
      runPromptLoop: mockRunPromptLoop,
    });
    const def = await toolInfo.init();

    // Assert: both built-in subagents are visible
    expect(def.description).toContain("explore");
    expect(def.description).toContain("general");
  });

  it("[positive] undefined agentPermissions → all subagents appear in description", async () => {
    // Arrange: agentPermissions not provided at all
    const toolInfo = createTaskTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(textStreamModel("ok")),
      workDir: undefined,
      runPromptLoop: mockRunPromptLoop,
    });
    const def = await toolInfo.init();

    // Assert: both built-in subagents are visible
    expect(def.description).toContain("explore");
    expect(def.description).toContain("general");
  });
});

// ---------------------------------------------------------------------------
// Double gate permission — execute() second gate
// ---------------------------------------------------------------------------

describe("createTaskTool — second gate: execute() permission check", () => {
  /**
   * Objective: when agentPermissions denies "task" for "explore",
   * calling execute({ subagent_type: "explore" }) must throw "Permission denied".
   *
   * Positive test: allowed agent does not throw permission error.
   * Negative test: denied agent throws "Permission denied".
   */
  it("[negative] execute() throws Permission denied when subagent_type is denied", async () => {
    // Arrange
    const agentPermissions = [{ permission: "task", pattern: "explore", action: "deny" as const }];
    const toolInfo = createTaskTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(textStreamModel("ok")),
      workDir: undefined,
      agentPermissions,
      runPromptLoop: mockRunPromptLoop,
    });
    const def = await toolInfo.init();
    const parentSession = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "build" });
    const ctx = makeToolContext(db, parentSession.id);

    // Act & Assert
    await expect(
      def.execute(
        {
          description: "explore task",
          prompt: "find files",
          subagent_type: "explore",
          lifecycle: "run",
          mode: "sync",
        },
        ctx,
      ),
    ).rejects.toThrow("Permission denied");
  });

  it("[positive] execute() does not throw permission error when subagent_type is allowed", async () => {
    // Arrange: deny "explore" but allow "general"
    const agentPermissions = [
      { permission: "task", pattern: "explore", action: "deny" as const },
      { permission: "task", pattern: "general", action: "allow" as const },
    ];
    const mockModel = textStreamModel("task done", 10, 5);
    const toolInfo = createTaskTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(mockModel),
      workDir: undefined,
      agentPermissions,
      runPromptLoop: mockRunPromptLoop,
    });
    const def = await toolInfo.init();
    const parentSession = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "build" });
    const ctx = makeToolContext(db, parentSession.id);

    // Act: should not throw a permission error (may succeed or fail for other reasons)
    let thrownError: Error | undefined;
    try {
      await def.execute(
        {
          description: "general task",
          prompt: "do something",
          subagent_type: "general",
          lifecycle: "run",
          mode: "sync",
        },
        ctx,
      );
    } catch (err) {
      thrownError = err as Error;
    }

    // Assert: if an error was thrown, it must NOT be a permission error
    if (thrownError) {
      expect(thrownError.message).not.toContain("Permission denied");
    }
  });
});

// ---------------------------------------------------------------------------
// Enriched output (sync mode)
// ---------------------------------------------------------------------------

describe("createTaskTool — enriched output (sync mode)", () => {
  /**
   * Objective: the output of the task tool in sync mode must contain
   * task_id, steps_used, tokens_used, model, <task_result>, </task_result>.
   *
   * Positive test: all expected fields are present.
   * Negative test: "status: accepted" is NOT present in sync mode.
   */
  it("[positive] sync output contains task_id, steps_used, tokens_used, model, task_result tags", async () => {
    // Arrange
    mockRunPromptLoop.mockResolvedValueOnce({
      messageId: "msg-mock",
      text: "the result text",
      tokens: { input: 20, output: 8, cacheRead: 0, cacheWrite: 0 },
      costUsd: 0,
      steps: 1,
    });
    const mockModel = textStreamModel("the result text", 20, 8);
    const toolInfo = createTaskTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(mockModel),
      workDir: undefined,
      runPromptLoop: mockRunPromptLoop,
    });
    const def = await toolInfo.init();
    const parentSession = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "build" });
    const ctx = makeToolContext(db, parentSession.id);

    // Act
    const result = await def.execute(
      {
        description: "test task",
        prompt: "do the thing",
        subagent_type: "explore",
        lifecycle: "run",
        mode: "sync",
      },
      ctx,
    );

    // Assert: all enriched fields present
    expect(result.output).toContain("task_id:");
    expect(result.output).toContain("steps_used:");
    expect(result.output).toContain("tokens_used:");
    expect(result.output).toContain("model:");
    expect(result.output).toContain("<task_result>");
    expect(result.output).toContain("</task_result>");
    expect(result.output).toContain("the result text");
  });

  it("[negative] sync output does NOT contain 'status: accepted'", async () => {
    // Arrange
    const mockModel = textStreamModel("sync result", 5, 3);
    const toolInfo = createTaskTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(mockModel),
      workDir: undefined,
      runPromptLoop: mockRunPromptLoop,
    });
    const def = await toolInfo.init();
    const parentSession = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "build" });
    const ctx = makeToolContext(db, parentSession.id);

    // Act
    const result = await def.execute(
      {
        description: "sync task",
        prompt: "do it sync",
        subagent_type: "explore",
        lifecycle: "run",
        mode: "sync",
      },
      ctx,
    );

    // Assert: sync mode must not return async acceptance status
    expect(result.output).not.toContain("status: accepted");
  });
});

// ---------------------------------------------------------------------------
// Lifecycle: "run" vs "session"
// ---------------------------------------------------------------------------

describe("createTaskTool — lifecycle modes", () => {
  /**
   * Objective: lifecycle="run" archives the sub-session after completion;
   * lifecycle="session" keeps it active.
   *
   * Positive test: lifecycle="run" → sub-session state === "archived"
   * Negative test: lifecycle="session" → sub-session state === "active"
   */
  it("[positive] lifecycle='run' archives the sub-session after completion", async () => {
    // Arrange
    const mockModel = textStreamModel("done", 5, 3);
    const toolInfo = createTaskTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(mockModel),
      workDir: undefined,
      runPromptLoop: mockRunPromptLoop,
    });
    const def = await toolInfo.init();
    const parentSession = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "build" });
    const ctx = makeToolContext(db, parentSession.id);

    // Act
    const result = await def.execute(
      {
        description: "run lifecycle task",
        prompt: "do it",
        subagent_type: "explore",
        lifecycle: "run",
        mode: "sync",
      },
      ctx,
    );

    // Extract task_id from output
    const taskIdMatch = result.output.match(/task_id: (\S+)/);
    expect(taskIdMatch).not.toBeNull();
    const taskId = taskIdMatch![1]!;

    // Assert: sub-session is archived
    const subSession = getSession(db, taskId);
    expect(subSession).toBeDefined();
    expect(subSession!.state).toBe("archived");
  });

  it("[negative] lifecycle='session' keeps the sub-session active after completion", async () => {
    // Arrange
    const mockModel = textStreamModel("done", 5, 3);
    const toolInfo = createTaskTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(mockModel),
      workDir: undefined,
      runPromptLoop: mockRunPromptLoop,
    });
    const def = await toolInfo.init();
    const parentSession = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "build" });
    const ctx = makeToolContext(db, parentSession.id);

    // Act
    const result = await def.execute(
      {
        description: "session lifecycle task",
        prompt: "do it",
        subagent_type: "explore",
        lifecycle: "session",
        mode: "sync",
      },
      ctx,
    );

    // Extract task_id from output
    const taskIdMatch = result.output.match(/task_id: (\S+)/);
    expect(taskIdMatch).not.toBeNull();
    const taskId = taskIdMatch![1]!;

    // Assert: sub-session remains active (NOT archived)
    const subSession = getSession(db, taskId);
    expect(subSession).toBeDefined();
    expect(subSession!.state).toBe("active");
  });
});

// ---------------------------------------------------------------------------
// Async mode
// ---------------------------------------------------------------------------

describe("createTaskTool — async mode", () => {
  /**
   * Objective: mode="async" returns immediately with task_id + status: accepted,
   * then publishes SubagentCompleted on the bus after the sub-agent finishes.
   *
   * Positive test: output contains "status: accepted" and "task_id:"
   * Positive test: SubagentCompleted is published on the bus
   * Negative test: mode="sync" does NOT contain "status: accepted"
   */
  it("[positive] mode='async' returns immediately with status: accepted and task_id", async () => {
    // Arrange
    const mockModel = textStreamModel("async result", 10, 5);
    const toolInfo = createTaskTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(mockModel),
      workDir: undefined,
      runPromptLoop: mockRunPromptLoop,
    });
    const def = await toolInfo.init();
    const parentSession = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "build" });
    const ctx = makeToolContext(db, parentSession.id);

    // Act
    const result = await def.execute(
      {
        description: "async task",
        prompt: "do it async",
        subagent_type: "explore",
        lifecycle: "run",
        mode: "async",
      },
      ctx,
    );

    // Assert: immediate return with accepted status
    expect(result.output).toContain("task_id:");
    expect(result.output).toContain("status: accepted");
  });

  it("[positive] mode='async' publishes SubagentCompleted on the bus after completion", async () => {
    // Arrange
    const mockModel = textStreamModel("async done", 10, 5);
    const toolInfo = createTaskTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(mockModel),
      workDir: undefined,
      runPromptLoop: mockRunPromptLoop,
    });
    const def = await toolInfo.init();
    const parentSession = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "build" });
    const ctx = makeToolContext(db, parentSession.id);

    const bus = getBus(INSTANCE_SLUG);
    const completedEvents: Array<{ parentSessionId: string; subSessionId: string }> = [];
    bus.subscribe(SubagentCompleted, (payload) => {
      completedEvents.push({
        parentSessionId: payload.parentSessionId,
        subSessionId: payload.subSessionId,
      });
    });

    // Act
    const result = await def.execute(
      {
        description: "async bus test",
        prompt: "do it",
        subagent_type: "explore",
        lifecycle: "run",
        mode: "async",
      },
      ctx,
    );

    // Extract task_id
    const taskIdMatch = result.output.match(/task_id: (\S+)/);
    expect(taskIdMatch).not.toBeNull();
    const taskId = taskIdMatch![1]!;

    // Wait for the async sub-agent to complete and publish the event
    // Poll with a timeout to avoid flakiness
    const deadline = Date.now() + 3000;
    while (completedEvents.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }

    // Assert: SubagentCompleted was published with correct IDs
    expect(completedEvents.length).toBeGreaterThan(0);
    expect(completedEvents[0]!.parentSessionId).toBe(parentSession.id);
    expect(completedEvents[0]!.subSessionId).toBe(taskId);
  });

  it("[negative] mode='sync' does NOT contain 'status: accepted'", async () => {
    // Arrange
    const mockModel = textStreamModel("sync result", 5, 3);
    const toolInfo = createTaskTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(mockModel),
      workDir: undefined,
      runPromptLoop: mockRunPromptLoop,
    });
    const def = await toolInfo.init();
    const parentSession = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "build" });
    const ctx = makeToolContext(db, parentSession.id);

    // Act
    const result = await def.execute(
      {
        description: "sync task",
        prompt: "do it sync",
        subagent_type: "explore",
        lifecycle: "run",
        mode: "sync",
      },
      ctx,
    );

    // Assert: sync mode must not return async acceptance status
    expect(result.output).not.toContain("status: accepted");
  });

  it("[positive] mode='async' with lifecycle='run' archives sub-session after completion", async () => {
    // Arrange
    const mockModel = textStreamModel("async lifecycle", 5, 3);
    const toolInfo = createTaskTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(mockModel),
      workDir: undefined,
      runPromptLoop: mockRunPromptLoop,
    });
    const def = await toolInfo.init();
    const parentSession = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "build" });
    const ctx = makeToolContext(db, parentSession.id);

    const bus = getBus(INSTANCE_SLUG);
    let completedCount = 0;
    bus.subscribe(SubagentCompleted, () => {
      completedCount++;
    });

    // Act
    const result = await def.execute(
      {
        description: "async run lifecycle",
        prompt: "do it",
        subagent_type: "explore",
        lifecycle: "run",
        mode: "async",
      },
      ctx,
    );

    const taskIdMatch = result.output.match(/task_id: (\S+)/);
    const taskId = taskIdMatch![1]!;

    // Wait for completion
    const deadline = Date.now() + 3000;
    while (completedCount === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }

    // Assert: sub-session archived after async completion
    const subSession = getSession(db, taskId);
    expect(subSession!.state).toBe("archived");
  });
});

// ---------------------------------------------------------------------------
// SubagentCompleted event shape
// ---------------------------------------------------------------------------

describe("SubagentCompleted event", () => {
  /**
   * Objective: the SubagentCompleted event has the correct type string
   * and the payload contains parentSessionId, subSessionId, result.
   *
   * Positive test: event type is "subagent.completed"
   * Positive test: payload has all required fields
   * Negative test: publishing a different event does not trigger SubagentCompleted handler
   */
  it("[positive] SubagentCompleted event has type 'subagent.completed'", () => {
    // Arrange & Act & Assert
    // The event definition itself carries the type string
    expect(SubagentCompleted.type).toBe("subagent.completed");
  });

  it("[positive] SubagentCompleted payload contains parentSessionId, subSessionId, result", () => {
    // Arrange
    const bus = getBus(INSTANCE_SLUG);
    let receivedPayload: unknown;
    bus.subscribe(SubagentCompleted, (payload) => {
      receivedPayload = payload;
    });

    // Act: publish a SubagentCompleted event
    bus.publish(SubagentCompleted, {
      parentSessionId: "parent-sess-1",
      subSessionId: "sub-sess-1",
      result: {
        text: "task output",
        steps: 3,
        tokens: { input: 100, output: 50 },
        model: "anthropic/claude-sonnet-4-5",
      },
    });

    // Assert: payload has all required fields
    expect(receivedPayload).toMatchObject({
      parentSessionId: "parent-sess-1",
      subSessionId: "sub-sess-1",
      result: {
        text: "task output",
        steps: 3,
        tokens: { input: 100, output: 50 },
        model: "anthropic/claude-sonnet-4-5",
      },
    });
  });

  it("[negative] SubagentCompleted handler is NOT triggered by other event types", () => {
    // Arrange
    const bus = getBus(INSTANCE_SLUG);
    const handler = vi.fn();
    bus.subscribe(SubagentCompleted, handler);

    // Act: publish a different event (SessionCreated)
    bus.publish(
      { type: "session.created" } as Parameters<typeof bus.publish>[0],
      { sessionId: "s1", agentId: "main", channel: "web" } as Parameters<typeof bus.publish>[1],
    );

    // Assert: SubagentCompleted handler was NOT called
    expect(handler).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// registerSubagentCompletedHandler
// ---------------------------------------------------------------------------

describe("registerSubagentCompletedHandler", () => {
  /**
   * Objective: registerSubagentCompletedHandler returns an unsubscribe function,
   * ignores events for archived parent sessions, and ignores events for
   * non-existent parent sessions.
   *
   * Positive test: returns a function (unsubscribe)
   * Positive test: after unsubscribe(), handler no longer reacts to events
   * Negative test: event with archived parent session is silently ignored
   * Negative test: event with non-existent parent session is silently ignored
   */
  it("[positive] returns an unsubscribe function", () => {
    // Arrange
    const config = makeRuntimeConfig();

    // Act
    const unsubscribe = registerSubagentCompletedHandler(db, INSTANCE_SLUG, config);

    // Assert: returns a callable function
    expect(typeof unsubscribe).toBe("function");
    expect(() => unsubscribe()).not.toThrow();
  });

  it("[positive] after unsubscribe(), handler no longer reacts to SubagentCompleted events", async () => {
    // Arrange
    const config = makeRuntimeConfig();
    const bus = getBus(INSTANCE_SLUG);

    // Track any runPromptLoop calls via bus events (SessionStatusChanged busy = loop started)
    const busyEvents: string[] = [];
    bus.subscribe(
      { type: "session.status" } as Parameters<typeof bus.subscribe>[0],
      (payload: unknown) => {
        const p = payload as { status: string };
        if (p.status === "busy") busyEvents.push("busy");
      },
    );

    const unsubscribe = registerSubagentCompletedHandler(db, INSTANCE_SLUG, config);

    // Create an active parent session
    const parentSession = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "build" });

    // Unsubscribe before publishing
    unsubscribe();

    // Act: publish SubagentCompleted — handler should be gone
    bus.publish(SubagentCompleted, {
      parentSessionId: parentSession.id,
      subSessionId: "sub-1",
      result: {
        text: "result",
        steps: 1,
        tokens: { input: 10, output: 5 },
        model: "anthropic/claude-sonnet-4-5",
      },
    });

    // Wait a tick to ensure no async work starts
    await new Promise((r) => setTimeout(r, 50));

    // Assert: no prompt loop was triggered (no "busy" status event)
    expect(busyEvents).toHaveLength(0);
  });

  it("[negative] ignores SubagentCompleted when parent session is archived", async () => {
    // Arrange
    const config = makeRuntimeConfig();
    const bus = getBus(INSTANCE_SLUG);

    // Track prompt loop starts
    const busyEvents: string[] = [];
    bus.subscribe(
      { type: "session.status" } as Parameters<typeof bus.subscribe>[0],
      (payload: unknown) => {
        const p = payload as { status: string };
        if (p.status === "busy") busyEvents.push("busy");
      },
    );

    registerSubagentCompletedHandler(db, INSTANCE_SLUG, config);

    // Create and immediately archive the parent session
    const parentSession = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "build" });
    const { archiveSession } = await import("../session/session.js");
    archiveSession(db, parentSession.id);

    // Act: publish SubagentCompleted for the archived parent
    bus.publish(SubagentCompleted, {
      parentSessionId: parentSession.id,
      subSessionId: "sub-archived",
      result: {
        text: "result",
        steps: 1,
        tokens: { input: 10, output: 5 },
        model: "anthropic/claude-sonnet-4-5",
      },
    });

    // Wait a tick
    await new Promise((r) => setTimeout(r, 50));

    // Assert: no prompt loop was triggered for archived parent
    expect(busyEvents).toHaveLength(0);
  });

  it("[negative] ignores SubagentCompleted when parent session does not exist", async () => {
    // Arrange
    const config = makeRuntimeConfig();
    const bus = getBus(INSTANCE_SLUG);

    // Track prompt loop starts
    const busyEvents: string[] = [];
    bus.subscribe(
      { type: "session.status" } as Parameters<typeof bus.subscribe>[0],
      (payload: unknown) => {
        const p = payload as { status: string };
        if (p.status === "busy") busyEvents.push("busy");
      },
    );

    registerSubagentCompletedHandler(db, INSTANCE_SLUG, config);

    // Act: publish SubagentCompleted for a non-existent parent session
    bus.publish(SubagentCompleted, {
      parentSessionId: "nonexistent-parent-session-id",
      subSessionId: "sub-ghost",
      result: {
        text: "result",
        steps: 1,
        tokens: { input: 10, output: 5 },
        model: "anthropic/claude-sonnet-4-5",
      },
    });

    // Wait a tick
    await new Promise((r) => setTimeout(r, 50));

    // Assert: no prompt loop was triggered for non-existent parent
    expect(busyEvents).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// checkA2APolicy (Phase 1a)
// ---------------------------------------------------------------------------

describe("checkA2APolicy", () => {
  /**
   * Objective: checkA2APolicy enforces the agentToAgent policy.
   */

  it("[positive] returns allowed=true when no agentToAgent policy defined", () => {
    const agentConfig = {
      id: "main",
      name: "main",
      model: "anthropic/claude-sonnet-4-5",
      permissions: [],
      maxSteps: 20,
      allowSubAgents: true,
      toolProfile: "coding" as const,
      isDefault: true,
      // No agentToAgent field
    };

    const result = checkA2APolicy(agentConfig, "explore");
    expect(result.allowed).toBe(true);
  });

  it("[positive] returns allowed=true when agentToAgent.enabled=true and no allowList", () => {
    const agentConfig = {
      id: "main",
      name: "main",
      model: "anthropic/claude-sonnet-4-5",
      permissions: [],
      maxSteps: 20,
      allowSubAgents: true,
      toolProfile: "coding" as const,
      isDefault: true,
      agentToAgent: { enabled: true },
    };

    const result = checkA2APolicy(agentConfig, "explore");
    expect(result.allowed).toBe(true);
  });

  it("[negative] returns allowed=false when agentToAgent.enabled=false", () => {
    const agentConfig = {
      id: "restricted",
      name: "restricted",
      model: "anthropic/claude-sonnet-4-5",
      permissions: [],
      maxSteps: 20,
      allowSubAgents: false,
      toolProfile: "coding" as const,
      isDefault: false,
      agentToAgent: { enabled: false },
    };

    const result = checkA2APolicy(agentConfig, "explore");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("agentToAgent.enabled = false");
  });

  it("[positive] returns allowed=true when target is in allowList", () => {
    const agentConfig = {
      id: "selective",
      name: "selective",
      model: "anthropic/claude-sonnet-4-5",
      permissions: [],
      maxSteps: 20,
      allowSubAgents: true,
      toolProfile: "coding" as const,
      isDefault: false,
      agentToAgent: { enabled: true, allowList: ["explore", "general"] },
    };

    const result = checkA2APolicy(agentConfig, "explore");
    expect(result.allowed).toBe(true);
  });

  it("[negative] returns allowed=false when target is NOT in allowList", () => {
    const agentConfig = {
      id: "selective",
      name: "selective",
      model: "anthropic/claude-sonnet-4-5",
      permissions: [],
      maxSteps: 20,
      allowSubAgents: true,
      toolProfile: "coding" as const,
      isDefault: false,
      agentToAgent: { enabled: true, allowList: ["general"] },
    };

    const result = checkA2APolicy(agentConfig, "explore");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("not allowed to spawn 'explore'");
    expect(result.reason).toContain("general");
  });

  it("[positive] allowList=['*'] allows all agents", () => {
    const agentConfig = {
      id: "wildcard",
      name: "wildcard",
      model: "anthropic/claude-sonnet-4-5",
      permissions: [],
      maxSteps: 20,
      allowSubAgents: true,
      toolProfile: "coding" as const,
      isDefault: false,
      agentToAgent: { enabled: true, allowList: ["*"] },
    };

    const result = checkA2APolicy(agentConfig, "any-agent");
    expect(result.allowed).toBe(true);
  });

  it("[negative] execute() throws A2A error when callerAgentConfig has agentToAgent.enabled=false", async () => {
    // Arrange: caller agent with agentToAgent disabled
    const callerAgentConfig = {
      id: "no-spawn",
      name: "no-spawn",
      model: "anthropic/claude-sonnet-4-5",
      permissions: [],
      maxSteps: 20,
      allowSubAgents: false,
      toolProfile: "coding" as const,
      isDefault: false,
      agentToAgent: { enabled: false },
    };

    const toolInfo = createTaskTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(textStreamModel("ok")),
      workDir: undefined,
      callerAgentConfig,
      runPromptLoop: mockRunPromptLoop,
    });
    const def = await toolInfo.init();
    const parentSession = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "build" });
    const ctx = makeToolContext(db, parentSession.id);

    // Act & Assert: should throw A2A policy error
    await expect(
      def.execute(
        {
          description: "blocked task",
          prompt: "do something",
          subagent_type: "explore",
          lifecycle: "run",
          mode: "sync",
        },
        ctx,
      ),
    ).rejects.toThrow("agentToAgent.enabled = false");
  });

  it("[negative] execute() throws A2A error when target not in allowList", async () => {
    // Arrange: caller agent with restricted allowList
    const callerAgentConfig = {
      id: "restricted-caller",
      name: "restricted-caller",
      model: "anthropic/claude-sonnet-4-5",
      permissions: [],
      maxSteps: 20,
      allowSubAgents: true,
      toolProfile: "coding" as const,
      isDefault: false,
      agentToAgent: { enabled: true, allowList: ["general"] },
    };

    const toolInfo = createTaskTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(textStreamModel("ok")),
      workDir: undefined,
      callerAgentConfig,
      runPromptLoop: mockRunPromptLoop,
    });
    const def = await toolInfo.init();
    const parentSession = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "build" });
    const ctx = makeToolContext(db, parentSession.id);

    // Act & Assert: "explore" is not in allowList
    await expect(
      def.execute(
        {
          description: "blocked task",
          prompt: "do something",
          subagent_type: "explore",
          lifecycle: "run",
          mode: "sync",
        },
        ctx,
      ),
    ).rejects.toThrow("not allowed to spawn 'explore'");
  });
});
