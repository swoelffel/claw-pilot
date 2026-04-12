// src/dashboard/routes/instances/__tests__/config-patch-handlers.test.ts
//
// Unit tests for the extracted config-patch-handlers functions.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  applyProviderChanges,
  applyAgentDefaultChanges,
  applyAgentPatches,
  applyTelegramChanges,
  applyProviderEnvWrites,
} from "../config-patch-handlers.js";

// ---------------------------------------------------------------------------
// Mock dotenv module (writeEnvVar / removeEnvVar)
// ---------------------------------------------------------------------------

vi.mock("../../../../lib/dotenv.js", () => ({
  writeEnvVar: vi.fn().mockResolvedValue(undefined),
  removeEnvVar: vi.fn().mockResolvedValue(undefined),
}));

import { writeEnvVar, removeEnvVar } from "../../../../lib/dotenv.js";

// ---------------------------------------------------------------------------
// Helpers — minimal RuntimeConfig-like objects
// ---------------------------------------------------------------------------

function makeConfig(overrides: Record<string, any> = {}): any {
  return {
    providers: [],
    compaction: { auto: true, threshold: 0.7, reservedTokens: 2048 },
    subagents: { maxSpawnDepth: 3, maxChildrenPerSession: 10, retentionHours: 48 },
    defaultInternalModel: undefined,
    defaultHeartbeatModel: undefined,
    models: [],
    agents: [],
    telegram: {
      enabled: false,
      botTokenEnvVar: "TELEGRAM_BOT_TOKEN",
      pollingIntervalMs: 1000,
      allowedUserIds: [],
      dmPolicy: "pairing",
      groupPolicy: "disabled",
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// applyProviderChanges
// ---------------------------------------------------------------------------

describe("applyProviderChanges", () => {
  it("adds a new provider with default authProfile", () => {
    const config = makeConfig();
    applyProviderChanges(config, { add: [{ id: "openai" }] });
    expect(config.providers).toHaveLength(1);
    expect(config.providers[0].id).toBe("openai");
    expect(config.providers[0].authProfiles[0].apiKeyEnvVar).toBe("OPENAI_API_KEY");
  });

  it("adds a provider with a custom baseUrl", () => {
    const config = makeConfig();
    applyProviderChanges(config, { add: [{ id: "openai", baseUrl: "https://custom.api.com" }] });
    expect(config.providers[0].baseUrl).toBe("https://custom.api.com");
  });

  it("skips duplicate add when provider already exists", () => {
    const config = makeConfig({
      providers: [{ id: "openai", authProfiles: [] }],
    });
    applyProviderChanges(config, { add: [{ id: "openai" }] });
    expect(config.providers).toHaveLength(1);
  });

  it("updates baseUrl on existing provider", () => {
    const config = makeConfig({
      providers: [{ id: "openai", baseUrl: "https://old.api.com", authProfiles: [] }],
    });
    applyProviderChanges(config, { update: [{ id: "openai", baseUrl: "https://new.api.com" }] });
    expect(config.providers[0].baseUrl).toBe("https://new.api.com");
  });

  it("removes baseUrl when set to null", () => {
    const config = makeConfig({
      providers: [{ id: "openai", baseUrl: "https://old.api.com", authProfiles: [] }],
    });
    applyProviderChanges(config, { update: [{ id: "openai", baseUrl: null }] });
    expect(config.providers[0].baseUrl).toBeUndefined();
  });

  it("removes a provider by id", () => {
    const config = makeConfig({
      providers: [
        { id: "openai", authProfiles: [] },
        { id: "anthropic", authProfiles: [] },
      ],
    });
    applyProviderChanges(config, { remove: ["openai"] });
    expect(config.providers).toHaveLength(1);
    expect(config.providers[0].id).toBe("anthropic");
  });

  it("uses fallback env var for unknown provider id", () => {
    const config = makeConfig();
    applyProviderChanges(config, { add: [{ id: "custom-llm" }] });
    expect(config.providers[0].authProfiles[0].apiKeyEnvVar).toBe("CUSTOM-LLM_API_KEY");
  });
});

// ---------------------------------------------------------------------------
// applyAgentDefaultChanges
// ---------------------------------------------------------------------------

describe("applyAgentDefaultChanges", () => {
  it("sets compaction threshold", () => {
    const config = makeConfig();
    applyAgentDefaultChanges(config, { compaction: { threshold: 0.85 } });
    expect(config.compaction.threshold).toBe(0.85);
  });

  it("sets compaction mode to manual (auto=false)", () => {
    const config = makeConfig();
    applyAgentDefaultChanges(config, { compaction: { mode: "manual" } });
    expect(config.compaction.auto).toBe(false);
  });

  it("sets compaction reservedTokens", () => {
    const config = makeConfig();
    applyAgentDefaultChanges(config, { compaction: { reservedTokens: 4096 } });
    expect(config.compaction.reservedTokens).toBe(4096);
  });

  it("sets subagents maxSpawnDepth", () => {
    const config = makeConfig();
    applyAgentDefaultChanges(config, { subagents: { maxSpawnDepth: 5 } });
    expect(config.subagents.maxSpawnDepth).toBe(5);
  });

  it("sets subagents maxChildrenPerSession", () => {
    const config = makeConfig();
    applyAgentDefaultChanges(config, { subagents: { maxChildrenPerSession: 20 } });
    expect(config.subagents.maxChildrenPerSession).toBe(20);
  });

  it("sets subagents retentionHours", () => {
    const config = makeConfig();
    applyAgentDefaultChanges(config, { subagents: { retentionHours: 72 } });
    expect(config.subagents.retentionHours).toBe(72);
  });

  it("sets models array", () => {
    const config = makeConfig();
    const models = [
      { id: "gpt-4", provider: "openai", model: "gpt-4" },
      { id: "claude-3", provider: "anthropic", model: "claude-3-opus" },
    ];
    applyAgentDefaultChanges(config, { models });
    expect(config.models).toEqual(models);
  });

  it("sets defaultInternalModel", () => {
    const config = makeConfig();
    applyAgentDefaultChanges(config, { defaultInternalModel: "gpt-4o-mini" });
    expect(config.defaultInternalModel).toBe("gpt-4o-mini");
  });

  it("clears defaultInternalModel when empty string", () => {
    const config = makeConfig({ defaultInternalModel: "gpt-4o-mini" });
    applyAgentDefaultChanges(config, { defaultInternalModel: "" });
    expect(config.defaultInternalModel).toBeUndefined();
  });

  it("sets defaultHeartbeatModel via heartbeat.model", () => {
    const config = makeConfig();
    applyAgentDefaultChanges(config, { heartbeat: { model: "gpt-4o-mini" } });
    expect(config.defaultHeartbeatModel).toBe("gpt-4o-mini");
  });
});

// ---------------------------------------------------------------------------
// applyAgentPatches
// ---------------------------------------------------------------------------

describe("applyAgentPatches", () => {
  const mockDbRun = vi.fn();
  const mockDb = { prepare: vi.fn(() => ({ run: mockDbRun })) } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates agent model", () => {
    const config = makeConfig({
      agents: [{ id: "agent-1", name: "Agent 1", model: "gpt-4", toolProfile: "sentinel" }],
    });
    applyAgentPatches(config, [{ id: "agent-1", model: "claude-3-opus" }], mockDb, "my-team");
    expect(config.agents[0].model).toBe("claude-3-opus");
  });

  it("updates agent toolProfile", () => {
    const config = makeConfig({
      agents: [{ id: "agent-1", name: "Agent 1", model: "gpt-4", toolProfile: "sentinel" }],
    });
    applyAgentPatches(config, [{ id: "agent-1", toolProfile: "pilot" }], mockDb, "my-team");
    expect(config.agents[0].toolProfile).toBe("pilot");
  });

  it("skips unknown agent id", () => {
    const config = makeConfig({
      agents: [{ id: "agent-1", name: "Agent 1", model: "gpt-4" }],
    });
    applyAgentPatches(config, [{ id: "ghost-agent", model: "gpt-5" }], mockDb, "my-team");
    // Original agent unchanged
    expect(config.agents[0].model).toBe("gpt-4");
    // DB not called
    expect(mockDb.prepare).not.toHaveBeenCalled();
  });

  it("updates agent name", () => {
    const config = makeConfig({
      agents: [{ id: "agent-1", name: "Old Name", model: "gpt-4" }],
    });
    applyAgentPatches(config, [{ id: "agent-1", name: "New Name" }], mockDb, "my-team");
    expect(config.agents[0].name).toBe("New Name");
  });

  it("updates namedKeyId via SQL", () => {
    const config = makeConfig({
      agents: [{ id: "agent-1", name: "Agent 1", model: "gpt-4" }],
    });
    applyAgentPatches(config, [{ id: "agent-1", namedKeyId: 42 }], mockDb, "my-team");
    expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining("UPDATE agents"));
    expect(mockDbRun).toHaveBeenCalledWith(42, "agent-1", "my-team");
  });

  it("updates thinking config", () => {
    const config = makeConfig({
      agents: [{ id: "agent-1", name: "A", model: "gpt-4", thinking: undefined }],
    });
    applyAgentPatches(
      config,
      [{ id: "agent-1", thinking: { enabled: true, budgetTokens: 5000 } }],
      mockDb,
      "my-team",
    );
    expect(config.agents[0].thinking).toEqual({ enabled: true, budgetTokens: 5000 });
  });

  it("clears thinking config when set to null", () => {
    const config = makeConfig({
      agents: [
        {
          id: "agent-1",
          name: "A",
          model: "gpt-4",
          thinking: { enabled: true, budgetTokens: 5000 },
        },
      ],
    });
    applyAgentPatches(config, [{ id: "agent-1", thinking: null }], mockDb, "my-team");
    expect(config.agents[0].thinking).toBeUndefined();
  });

  it("updates maxSteps and temperature", () => {
    const config = makeConfig({
      agents: [{ id: "agent-1", name: "A", model: "gpt-4", maxSteps: 10, temperature: 0.7 }],
    });
    applyAgentPatches(
      config,
      [{ id: "agent-1", maxSteps: 50, temperature: 0.2 }],
      mockDb,
      "my-team",
    );
    expect(config.agents[0].maxSteps).toBe(50);
    expect(config.agents[0].temperature).toBe(0.2);
  });
});

