/**
 * runtime/engine/__tests__/engine.test.ts
 *
 * Unit tests for ClawRuntime engine.
 * All subsystems are mocked — only the orchestration logic is tested.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock ALL subsystem imports BEFORE importing ClawRuntime
// ---------------------------------------------------------------------------

const mockBus = {
  publish: vi.fn(),
  subscribeAll: vi.fn(() => vi.fn()),
  subscribe: vi.fn(() => vi.fn()),
};

vi.mock("../../bus/index.js", () => ({
  getBus: vi.fn(() => mockBus),
  disposeBus: vi.fn(),
}));
vi.mock("../../bus/events.js", () => ({
  RuntimeStarted: Symbol("RuntimeStarted"),
  RuntimeStopped: Symbol("RuntimeStopped"),
  RuntimeStateChanged: Symbol("RuntimeStateChanged"),
  RuntimeError: Symbol("RuntimeError"),
  WorkspaceFileChanged: Symbol("WorkspaceFileChanged"),
}));
vi.mock("../../agent/registry.js", () => ({
  initAgentRegistry: vi.fn(),
  resolveEffectivePersistence: vi.fn(() => "ephemeral"),
  getAgent: vi.fn(() => ({
    kind: "primary",
    category: "user",
    archetype: null,
    name: "main",
    permission: [],
    mode: "all",
    options: {},
  })),
}));
vi.mock("../../session/session.js", () => ({
  getOrCreatePermanentSession: vi.fn(() => ({ id: "perm-sess-1" })),
}));
vi.mock("../../mcp/registry.js", () => {
  class MockMcpRegistry {
    init = vi.fn().mockResolvedValue(undefined);
    dispose = vi.fn().mockResolvedValue(undefined);
  }
  return { McpRegistry: MockMcpRegistry };
});
vi.mock("../../channel/router.js", () => ({
  ChannelRouter: {
    route: vi.fn().mockResolvedValue({ response: { text: "ok" } }),
  },
  registerSubagentCompletedHandler: vi.fn(() => vi.fn()),
}));
vi.mock("../channel-factory.js", () => ({
  createChannels: vi.fn(() => []),
}));
vi.mock("../plugin-wiring.js", () => ({
  wirePluginsToBus: vi.fn(() => []),
}));
vi.mock("../../heartbeat/runner.js", () => ({
  startHeartbeatRunner: vi.fn(() => vi.fn()),
}));
vi.mock("../../middleware/index.js", () => ({
  registerMiddleware: vi.fn(),
  clearMiddlewares: vi.fn(),
}));
vi.mock("../../middleware/built-in/guardrail.js", () => ({
  guardrailMiddleware: {},
}));
vi.mock("../../middleware/built-in/multimodal.js", () => ({
  multimodalMiddleware: {},
}));
vi.mock("../../middleware/built-in/tool-error-recovery.js", () => ({
  toolErrorRecoveryMiddleware: {},
}));
vi.mock("../../middleware/built-in/suggestions.js", () => ({
  createSuggestionMiddleware: vi.fn(() => ({})),
}));
vi.mock("../../session/cleanup.js", () => ({
  cleanupEphemeralSessions: vi.fn(() => ({
    sessionsDeleted: 0,
    messagesDeleted: 0,
    partsDeleted: 0,
    durationMs: 0,
  })),
}));
vi.mock("../event-persistence.js", () => ({
  wireEventPersistence: vi.fn(() => vi.fn()),
}));
vi.mock("../task-wiring.js", () => ({
  wireTaskNotifications: vi.fn(() => vi.fn()),
}));
vi.mock("../../../core/repositories/rt-event-repository.js", () => ({
  pruneRtEvents: vi.fn(() => 0),
}));
vi.mock("../../../core/repositories/budget-repository.js", () => ({
  resetExpiredMonthlyBudgets: vi.fn(() => 0),
  getBudgetsForInstance: vi.fn(() => []),
  reconcileBudget: vi.fn(() => ({ drift: 0, corrected: false })),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { initDatabase } from "../../../db/schema.js";
import { ClawRuntime } from "../engine.js";
import type { InstanceSlug } from "../../types.js";
import { RuntimeStarted, RuntimeStopped } from "../../bus/events.js";
import { createChannels } from "../channel-factory.js";
import { clearMiddlewares, registerMiddleware } from "../../middleware/index.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const SLUG = "test-inst" as InstanceSlug;

const minimalConfig = {
  defaultModel: "anthropic/claude-sonnet-4-20250514",
  agents: [
    {
      id: "main",
      name: "Main",
      model: "anthropic/claude-sonnet-4-20250514",
      permissions: [],
      maxSteps: 20,
      allowSubAgents: false,
      toolProfile: "executor" as const,
      isDefault: true,
      inheritWorkspace: true,
    },
  ],
  mcpEnabled: false,
  mcpServers: [],
  compaction: { threshold: 0.85 },
  subagents: { retentionHours: 72 },
  artifacts: { suggestionsEnabled: false },
  models: [],
} as any;

function makeMockChannel(type: string, overrides: Record<string, unknown> = {}) {
  return {
    type,
    onMessage: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ClawRuntime", () => {
  let db: ReturnType<typeof initDatabase>;

  beforeEach(() => {
    vi.useFakeTimers();
    db = initDatabase(":memory:");
    db.prepare(
      "INSERT INTO servers (id, hostname, openclaw_home) VALUES (1, 'localhost', '/opt/claw-pilot')",
    ).run();
    db.prepare(
      "INSERT INTO instances (server_id, slug, port, state, config_path, state_dir, systemd_unit) VALUES (1, 'test-inst', 18789, 'running', '/tmp/config.json', '/tmp/state', 'claw-pilot@test-inst')",
    ).run();
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  describe("constructor", () => {
    it("initial state is 'stopped'", () => {
      const rt = new ClawRuntime(minimalConfig, db, SLUG);
      expect(rt.state).toBe("stopped");
    });

    it("error is undefined", () => {
      const rt = new ClawRuntime(minimalConfig, db, SLUG);
      expect(rt.error).toBeUndefined();
    });

    it("log is a Logger child", () => {
      const rt = new ClawRuntime(minimalConfig, db, SLUG);
      expect(rt.log).toBeDefined();
      expect(typeof rt.log.info).toBe("function");
      expect(typeof rt.log.error).toBe("function");
    });
  });

  // -------------------------------------------------------------------------
  // start()
  // -------------------------------------------------------------------------

  describe("start()", () => {
    it("transitions to 'running'", async () => {
      const rt = new ClawRuntime(minimalConfig, db, SLUG);
      await rt.start();
      expect(rt.state).toBe("running");
    });

    it("is idempotent when already running", async () => {
      const rt = new ClawRuntime(minimalConfig, db, SLUG);
      await rt.start();
      await rt.start(); // second call — no error
      expect(rt.state).toBe("running");
    });

    it("publishes RuntimeStarted event", async () => {
      const rt = new ClawRuntime(minimalConfig, db, SLUG);
      await rt.start();
      expect(mockBus.publish).toHaveBeenCalledWith(RuntimeStarted, {
        slug: SLUG,
      });
    });

    it("sets state to 'error' when createChannels throws", async () => {
      vi.mocked(createChannels).mockImplementationOnce(() => {
        throw new Error("channel init failed");
      });
      const rt = new ClawRuntime(minimalConfig, db, SLUG);
      await expect(rt.start()).rejects.toThrow("channel init failed");
      expect(rt.state).toBe("error");
      expect(rt.error).toBe("channel init failed");
    });

    it("initializes MCP when mcpEnabled=true with servers", async () => {
      const mcpConfig = {
        ...minimalConfig,
        mcpEnabled: true,
        mcpServers: [{ id: "test", type: "stdio", enabled: true, command: "echo", args: [] }],
      };
      const rt = new ClawRuntime(mcpConfig, db, SLUG);
      await rt.start();
      const registry = rt.getMcpRegistry();
      expect(registry).toBeDefined();
      expect(registry!.init).toHaveBeenCalled();
    });

    it("calls clearMiddlewares + registerMiddleware", async () => {
      vi.mocked(clearMiddlewares).mockClear();
      vi.mocked(registerMiddleware).mockClear();
      const rt = new ClawRuntime(minimalConfig, db, SLUG);
      await rt.start();
      expect(clearMiddlewares).toHaveBeenCalled();
      // guardrail + multimodal + toolErrorRecovery = 3 (suggestions disabled)
      expect(registerMiddleware).toHaveBeenCalledTimes(3);
    });
  });

  // -------------------------------------------------------------------------
  // stop()
  // -------------------------------------------------------------------------

  describe("stop()", () => {
    it("transitions to 'stopped' from 'running'", async () => {
      const rt = new ClawRuntime(minimalConfig, db, SLUG);
      await rt.start();
      await rt.stop();
      expect(rt.state).toBe("stopped");
    });

    it("is idempotent when already stopped", async () => {
      const rt = new ClawRuntime(minimalConfig, db, SLUG);
      await rt.stop(); // no-op — already stopped
      expect(rt.state).toBe("stopped");
    });

    it("is resilient to channel disconnect errors", async () => {
      const badChannel = makeMockChannel("failing", {
        disconnect: vi.fn().mockRejectedValue(new Error("disconnect boom")),
      });
      vi.mocked(createChannels).mockReturnValueOnce([badChannel] as any);

      const rt = new ClawRuntime(minimalConfig, db, SLUG);
      await rt.start();
      await rt.stop(); // should not throw
      expect(rt.state).toBe("stopped");
    });

    it("publishes RuntimeStopped event", async () => {
      const rt = new ClawRuntime(minimalConfig, db, SLUG);
      await rt.start();
      mockBus.publish.mockClear();
      await rt.stop();
      expect(mockBus.publish).toHaveBeenCalledWith(
        RuntimeStopped,
        expect.objectContaining({ slug: SLUG }),
      );
    });

    it("disposes MCP registry", async () => {
      const mcpConfig = {
        ...minimalConfig,
        mcpEnabled: true,
        mcpServers: [{ id: "test", type: "stdio", enabled: true, command: "echo", args: [] }],
      };
      const rt = new ClawRuntime(mcpConfig, db, SLUG);
      await rt.start();
      const registry = rt.getMcpRegistry()!;
      await rt.stop();
      expect(registry.dispose).toHaveBeenCalled();
      expect(rt.getMcpRegistry()).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // send()
  // -------------------------------------------------------------------------

  describe("send()", () => {
    it("rejects when not running", async () => {
      const rt = new ClawRuntime(minimalConfig, db, SLUG);
      await expect(
        rt.send({ channelType: "web-chat", peerId: "u1", text: "hi" } as any),
      ).rejects.toThrow("ClawRuntime is not running");
    });
  });

  // -------------------------------------------------------------------------
  // getMcpRegistry()
  // -------------------------------------------------------------------------

  describe("getMcpRegistry()", () => {
    it("returns undefined before start", () => {
      const rt = new ClawRuntime(minimalConfig, db, SLUG);
      expect(rt.getMcpRegistry()).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // getChannelStatuses()
  // -------------------------------------------------------------------------

  describe("getChannelStatuses()", () => {
    it("returns empty object with no channels", async () => {
      const rt = new ClawRuntime(minimalConfig, db, SLUG);
      await rt.start();
      expect(rt.getChannelStatuses()).toEqual({});
    });

    it("returns statuses when channels have getStatus method", async () => {
      const ch = makeMockChannel("web-chat", {
        getStatus: vi.fn(() => "connected"),
      });
      vi.mocked(createChannels).mockReturnValueOnce([ch] as any);

      const rt = new ClawRuntime(minimalConfig, db, SLUG);
      await rt.start();
      expect(rt.getChannelStatuses()).toEqual({ "web-chat": "connected" });
    });
  });
});
