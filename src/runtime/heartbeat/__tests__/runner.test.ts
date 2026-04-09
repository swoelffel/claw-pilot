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

// Mock resolveModelForAgent to avoid DB named key lookups
vi.mock("../../channel/router.js", () => ({
  resolveModelForAgent: vi.fn().mockReturnValue({
    languageModel: {},
    providerId: "anthropic",
    modelId: "claude-3",
    costPerMillion: undefined,
  }),
}));

// Mock agent registry for permanent session resolution
vi.mock("../../agent/registry.js", () => ({
  getAgent: vi.fn().mockReturnValue({
    kind: "primary",
    category: "user",
    archetype: null,
    name: "sentinel",
    permission: [],
    mode: "all",
    options: {},
  }),
  resolveEffectivePersistence: vi.fn().mockReturnValue("ephemeral"),
  initAgentRegistry: vi.fn(),
}));

import { initDatabase } from "../../../db/schema.js";
import type Database from "better-sqlite3";
import { getBus, disposeBus } from "../../bus/index.js";
import { HeartbeatTick, HeartbeatAlert } from "../../bus/events.js";
import { startHeartbeatRunner } from "../runner.js";
import { runPromptLoop } from "../../session/prompt-loop.js";
import { resolveModelForAgent } from "../../channel/router.js";
import { resolveEffectivePersistence } from "../../agent/registry.js";
import { getOrCreatePermanentSession, listSessions } from "../../session/session.js";
import type { RuntimeAgentConfig, RuntimeConfig } from "../../config/index.js";

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

function makeRuntimeConfig(overrides?: Partial<RuntimeConfig>): RuntimeConfig {
  return {
    defaultModel: "anthropic/claude-3",
    agents: [],
    models: [],
    providers: [],
    compaction: { auto: true, threshold: 0.85, reservedTokens: 8000 },
    subagents: { maxSpawnDepth: 3, maxChildrenPerSession: 5, retentionHours: 72 },
    telegram: {
      enabled: false,
      botTokenEnvVar: "TELEGRAM_BOT_TOKEN",
      pollingIntervalMs: 1000,
      allowedUserIds: [],
      dmPolicy: "pairing",
      groupPolicy: "allowlist",
    },
    webChat: { enabled: true },
    globalPermissions: [],
    mcpEnabled: false,
    mcpServers: [],
    ...overrides,
  } as RuntimeConfig;
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
      runtimeConfig: makeRuntimeConfig(),
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
      runtimeConfig: makeRuntimeConfig(),
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
      runtimeConfig: makeRuntimeConfig(),
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
      runtimeConfig: makeRuntimeConfig(),
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
      runtimeConfig: makeRuntimeConfig(),
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
      runtimeConfig: makeRuntimeConfig(),
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
      runtimeConfig: makeRuntimeConfig(),
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
      runtimeConfig: makeRuntimeConfig(),
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
      runtimeConfig: makeRuntimeConfig(),
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

describe("startHeartbeatRunner — model resolution chain", () => {
  it("[positive] uses heartbeat.model override when specified", async () => {
    const mockResolve = vi.mocked(resolveModelForAgent);
    const mockRunPromptLoop = vi.mocked(runPromptLoop);
    mockRunPromptLoop.mockResolvedValue({
      text: "HEARTBEAT_OK",
      messageId: "m1",
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      costUsd: 0,
      steps: 0,
    });

    const agent = makeAgent({
      heartbeat: { every: "5m", model: "anthropic/claude-haiku-3-5" },
    });
    const cleanup = startHeartbeatRunner([agent], {
      db,
      instanceSlug: INSTANCE_SLUG,
      runtimeConfig: makeRuntimeConfig({ defaultHeartbeatModel: "openai/gpt-4o-mini" }),
      workDir: undefined,
    });

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(0);

    // heartbeat.model takes priority over defaultHeartbeatModel
    expect(mockResolve).toHaveBeenCalledWith(
      db,
      INSTANCE_SLUG,
      expect.objectContaining({ model: "anthropic/claude-haiku-3-5" }),
      expect.anything(),
    );
    cleanup();
  });

  it("[positive] falls back to defaultHeartbeatModel when no heartbeat.model", async () => {
    const mockResolve = vi.mocked(resolveModelForAgent);
    const mockRunPromptLoop = vi.mocked(runPromptLoop);
    mockRunPromptLoop.mockResolvedValue({
      text: "HEARTBEAT_OK",
      messageId: "m1",
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      costUsd: 0,
      steps: 0,
    });

    const agent = makeAgent({ heartbeat: { every: "5m" } });
    const cleanup = startHeartbeatRunner([agent], {
      db,
      instanceSlug: INSTANCE_SLUG,
      runtimeConfig: makeRuntimeConfig({ defaultHeartbeatModel: "openai/gpt-4o-mini" }),
      workDir: undefined,
    });

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(0);

    // defaultHeartbeatModel used as fallback
    expect(mockResolve).toHaveBeenCalledWith(
      db,
      INSTANCE_SLUG,
      expect.objectContaining({ model: "openai/gpt-4o-mini" }),
      expect.anything(),
    );
    cleanup();
  });

  it("[positive] uses agent model when neither heartbeat.model nor defaultHeartbeatModel set", async () => {
    const mockResolve = vi.mocked(resolveModelForAgent);
    const mockRunPromptLoop = vi.mocked(runPromptLoop);
    mockRunPromptLoop.mockResolvedValue({
      text: "HEARTBEAT_OK",
      messageId: "m1",
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      costUsd: 0,
      steps: 0,
    });

    const agent = makeAgent({ model: "anthropic/claude-sonnet-4-5", heartbeat: { every: "5m" } });
    const cleanup = startHeartbeatRunner([agent], {
      db,
      instanceSlug: INSTANCE_SLUG,
      runtimeConfig: makeRuntimeConfig(),
      workDir: undefined,
    });

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(0);

    // Agent's own model used (no override)
    expect(mockResolve).toHaveBeenCalledWith(
      db,
      INSTANCE_SLUG,
      expect.objectContaining({ model: "anthropic/claude-sonnet-4-5" }),
      expect.anything(),
    );
    cleanup();
  });
});

describe("startHeartbeatRunner — permanent session reuse", () => {
  it("[positive] uses permanent session for permanent agents", async () => {
    const mockPersistence = vi.mocked(resolveEffectivePersistence);
    mockPersistence.mockReturnValue("permanent");

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
      runtimeConfig: makeRuntimeConfig(),
      workDir: undefined,
    });

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(0);

    expect(mockRunPromptLoop).toHaveBeenCalledTimes(1);
    // Verify the session used is a permanent session (key format: slug:agentId)
    const call = mockRunPromptLoop.mock.calls[0]!;
    const sessionId = (call[0] as { sessionId: string }).sessionId;
    // Permanent sessions exist and are reusable — find it
    const permSession = getOrCreatePermanentSession(db, {
      instanceSlug: INSTANCE_SLUG,
      agentId: "sentinel",
      channel: "internal",
    });
    expect(sessionId).toBe(permSession.id);
    cleanup();
  });

  it("[positive] uses dedicated session for non-permanent agents", async () => {
    const mockPersistence = vi.mocked(resolveEffectivePersistence);
    mockPersistence.mockReturnValue("ephemeral");

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
      runtimeConfig: makeRuntimeConfig(),
      workDir: undefined,
    });

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(0);

    expect(mockRunPromptLoop).toHaveBeenCalledTimes(1);
    // Verify the session is an internal/heartbeat session (not permanent)
    const sessions = listSessions(db, INSTANCE_SLUG, { state: "active" });
    const hbSession = sessions.find(
      (s) => s.channel === "internal" && s.peerId === "heartbeat:sentinel",
    );
    expect(hbSession).toBeDefined();
    cleanup();
  });
});