// ---------------------------------------------------------------------------
// applyTelegramChanges
// ---------------------------------------------------------------------------

describe("applyTelegramChanges", () => {
  it("updates enabled flag", () => {
    const config = makeConfig();
    applyTelegramChanges(config, { enabled: true });
    expect(config.telegram.enabled).toBe(true);
  });

  it("updates dmPolicy", () => {
    const config = makeConfig();
    applyTelegramChanges(config, { dmPolicy: "open" });
    expect(config.telegram.dmPolicy).toBe("open");
  });

  it("updates groupPolicy", () => {
    const config = makeConfig();
    applyTelegramChanges(config, { groupPolicy: "allowlist" });
    expect(config.telegram.groupPolicy).toBe("allowlist");
  });

  it("updates pollingIntervalMs", () => {
    const config = makeConfig();
    applyTelegramChanges(config, { pollingIntervalMs: 5000 });
    expect(config.telegram.pollingIntervalMs).toBe(5000);
  });

  it("updates allowedUserIds", () => {
    const config = makeConfig();
    applyTelegramChanges(config, { allowedUserIds: [123, 456] });
    expect(config.telegram.allowedUserIds).toEqual([123, 456]);
  });

  it("updates botTokenEnvVar", () => {
    const config = makeConfig();
    applyTelegramChanges(config, { botTokenEnvVar: "MY_BOT_TOKEN" });
    expect(config.telegram.botTokenEnvVar).toBe("MY_BOT_TOKEN");
  });
});

