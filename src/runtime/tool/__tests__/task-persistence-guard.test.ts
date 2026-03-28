/**
 * runtime/tool/__tests__/task-persistence-guard.test.ts
 *
 * Tests for the persistence guard in the task tool:
 * - Spawning a permanent agent is rejected with a clear error
 * - Spawning an ephemeral agent works normally
 * - Spawning an agent without explicit persistence works (backwards compat)
 * - @archetype resolution excludes permanent agents
 * - @archetype with only permanent candidates fails gracefully
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
import { disposeBus } from "../../bus/index.js";
import { createTaskTool } from "../task.js";
import type { Tool } from "../tool.js";
import type { ResolvedModel } from "../../provider/provider.js";
import type { RuntimeAgentConfig } from "../../config/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INSTANCE_SLUG = "test-guard";

function seedInstance(db: Database.Database, slug = INSTANCE_SLUG): void {
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

const CALLER_CONFIG: RuntimeAgentConfig = {
  id: "pilot",
  name: "Pilot",
  model: "anthropic/claude-sonnet-4-5",
  permissions: [],
  maxSteps: 20,
  allowSubAgents: true,
  toolProfile: "manager" as const,
  isDefault: true,
  persistence: "permanent",
};

const PERMANENT_AGENT: RuntimeAgentConfig = {
  id: "tech-mgr",
  name: "Tech Manager",
  model: "anthropic/claude-sonnet-4-5",
  permissions: [],
  maxSteps: 20,
  allowSubAgents: true,
  toolProfile: "manager" as const,
  isDefault: false,
  persistence: "permanent",
  archetype: "planner",
};

const EPHEMERAL_AGENT: RuntimeAgentConfig = {
  id: "dev",
  name: "Developer",
  model: "anthropic/claude-sonnet-4-5",
  permissions: [],
  maxSteps: 20,
  allowSubAgents: true,
  toolProfile: "executor" as const,
  isDefault: false,
  persistence: "ephemeral",
  archetype: "generator",
};

const EPHEMERAL_EVALUATOR: RuntimeAgentConfig = {
  id: "qa",
  name: "QA",
  model: "anthropic/claude-sonnet-4-5",
  permissions: [],
  maxSteps: 20,
  allowSubAgents: true,
  toolProfile: "executor" as const,
  isDefault: false,
  persistence: "ephemeral",
  archetype: "evaluator",
};

const PERMANENT_EVALUATOR: RuntimeAgentConfig = {
  id: "sentinel",
  name: "Sentinel",
  model: "anthropic/claude-sonnet-4-5",
  permissions: [],
  maxSteps: 20,
  allowSubAgents: true,
  toolProfile: "pilot" as const,
  isDefault: false,
  persistence: "permanent",
  archetype: "evaluator",
};

const LEGACY_AGENT: RuntimeAgentConfig = {
  id: "legacy",
  name: "Legacy Agent",
  model: "anthropic/claude-sonnet-4-5",
  permissions: [],
  maxSteps: 20,
  allowSubAgents: true,
  toolProfile: "executor" as const,
  isDefault: false,
  // No persistence field — backwards compat
};

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
// Persistence guard — direct spawn by ID
// ---------------------------------------------------------------------------

describe("persistence guard — spawn by ID", () => {
  it("rejects spawn of a permanent agent with clear error", async () => {
    const callerSession = createSession(db, {
      instanceSlug: INSTANCE_SLUG,
      agentId: "pilot",
      persistent: true,
    });
    const ctx = makeToolContext(db, callerSession.id);

    const toolInfo = createTaskTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(),
      workDir: undefined,
      callerAgentConfig: CALLER_CONFIG,
      runtimeAgentConfigs: [CALLER_CONFIG, PERMANENT_AGENT, EPHEMERAL_AGENT],
      runPromptLoop: vi.fn(),
    });
    const def = await toolInfo.init();

    await expect(
      def.execute(
        {
          description: "plan sprint",
          prompt: "Plan the next sprint",
          subagent_type: "tech-mgr",
          lifecycle: "run",
          mode: "sync",
        },
        ctx,
      ),
    ).rejects.toThrow(/permanent agent/);
  });

  it("allows spawn of an ephemeral agent", async () => {
    const callerSession = createSession(db, {
      instanceSlug: INSTANCE_SLUG,
      agentId: "pilot",
      persistent: true,
    });
    const ctx = makeToolContext(db, callerSession.id);

    const mockRunPromptLoop = vi.fn().mockResolvedValue({
      messageId: "msg-result",
      text: "Sprint planned",
      tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
      costUsd: 0,
      steps: 1,
    });

    const toolInfo = createTaskTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(),
      workDir: undefined,
      callerAgentConfig: CALLER_CONFIG,
      runtimeAgentConfigs: [CALLER_CONFIG, PERMANENT_AGENT, EPHEMERAL_AGENT],
      runPromptLoop: mockRunPromptLoop,
    });
    const def = await toolInfo.init();

    const result = await def.execute(
      {
        description: "write feature",
        prompt: "Implement the login page",
        subagent_type: "dev",
        lifecycle: "run",
        mode: "sync",
      },
      ctx,
    );

    expect(mockRunPromptLoop).toHaveBeenCalled();
    expect(result.output).toContain("task_result");
  });

  it("allows spawn of a legacy agent without persistence field (backwards compat)", async () => {
    const callerSession = createSession(db, {
      instanceSlug: INSTANCE_SLUG,
      agentId: "pilot",
      persistent: true,
    });
    const ctx = makeToolContext(db, callerSession.id);

    const mockRunPromptLoop = vi.fn().mockResolvedValue({
      messageId: "msg-result",
      text: "Done",
      tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
      costUsd: 0,
      steps: 1,
    });

    const toolInfo = createTaskTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(),
      workDir: undefined,
      callerAgentConfig: CALLER_CONFIG,
      runtimeAgentConfigs: [CALLER_CONFIG, LEGACY_AGENT],
      runPromptLoop: mockRunPromptLoop,
    });
    const def = await toolInfo.init();

    const result = await def.execute(
      {
        description: "legacy task",
        prompt: "Do something",
        subagent_type: "legacy",
        lifecycle: "run",
        mode: "sync",
      },
      ctx,
    );

    expect(mockRunPromptLoop).toHaveBeenCalled();
    expect(result.output).toContain("task_result");
  });
});

// ---------------------------------------------------------------------------
// Persistence guard — @archetype resolution
// ---------------------------------------------------------------------------

describe("persistence guard — @archetype resolution", () => {
  it("excludes permanent agents from archetype matching", async () => {
    // Both sentinel (permanent) and qa (ephemeral) have archetype "evaluator"
    // The @evaluator resolution should pick qa, not sentinel
    const callerSession = createSession(db, {
      instanceSlug: INSTANCE_SLUG,
      agentId: "pilot",
      persistent: true,
    });
    const ctx = makeToolContext(db, callerSession.id);

    const mockRunPromptLoop = vi.fn().mockResolvedValue({
      messageId: "msg-result",
      text: "Tests passed",
      tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
      costUsd: 0,
      steps: 1,
    });

    const toolInfo = createTaskTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(),
      workDir: undefined,
      callerAgentConfig: CALLER_CONFIG,
      runtimeAgentConfigs: [
        CALLER_CONFIG,
        PERMANENT_EVALUATOR, // sentinel — permanent, should be skipped
        EPHEMERAL_EVALUATOR, // qa — ephemeral, should be picked
      ],
      runPromptLoop: mockRunPromptLoop,
    });
    const def = await toolInfo.init();

    const result = await def.execute(
      {
        description: "run QA",
        prompt: "Run quality checks",
        subagent_type: "evaluator",
        lifecycle: "run",
        mode: "sync",
      },
      ctx,
    );

    // Should have resolved to "qa" (ephemeral), not "sentinel" (permanent)
    expect(mockRunPromptLoop).toHaveBeenCalled();
    expect(result.output).toContain("qa");
    expect(result.output).not.toContain("sentinel");
  });

  it("fails when only permanent candidates match the archetype", async () => {
    // Only sentinel has archetype "evaluator" and it's permanent
    const callerSession = createSession(db, {
      instanceSlug: INSTANCE_SLUG,
      agentId: "pilot",
      persistent: true,
    });
    const ctx = makeToolContext(db, callerSession.id);

    const toolInfo = createTaskTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(),
      workDir: undefined,
      callerAgentConfig: CALLER_CONFIG,
      runtimeAgentConfigs: [
        CALLER_CONFIG,
        PERMANENT_EVALUATOR, // sentinel — permanent, only candidate
      ],
      runPromptLoop: vi.fn(),
    });
    const def = await toolInfo.init();

    // "evaluator" archetype won't match sentinel (permanent), so no primary peer found.
    // Falls through to built-in agent lookup, which also fails → throws unknown agent error.
    await expect(
      def.execute(
        {
          description: "run QA",
          prompt: "Run quality checks",
          subagent_type: "evaluator",
          lifecycle: "run",
          mode: "sync",
        },
        ctx,
      ),
    ).rejects.toThrow(/Unknown agent type/);
  });
});