describe("startHeartbeatRunner — heartbeat status tagging", () => {
  it("[positive] tags HEARTBEAT_OK message with heartbeat_status: ok", async () => {
    const mockRunPromptLoop = vi.mocked(runPromptLoop);

    // We need a real messageId that exists in the DB to tag
    // Create a session and message first, then make runPromptLoop return that messageId
    const { createSession } = await import("../../session/session.js");
    const { createAssistantMessage } = await import("../../session/message.js");
    const { createPart } = await import("../../session/part.js");

    const session = createSession(db, {
      instanceSlug: INSTANCE_SLUG,
      agentId: "sentinel",
      channel: "internal",
      peerId: "heartbeat:sentinel",
    });
    const msg = createAssistantMessage(db, { sessionId: session.id, agentId: "sentinel" });
    createPart(db, { messageId: msg.id, type: "text", content: "HEARTBEAT_OK" });

    mockRunPromptLoop.mockResolvedValue({
      text: "HEARTBEAT_OK",
      messageId: msg.id,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      costUsd: 0,
      steps: 0,
    });

    const cleanup = startHeartbeatRunner([makeAgent({ heartbeat: { every: "5m" } })], {
      db,
      instanceSlug: INSTANCE_SLUG,
      runtimeConfig: makeRuntimeConfig(),
      workDir: undefined,
    });

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(0);

    // Check that the part metadata was tagged
    const part = db
      .prepare("SELECT metadata FROM rt_parts WHERE message_id = ? AND type = 'text'")
      .get(msg.id) as { metadata: string | null } | undefined;
    expect(part).toBeDefined();
    expect(JSON.parse(part!.metadata!)).toEqual({ heartbeat_status: "ok" });
    cleanup();
  });

  it("[positive] tags alert message with heartbeat_status: alert", async () => {
    const mockRunPromptLoop = vi.mocked(runPromptLoop);

    const { createSession } = await import("../../session/session.js");
    const { createAssistantMessage } = await import("../../session/message.js");
    const { createPart } = await import("../../session/part.js");

    const session = createSession(db, {
      instanceSlug: INSTANCE_SLUG,
      agentId: "sentinel",
      channel: "internal",
      peerId: "heartbeat:sentinel",
    });
    const msg = createAssistantMessage(db, { sessionId: session.id, agentId: "sentinel" });
    createPart(db, { messageId: msg.id, type: "text", content: "Something is wrong" });

    mockRunPromptLoop.mockResolvedValue({
      text: "Something is wrong",
      messageId: msg.id,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      costUsd: 0,
      steps: 0,
    });

    const cleanup = startHeartbeatRunner([makeAgent({ heartbeat: { every: "5m" } })], {
      db,
      instanceSlug: INSTANCE_SLUG,
      runtimeConfig: makeRuntimeConfig(),
      workDir: undefined,
    });

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(0);

    const part = db
      .prepare("SELECT metadata FROM rt_parts WHERE message_id = ? AND type = 'text'")
      .get(msg.id) as { metadata: string | null } | undefined;
    expect(part).toBeDefined();
    expect(JSON.parse(part!.metadata!)).toEqual({ heartbeat_status: "alert" });
    cleanup();
  });
});
