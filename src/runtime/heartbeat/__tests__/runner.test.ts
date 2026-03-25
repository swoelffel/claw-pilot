/**
 * runtime/heartbeat/__tests__/runner.test.ts
 *
 * Unit tests for startHeartbeatRunner.
 * runPromptLoop is mocked — no LLM calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock runPromptLoop to avoid LLM calls
vi.mock("../../session/prompt-loop.js", () => ({
  runPromptLoop: vi.fn().mockResolvedValue({
    text: "HEARTBEAT_OK",
    messageId: "m1",
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    costUsd: 0,
    steps: 0,
  }),
}));

// Mock getTools to avoid loading heavy built-in tools
vi.mock("../../tool/registry.js", () => ({
  getTools: vi.fn().mockResolvedValue([]),
}));

import { initDatabase } from "../../../db/schema.js";
import type Database from "better-sqlite3";
import { getBus, disposeBus } from "../../bus/index.js";
import { HeartbeatTick, HeartbeatAlert } from "../../bus/events.js";
import { startHeartbeatRunner } from "../runner.js";
import { runPromptLoop } from "../../session/prompt-loop.js";
import type { RuntimeAgentConfig } from "../../config/index.js";
import type { ResolvedModel } from "../../provider/provider.js";

const INSTANCE_SLUG = "test-heartbeat-runner";

function seedInstance(db: Database.Database) {
  db.prepare(
    `INSERT OR IGNORE INTO servers (hostname, openclaw_home) VALUES ('localhost', '/opt/openclaw')`,
  ).run();
  const server = db.prepare("SELECT id FROM servers LIMIT 1").get() as { id: number };
  db.prepare(
    `INSERT OR IGNORE INTO instances
     (server_id, slug, port, config_path, state_dir, systemd_unit)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(server.id, INSTANCE_SLUG, 19001, "/tmp/config.json", "/tmp/state", "openclaw-test.service");
}

function makeAgent(overrides?: Partial<RuntimeAgentConfig>): RuntimeAgentConfig {
  return {
    id: "sentinel",
    name: "Sentinel",
    model: "anthropic/claude-3",
    permissions: [],
    maxSteps: 5,
    allowSubAgents: false,
    toolProfile: "sentinel",
    isDefault: false,
    heartbeat: { every: "30m" },
    ...overrides,
  };
}

function makeResolvedModel(): ResolvedModel {
  return {
    languageModel: {} as ResolvedModel["languageModel"],
    providerId: "anthropic",
    modelId: "claude-3",
    costPerMillion: undefined,
  };
}

let db: Database.Database;

beforeEach(() => {
  db = initDatabase(":memory:");
  seedInstance(db);
  disposeBus(INSTANCE_SLUG);
  vi.useFakeTimers();
});

afterEach(() => {
  db.close();
  disposeBus(INSTANCE_SLUG);
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("startHeartbeatRunner — lifecycle", () => {
  it("[positive] returns a cleanup function", () => {
    const cleanup = startHeartbeatRunner([makeAgent()], {
      db,
      instanceSlug: INSTANCE_SLUG,
      resolveModel: makeResolvedModel,
      workDir: undefined,
    });
    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  it("[positive] cleanup stops all intervals (no more ticks after cleanup)", async () => {
    const mockRunPromptLoop = vi.mocked(runPromptLoop);
    mockRunPromptLoop.mockResolvedValue({
      text: "HEARTBEAT_OK",
      messageId: "m1",
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      costUsd: 0,
      steps: 0,
    });

    const cleanup = startHeartbeatRunner([makeAgent({ heartbeat: { every: "5m" } })], {
      db,
      instanceSlug: INSTANCE_SLUG,
      resolveModel: makeResolvedModel,
      workDir: undefined,
    });

    cleanup();

    // Advance past the interval — no ticks should fire
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(mockRunPromptLoop).not.toHaveBeenCalled();
  });

  it("[negative] agents without heartbeat config get no interval", async () => {
    const mockRunPromptLoop = vi.mocked(runPromptLoop);
    // Build agent without heartbeat by omitting the field entirely
    const agentWithout: RuntimeAgentConfig = {
      id: "sentinel",
      name: "Sentinel",
      model: "anthropic/claude-3",
      permissions: [],
      maxSteps: 5,
      allowSubAgents: false,
      toolProfile: "sentinel",
      isDefault: false,
    };

    startHeartbeatRunner([agentWithout], {
      db,
      instanceSlug: INSTANCE_SLUG,
      resolveModel: makeResolvedModel,
      workDir: undefined,
    });

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000); // 1h
    expect(mockRunPromptLoop).not.toHaveBeenCalled();
  });
});

describe("startHeartbeatRunner — tick behavior", () => {
  it("[positive] calls runPromptLoop on each tick", async () => {
    const mockRunPromptLoop = vi.mocked(runPromptLoop);
    mockRunPromptLoop.mockResolvedValue({
      text: "HEARTBEAT_OK",
      messageId: "m1",
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      costUsd: 0,
      steps: 0,
    });

    const cleanup = startHeartbeatRunner([makeAgent({ heartbeat: { every: "5m" } })], {
      db,
      instanceSlug: INSTANCE_SLUG,
      resolveModel: makeResolvedModel,
      workDir: undefined,
    });

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    // Allow the async tick Promise chain to settle
    await vi.advanceTimersByTimeAsync(0);

    expect(mockRunPromptLoop).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("[positive] silent when runPromptLoop returns HEARTBEAT_OK", async () => {
    const mockRunPromptLoop = vi.mocked(runPromptLoop);
    mockRunPromptLoop.mockResolvedValue({
      text: "HEARTBEAT_OK",
      messageId: "m1",
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      costUsd: 0,
      steps: 0,
    });

    const bus = getBus(INSTANCE_SLUG);
    const alertHandler = vi.fn();
    bus.subscribe(HeartbeatAlert, alertHandler);

    const cleanup = startHeartbeatRunner([makeAgent({ heartbeat: { every: "5m" } })], {
      db,
      instanceSlug: INSTANCE_SLUG,
      resolveModel: makeResolvedModel,
      workDir: undefined,
    });

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(0);

    expect(alertHandler).not.toHaveBeenCalled();
    cleanup();
  });

  it("[negative] publishes HeartbeatAlert when result is not HEARTBEAT_OK", async () => {
    const mockRunPromptLoop = vi.mocked(runPromptLoop);
    mockRunPromptLoop.mockResolvedValue({
      text: "Something went wrong",
      messageId: "m1",
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      costUsd: 0,
      steps: 0,
    });

    const bus = getBus(INSTANCE_SLUG);
    const alertHandler = vi.fn();
    bus.subscribe(HeartbeatAlert, alertHandler);

    const cleanup = startHeartbeatRunner([makeAgent({ heartbeat: { every: "5m" } })], {
      db,
      instanceSlug: INSTANCE_SLUG,
      resolveModel: makeResolvedModel,
      workDir: undefined,
    });

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(0);

    expect(alertHandler).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "sentinel", text: "Something went wrong" }),
    );
    cleanup();
  });

  it("[positive] publishes HeartbeatTick on each tick", async () => {
    const mockRunPromptLoop = vi.mocked(runPromptLoop);
    mockRunPromptLoop.mockResolvedValue({
      text: "HEARTBEAT_OK",
      messageId: "m1",
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      costUsd: 0,
      steps: 0,
    });

    const bus = getBus(INSTANCE_SLUG);
    const tickHandler = vi.fn();
    bus.subscribe(HeartbeatTick, tickHandler);

    const cleanup = startHeartbeatRunner([makeAgent({ heartbeat: { every: "5m" } })], {
      db,
      instanceSlug: INSTANCE_SLUG,
      resolveModel: makeResolvedModel,
      workDir: undefined,
    });

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000); // 3 ticks
    await vi.advanceTimersByTimeAsync(0);

    expect(tickHandler).toHaveBeenCalledTimes(3);
    cleanup();
  });
});

describe("startHeartbeatRunner — error resilience", () => {
  it("[negative] runPromptLoop error does not crash the runner (next tick still fires)", async () => {
    const mockRunPromptLoop = vi.mocked(runPromptLoop);
    mockRunPromptLoop.mockRejectedValueOnce(new Error("LLM down")).mockResolvedValue({
      text: "HEARTBEAT_OK",
      messageId: "m1",
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      costUsd: 0,
      steps: 0,
    });

    const cleanup = startHeartbeatRunner([makeAgent({ heartbeat: { every: "5m" } })], {
      db,
      instanceSlug: INSTANCE_SLUG,
      resolveModel: makeResolvedModel,
      workDir: undefined,
    });

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000); // 2 ticks
    await vi.advanceTimersByTimeAsync(0);

    expect(mockRunPromptLoop).toHaveBeenCalledTimes(2);
    cleanup();
  });

  it("[negative] publishes HeartbeatAlert when runPromptLoop throws", async () => {
    const mockRunPromptLoop = vi.mocked(runPromptLoop);
    mockRunPromptLoop.mockRejectedValue(new Error("LLM down"));

    const bus = getBus(INSTANCE_SLUG);
    const alertHandler = vi.fn();
    bus.subscribe(HeartbeatAlert, alertHandler);

    const cleanup = startHeartbeatRunner([makeAgent({ heartbeat: { every: "5m" } })], {
      db,
      instanceSlug: INSTANCE_SLUG,
      resolveModel: makeResolvedModel,
      workDir: undefined,
    });

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(0);

    expect(alertHandler).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("LLM down") }),
    );
    cleanup();
  });
});
