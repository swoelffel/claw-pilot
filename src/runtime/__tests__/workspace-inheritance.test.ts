/**
 * runtime/__tests__/workspace-inheritance.test.ts
 *
 * Tests for the inheritWorkspace feature (Phase 1a):
 * - createTaskTool() accepts callerAgentConfig with inheritWorkspace flag
 * - subAgentWorkDir is computed as:
 *     callerAgentConfig?.inheritWorkspace !== false ? workDir : undefined
 *
 * Strategy:
 * - Mock runPromptLoop to capture the workDir argument passed to the sub-agent
 * - Use in-memory DB (initDatabase(":memory:"))
 * - MockLanguageModelV3 is NOT needed — runPromptLoop is fully mocked
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock getTools to avoid loading heavy built-in tools in unit tests
vi.mock("../tool/registry.js", () => ({
  getTools: vi.fn().mockResolvedValue([]),
}));

// ---------------------------------------------------------------------------
// Mock runPromptLoop — capture the workDir argument passed to the sub-agent
// ---------------------------------------------------------------------------

const mockRunPromptLoop = vi.fn();

vi.mock("../session/prompt-loop.js", () => ({
  runPromptLoop: (args: unknown) => mockRunPromptLoop(args),
}));

import { initDatabase } from "../../db/schema.js";
import type Database from "better-sqlite3";
import { createSession } from "../session/session.js";
import { disposeBus } from "../bus/index.js";
import { initAgentRegistry } from "../agent/registry.js";
import { createTaskTool } from "../tool/task.js";
import type { Tool } from "../tool/tool.js";
import type { ResolvedModel } from "../provider/provider.js";
import type { RuntimeAgentConfig } from "../config/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INSTANCE_SLUG = "test-workspace-inheritance";
const PARENT_WORK_DIR = "/workspace/project";

function seedInstance(db: Database.Database, slug = INSTANCE_SLUG) {
  db.prepare(
    `INSERT OR IGNORE INTO servers (hostname, openclaw_home) VALUES ('localhost', '/opt/openclaw')`,
  ).run();
  const server = db.prepare("SELECT id FROM servers LIMIT 1").get() as { id: number };
  db.prepare(
    `INSERT OR IGNORE INTO instances
     (server_id, slug, port, config_path, state_dir, systemd_unit)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(server.id, slug, 19002, "/tmp/config.json", "/tmp/state", "openclaw-test.service");
}

function makeResolvedModel(): ResolvedModel {
  // runPromptLoop is mocked — the model is never actually called
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
    agentId: "main",
    abort: new AbortController().signal,
    metadata: vi.fn(),
  };
}

function makeCallerAgentConfig(overrides?: Partial<RuntimeAgentConfig>): RuntimeAgentConfig {
  return {
    id: "main",
    name: "Main",
    model: "anthropic/claude-sonnet-4-5",
    permissions: [],
    maxSteps: 20,
    allowSubAgents: true,
    toolProfile: "coding",
    isDefault: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let db: Database.Database;

beforeEach(() => {
  db = initDatabase(":memory:");
  seedInstance(db);
  disposeBus(INSTANCE_SLUG);
  initAgentRegistry([]);

  // Default mock: runPromptLoop returns a minimal result
  mockRunPromptLoop.mockResolvedValue({
    text: "sub-agent result",
    steps: 1,
    tokens: { input: 10, output: 5 },
  });
});

afterEach(() => {
  db.close();
  disposeBus(INSTANCE_SLUG);
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// inheritWorkspace tests
// ---------------------------------------------------------------------------

describe("createTaskTool — inheritWorkspace (Phase 1a)", () => {
  /**
   * Objective: when callerAgentConfig is absent, the sub-agent must inherit
   * the parent's workDir (safe default — callerAgentConfig?.inheritWorkspace
   * is undefined, which is !== false, so workDir is passed through).
   *
   * [negative] callerAgentConfig absent → sub-agent inherits workDir (safe default)
   */
  it("[negative] callerAgentConfig absent → sub-agent inherits workDir (safe default)", async () => {
    // Arrange: no callerAgentConfig provided
    const toolInfo = createTaskTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(),
      workDir: PARENT_WORK_DIR,
      // callerAgentConfig intentionally omitted
      runPromptLoop: mockRunPromptLoop,
    });
    const def = await toolInfo.init();
    const parentSession = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "main" });
    const ctx = makeToolContext(db, parentSession.id);

    // Act
    await def.execute(
      {
        description: "test task",
        prompt: "do something",
        subagent_type: "explore",
        lifecycle: "run",
        mode: "sync",
      },
      ctx,
    );

    // Assert: runPromptLoop was called with the parent's workDir
    expect(mockRunPromptLoop).toHaveBeenCalledOnce();
    const callArgs = mockRunPromptLoop.mock.calls[0]![0] as { workDir: string | undefined };
    expect(callArgs.workDir).toBe(PARENT_WORK_DIR);
  });

  /**
   * Objective: when inheritWorkspace is absent from callerAgentConfig,
   * the sub-agent must inherit the parent's workDir (undefined !== false → pass through).
   *
   * [positive] inheritWorkspace absent → sub-agent inherits workDir parent
   */
  it("[positive] inheritWorkspace absent → sub-agent inherits workDir parent", async () => {
    // Arrange: callerAgentConfig without inheritWorkspace field
    const callerAgentConfig = makeCallerAgentConfig();
    // Ensure inheritWorkspace is truly absent (not set to undefined explicitly)
    delete (callerAgentConfig as Partial<RuntimeAgentConfig>).inheritWorkspace;

    const toolInfo = createTaskTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(),
      workDir: PARENT_WORK_DIR,
      callerAgentConfig,
      runPromptLoop: mockRunPromptLoop,
    });
    const def = await toolInfo.init();
    const parentSession = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "main" });
    const ctx = makeToolContext(db, parentSession.id);

    // Act
    await def.execute(
      {
        description: "inherit test",
        prompt: "do something",
        subagent_type: "explore",
        lifecycle: "run",
        mode: "sync",
      },
      ctx,
    );

    // Assert: runPromptLoop was called with the parent's workDir
    expect(mockRunPromptLoop).toHaveBeenCalledOnce();
    const callArgs = mockRunPromptLoop.mock.calls[0]![0] as { workDir: string | undefined };
    expect(callArgs.workDir).toBe(PARENT_WORK_DIR);
  });

  /**
   * Objective: when inheritWorkspace: true, the sub-agent must receive
   * the same workDir as the parent.
   *
   * [positive] inheritWorkspace: true → sub-agent inherits workDir parent
   */
  it("[positive] inheritWorkspace: true → sub-agent inherits workDir parent", async () => {
    // Arrange: callerAgentConfig with inheritWorkspace explicitly set to true
    const callerAgentConfig = makeCallerAgentConfig({ inheritWorkspace: true });

    const toolInfo = createTaskTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(),
      workDir: PARENT_WORK_DIR,
      callerAgentConfig,
      runPromptLoop: mockRunPromptLoop,
    });
    const def = await toolInfo.init();
    const parentSession = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "main" });
    const ctx = makeToolContext(db, parentSession.id);

    // Act
    await def.execute(
      {
        description: "inherit true test",
        prompt: "do something",
        subagent_type: "explore",
        lifecycle: "run",
        mode: "sync",
      },
      ctx,
    );

    // Assert: runPromptLoop was called with the parent's workDir
    expect(mockRunPromptLoop).toHaveBeenCalledOnce();
    const callArgs = mockRunPromptLoop.mock.calls[0]![0] as { workDir: string | undefined };
    expect(callArgs.workDir).toBe(PARENT_WORK_DIR);
  });

  /**
   * Objective: when inheritWorkspace: false, the sub-agent must receive
   * workDir: undefined (isolated workspace).
   *
   * [positive] inheritWorkspace: false → sub-agent reçoit workDir: undefined
   */
  it("[positive] inheritWorkspace: false → sub-agent reçoit workDir: undefined", async () => {
    // Arrange: callerAgentConfig with inheritWorkspace explicitly set to false
    const callerAgentConfig = makeCallerAgentConfig({ inheritWorkspace: false });

    const toolInfo = createTaskTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(),
      workDir: PARENT_WORK_DIR,
      callerAgentConfig,
      runPromptLoop: mockRunPromptLoop,
    });
    const def = await toolInfo.init();
    const parentSession = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "main" });
    const ctx = makeToolContext(db, parentSession.id);

    // Act
    await def.execute(
      {
        description: "isolated workspace test",
        prompt: "do something",
        subagent_type: "explore",
        lifecycle: "run",
        mode: "sync",
      },
      ctx,
    );

    // Assert: runPromptLoop was called with workDir: undefined (isolated)
    expect(mockRunPromptLoop).toHaveBeenCalledOnce();
    const callArgs = mockRunPromptLoop.mock.calls[0]![0] as { workDir: string | undefined };
    expect(callArgs.workDir).toBeUndefined();
  });
});
