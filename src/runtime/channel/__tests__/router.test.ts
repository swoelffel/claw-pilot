/**
 * runtime/channel/__tests__/router.test.ts
 *
 * Unit tests for ChannelRouter.route() and the exported resolveModelForAgent() helper.
 *
 * Uses heavy mocking to isolate the router from the prompt loop, session management,
 * agent registry, provider resolution, middleware pipeline, and bus.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks (hoisted by vitest)
// ---------------------------------------------------------------------------

const mockPublish = vi.fn();

vi.mock("../../session/session.js", () => ({
  createSession: vi.fn(() => ({ id: "sess-001" })),
  getSession: vi.fn(),
  getSessionByKey: vi.fn(() => null),
  buildSessionKey: vi.fn(
    (slug: string, agent: string, channel: string, peer: string) =>
      `${slug}:${agent}:${channel}:${peer}`,
  ),
  getOrCreatePermanentSession: vi.fn(() => ({ id: "perm-001" })),
}));

vi.mock("../../session/prompt-loop.js", () => ({
  runPromptLoop: vi.fn().mockResolvedValue({
    messageId: "msg-001",
    text: "Hello from the agent!",
    steps: 1,
    tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
    costUsd: 0.001,
  }),
}));

vi.mock("../../session/message.js", () => ({
  createUserMessage: vi.fn(() => ({ id: "umsg-001" })),
}));

vi.mock("../../session/part.js", () => ({
  listParts: vi.fn(() => []),
}));

vi.mock("../../agent/registry.js", () => ({
  getAgent: vi.fn(() => ({
    name: "main",
    kind: "primary",
    category: "user",
    archetype: null,
    model: "anthropic/claude-sonnet-4-5",
    prompt: "You are a helpful assistant.",
    permission: [],
    mode: "all",
    options: {},
    steps: 20,
  })),
  defaultAgentName: vi.fn(() => "main"),
  resolveEffectivePersistence: vi.fn(() => "ephemeral"),
}));

vi.mock("../../provider/provider.js", () => ({
  resolveModel: vi.fn(() => ({
    languageModel: {},
    providerId: "anthropic",
    modelId: "claude-sonnet-4-5",
    costPerMillion: { input: 3, output: 15 },
  })),
}));

vi.mock("../../../core/repositories/named-key-repository.js", () => ({
  NamedKeyRepository: class {
    getDecryptedKey() {
      return "sk-test-key";
    }
    getDefaultKeyForInstance() {
      return null;
    }
    findKeyByProvider() {
      return null;
    }
  },
}));

vi.mock("../../../lib/crypto.js", () => ({
  isCryptoAvailable: vi.fn(() => false),
}));

vi.mock("../../bus/index.js", () => ({
  getBus: vi.fn(() => ({ publish: mockPublish })),
}));

vi.mock("../../middleware/pipeline.js", () => ({
  runMiddlewarePipeline: vi.fn(async (input: { runLoop: () => Promise<unknown> }) => ({
    result: await input.runLoop(),
    aborted: false,
  })),
}));

vi.mock("../../../core/agent-workspace.js", () => ({
  resolveAgentWorkspacePath: vi.fn(() => "/tmp/workspace/main"),
}));

vi.mock("../../../lib/logger.js", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { ChannelRouter, resolveModelForAgent } from "../router.js";
import type { RouterInput } from "../router.js";
import type { InboundMessage, InstanceSlug } from "../../types.js";
import type { RuntimeConfig } from "../../config/index.js";
import { getAgent, defaultAgentName, resolveEffectivePersistence } from "../../agent/registry.js";
import { runPromptLoop } from "../../session/prompt-loop.js";
import { runMiddlewarePipeline } from "../../middleware/pipeline.js";
import { isCryptoAvailable } from "../../../lib/crypto.js";
import { resolveModel } from "../../provider/provider.js";
import { ChannelMessageReceived, ChannelMessageSent } from "../../bus/events.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INSTANCE_SLUG: InstanceSlug = "test-router";

function makeMessage(overrides?: Partial<InboundMessage>): InboundMessage {
  return {
    channelType: "web",
    peerId: "user-42",
    text: "Hello agent",
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<RuntimeConfig>): RuntimeConfig {
  return {
    version: 1,
    defaultModel: "anthropic/claude-sonnet-4-5",
    providers: [],
    agents: [
      {
        id: "main",
        name: "Main",
        model: "anthropic/claude-sonnet-4-5",
        permissions: [],
        maxSteps: 5,
        allowSubAgents: true,
        toolProfile: "executor",
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
    compaction: { auto: true, threshold: 0.85, reservedTokens: 8000, periodicMessageCount: 0 },
    subagents: { maxSpawnDepth: 3, maxChildrenPerSession: 5, retentionHours: 72 },
    multimodal: {
      enabled: true,
      maxFileSizeMB: 20,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    },
    artifacts: { enabled: true, suggestionsEnabled: true, maxSuggestions: 3 },
    mcpEnabled: false,
    mcpServers: [],
    log: { level: "info" as const, format: "text" as const, maxSizeMb: 10, maxFiles: 3 },
    ...overrides,
  };
}

/** Minimal stub for the Database parameter (only used in mocked calls). */
function makeFakeDb(): import("better-sqlite3").Database {
  return {
    prepare: vi.fn(() => ({ get: vi.fn(() => undefined), all: vi.fn(() => []), run: vi.fn() })),
  } as unknown as import("better-sqlite3").Database;
}