// ---------------------------------------------------------------------------
// applyProviderEnvWrites
// ---------------------------------------------------------------------------

describe("applyProviderEnvWrites", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls writeEnvVar for add with known provider", async () => {
    await applyProviderEnvWrites("/tmp/.env", {
      add: [{ id: "openai", apiKey: "sk-test-123" }],
    });
    expect(writeEnvVar).toHaveBeenCalledWith("/tmp/.env", "OPENAI_API_KEY", "sk-test-123");
  });

  it("calls writeEnvVar for add with unknown provider (fallback env var)", async () => {
    await applyProviderEnvWrites("/tmp/.env", {
      add: [{ id: "custom", apiKey: "key-abc" }],
    });
    expect(writeEnvVar).toHaveBeenCalledWith("/tmp/.env", "CUSTOM_API_KEY", "key-abc");
  });

  it("skips add when no apiKey provided", async () => {
    await applyProviderEnvWrites("/tmp/.env", {
      add: [{ id: "openai" }],
    });
    expect(writeEnvVar).not.toHaveBeenCalled();
  });

  it("calls writeEnvVar for update", async () => {
    await applyProviderEnvWrites("/tmp/.env", {
      update: [{ id: "anthropic", apiKey: "new-key" }],
    });
    expect(writeEnvVar).toHaveBeenCalledWith("/tmp/.env", "ANTHROPIC_API_KEY", "new-key");
  });

  it("calls removeEnvVar for remove", async () => {
    await applyProviderEnvWrites("/tmp/.env", { remove: ["openai"] });
    expect(removeEnvVar).toHaveBeenCalledWith("/tmp/.env", "OPENAI_API_KEY");
  });

  it("handles add, update, and remove in a single call", async () => {
    await applyProviderEnvWrites("/tmp/.env", {
      add: [{ id: "xai", apiKey: "xai-key" }],
      update: [{ id: "openai", apiKey: "new-openai" }],
      remove: ["anthropic"],
    });
    expect(writeEnvVar).toHaveBeenCalledTimes(2);
    expect(removeEnvVar).toHaveBeenCalledTimes(1);
    expect(writeEnvVar).toHaveBeenCalledWith("/tmp/.env", "XAI_API_KEY", "xai-key");
    expect(writeEnvVar).toHaveBeenCalledWith("/tmp/.env", "OPENAI_API_KEY", "new-openai");
    expect(removeEnvVar).toHaveBeenCalledWith("/tmp/.env", "ANTHROPIC_API_KEY");
  });
});