function makeRouterInput(overrides?: Partial<RouterInput>): RouterInput {
  return {
    db: makeFakeDb(),
    instanceSlug: INSTANCE_SLUG,
    config: makeConfig(),
    message: makeMessage(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Re-establish default mock returns after clearAllMocks
  vi.mocked(defaultAgentName).mockReturnValue("main");
  vi.mocked(getAgent).mockReturnValue({
    name: "main",
    kind: "primary",
    category: "user",
    archetype: null,
    model: "anthropic/claude-sonnet-4-5",
    prompt: "You are a helpful assistant.",
    permission: [],
    mode: "all",
    options: {},
    steps: 20,
  } as ReturnType<typeof getAgent>);
  vi.mocked(resolveEffectivePersistence).mockReturnValue("ephemeral");

  vi.mocked(runPromptLoop).mockResolvedValue({
    messageId: "msg-001",
    text: "Hello from the agent!",
    steps: 1,
    tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
    costUsd: 0.001,
  });

  vi.mocked(runMiddlewarePipeline).mockImplementation(async (input) => ({
    result: await input.runLoop(),
    aborted: false,
  }));

  vi.mocked(isCryptoAvailable).mockReturnValue(false);

  vi.mocked(resolveModel).mockReturnValue({
    languageModel: {} as never,
    providerId: "anthropic",
    modelId: "claude-sonnet-4-5",
    costPerMillion: { input: 3, output: 15 },
  });
});

// ---------------------------------------------------------------------------
// ChannelRouter.route()
// ---------------------------------------------------------------------------

describe("ChannelRouter.route()", () => {
  it("publishes ChannelMessageReceived event", async () => {
    const input = makeRouterInput();
    await ChannelRouter.route(input);

    expect(mockPublish).toHaveBeenCalledWith(ChannelMessageReceived, {
      channelType: "web",
      peerId: "user-42",
      text: "Hello agent",
    });
  });

  it("resolves default agent when no agentId specified", async () => {
    const input = makeRouterInput();
    delete input.agentId;
    await ChannelRouter.route(input);

    expect(defaultAgentName).toHaveBeenCalled();
    expect(getAgent).toHaveBeenCalledWith("main");
  });

  it("uses specified agentId when provided", async () => {
    const input = makeRouterInput({ agentId: "custom-agent" });
    await ChannelRouter.route(input);

    expect(getAgent).toHaveBeenCalledWith("custom-agent");
  });

  it("returns response with text from prompt loop", async () => {
    const result = await ChannelRouter.route(makeRouterInput());

    expect(result.response.text).toBe("Hello from the agent!");
    expect(result.response.channelType).toBe("web");
    expect(result.response.peerId).toBe("user-42");
    expect(result.tokens).toEqual({ input: 100, output: 50, cacheRead: 0, cacheWrite: 0 });
    expect(result.costUsd).toBe(0.001);
  });

  it("publishes ChannelMessageSent event after response", async () => {
    await ChannelRouter.route(makeRouterInput());

    expect(mockPublish).toHaveBeenCalledWith(
      ChannelMessageSent,
      expect.objectContaining({
        channelType: "web",
        peerId: "user-42",
        text: "Hello from the agent!",
      }),
    );
  });

  it("throws when agent is not found", async () => {
    vi.mocked(getAgent).mockReturnValue(undefined);
    const input = makeRouterInput({ agentId: "nonexistent" });

    await expect(ChannelRouter.route(input)).rejects.toThrow("Agent not found: nonexistent");
  });

  it("throws when agent is a subagent", async () => {
    vi.mocked(getAgent).mockReturnValue({
      name: "sub",
      kind: "subagent",
      category: "system",
      archetype: null,
      model: "anthropic/claude-sonnet-4-5",
      prompt: "",
      permission: [],
      mode: "all",
      options: {},
      steps: 5,
    } as ReturnType<typeof getAgent>);

    const input = makeRouterInput({ agentId: "sub" });
    await expect(ChannelRouter.route(input)).rejects.toThrow("subagent");
  });
});

// ---------------------------------------------------------------------------
// resolveModelForAgent()
// ---------------------------------------------------------------------------

describe("resolveModelForAgent()", () => {
  it("uses named keys when crypto is available and agent has named_key_id", () => {
    vi.mocked(isCryptoAvailable).mockReturnValue(true);

    const db = makeFakeDb();
    // Agent row with named_key_id
    const prepareGet = vi.fn();
    prepareGet
      .mockReturnValueOnce({
        get: vi.fn(() => ({ named_key_id: 42 })),
      })
      .mockReturnValueOnce({
        get: vi.fn(() => ({
          provider_id: "openai",
          default_model: "gpt-4o",
          base_url: null,
        })),
      })
      .mockReturnValueOnce({
        get: vi.fn(() => ({ id: 1 })),
      });

    (db as unknown as { prepare: typeof prepareGet }).prepare = prepareGet;

    const agentConfig = {
      id: "main",
      name: "Main",
      model: "openai/gpt-4o",
      systemPrompt: "",
      maxSteps: 5,
      allowSubAgents: true,
      toolProfile: "executor" as const,
      isDefault: true,
      permissions: [],
      inheritWorkspace: true,
      persistence: "ephemeral" as const,
    };

    const config = makeConfig();
    resolveModelForAgent(db, INSTANCE_SLUG, agentConfig, config);

    // resolveModel should have been called with the provider from the named key
    expect(resolveModel).toHaveBeenCalledWith(
      "openai",
      "gpt-4o",
      expect.objectContaining({ apiKey: "sk-test-key" }),
    );
  });

  it("falls back to env-based resolution when crypto is unavailable", () => {
    vi.mocked(isCryptoAvailable).mockReturnValue(false);

    const db = makeFakeDb();
    const agentConfig = {
      id: "main",
      name: "Main",
      model: "anthropic/claude-sonnet-4-5",
      systemPrompt: "",
      maxSteps: 5,
      allowSubAgents: true,
      toolProfile: "executor" as const,
      isDefault: true,
      permissions: [],
      inheritWorkspace: true,
      persistence: "ephemeral" as const,
    };

    const config = makeConfig();
    resolveModelForAgent(db, INSTANCE_SLUG, agentConfig, config);

    // resolveModel should have been called with provider and model extracted from the string
    expect(resolveModel).toHaveBeenCalledWith("anthropic", "claude-sonnet-4-5");
  });
});
