// src/runtime/__tests__/named-key-resolution.test.ts
//
// Tests for resolveModelForAgent — named API key resolution in the router.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import { NamedKeyRepository } from "../../core/repositories/named-key-repository.js";
import type Database from "better-sqlite3";
import type { InstanceSlug } from "../types.js";
import type { RuntimeConfig } from "../config/index.js";

// Mock resolveModel to capture calls instead of creating real LanguageModels
const mockResolveModel = vi.fn().mockReturnValue({
  languageModel: {},
  providerId: "mock",
  modelId: "mock-model",
  costPerMillion: undefined,
});

vi.mock("../provider/provider.js", () => ({
  resolveModel: (...args: unknown[]) => mockResolveModel(...args),
}));

// Mock isCryptoAvailable — default to true
const mockIsCryptoAvailable = vi.fn().mockReturnValue(true);
vi.mock("../../lib/crypto.js", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    isCryptoAvailable: () => mockIsCryptoAvailable(),
  };
});

// Import the function under test AFTER mocks are set up
const { resolveModelForAgent } = await import("../channel/router.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: Database.Database;
let instanceId: number;

function seedServerAndInstance(slug: string): number {
  db.prepare(
    "INSERT OR IGNORE INTO servers (id, hostname, openclaw_home) VALUES (1, 'test', '/opt/test')",
  ).run();
  const result = db
    .prepare(
      "INSERT INTO instances (server_id, slug, port, config_path, state_dir, systemd_unit) VALUES (1, ?, 18789, '/tmp/rt.json', '/tmp/state', 'claw-test.service')",
    )
    .run(slug);
  return result.lastInsertRowid as number;
}

function seedAgent(instId: number, agentId: string, namedKeyId: number | null): void {
  db.prepare(
    `INSERT INTO agents (instance_id, agent_id, name, workspace_path, config_json, named_key_id)
     VALUES (?, ?, ?, '/tmp/ws', '{}', ?)`,
  ).run(instId, agentId, agentId, namedKeyId);
}

function makeConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    defaultModel: "openai/gpt-4o",
    agents: [],
    ...overrides,
  } as RuntimeConfig;
}

function makeAgentConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: "test-agent",
    name: "test-agent",
    model: "anthropic/claude-sonnet-4-20250514",
    systemPrompt: "You are a test agent",
    maxSteps: 10,
    allowSubAgents: false,
    toolProfile: "executor" as const,
    isDefault: false,
    permissions: [],
    inheritWorkspace: false,
    persistence: "ephemeral" as const,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-named-key-res-"));
  const dbPath = path.join(tmpDir, "test.db");
  process.env.MASTER_ENCRYPTION_KEY = "a".repeat(64);
  db = initDatabase(dbPath);
  instanceId = seedServerAndInstance("test-inst");
  mockResolveModel.mockClear();
  mockIsCryptoAvailable.mockReturnValue(true);
});

afterEach(() => {
  db.close();
  delete process.env.MASTER_ENCRYPTION_KEY;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveModelForAgent", () => {
  it("falls back to legacy resolveModelFromString when no named keys exist", () => {
    seedAgent(instanceId, "test-agent", null);

    const agentConfig = makeAgentConfig();
    const config = makeConfig();

    resolveModelForAgent(db, "test-inst" as InstanceSlug, agentConfig, config);

    // Should call resolveModel with parsed provider/model from agentConfig.model
    expect(mockResolveModel).toHaveBeenCalledTimes(1);
    expect(mockResolveModel).toHaveBeenCalledWith("anthropic", "claude-sonnet-4-20250514");
  });

  it("uses agent-level named key when set", () => {
    const repo = new NamedKeyRepository(db);
    const key = repo.create({
      name: "Agent Key",
      providerId: "anthropic",
      apiKey: "sk-ant-agent-key-123",
      defaultModel: "claude-sonnet-4-20250514",
    });

    seedAgent(instanceId, "test-agent", key.id);

    const agentConfig = makeAgentConfig({ model: "anthropic/claude-sonnet-4-20250514" });
    const config = makeConfig();

    resolveModelForAgent(db, "test-inst" as InstanceSlug, agentConfig, config);

    expect(mockResolveModel).toHaveBeenCalledTimes(1);
    expect(mockResolveModel).toHaveBeenCalledWith("anthropic", "claude-sonnet-4-20250514", {
      apiKey: "sk-ant-agent-key-123",
    });
  });

  it("uses agent-level named key with baseUrl when present", () => {
    const repo = new NamedKeyRepository(db);
    const key = repo.create({
      name: "Custom Key",
      providerId: "openai-compatible",
      apiKey: "sk-custom-123",
      defaultModel: "llama-3",
      baseUrl: "https://custom.api.example.com/v1",
    });

    seedAgent(instanceId, "test-agent", key.id);

    const agentConfig = makeAgentConfig({ model: "openai-compatible/llama-3" });
    const config = makeConfig();

    resolveModelForAgent(db, "test-inst" as InstanceSlug, agentConfig, config);

    expect(mockResolveModel).toHaveBeenCalledTimes(1);
    expect(mockResolveModel).toHaveBeenCalledWith("openai-compatible", "llama-3", {
      apiKey: "sk-custom-123",
      baseUrl: "https://custom.api.example.com/v1",
    });
  });

  it("extracts model part when agent model is in provider/model format", () => {
    const repo = new NamedKeyRepository(db);
    const key = repo.create({
      name: "Key",
      providerId: "openai",
      apiKey: "sk-openai-123",
      defaultModel: "gpt-4o",
    });

    seedAgent(instanceId, "test-agent", key.id);

    // Agent model is "openai/gpt-4o-mini" — should extract "gpt-4o-mini"
    const agentConfig = makeAgentConfig({ model: "openai/gpt-4o-mini" });
    const config = makeConfig();

    resolveModelForAgent(db, "test-inst" as InstanceSlug, agentConfig, config);

    expect(mockResolveModel).toHaveBeenCalledWith("openai", "gpt-4o-mini", {
      apiKey: "sk-openai-123",
    });
  });

  it("uses key defaultModel when agent has no model set", () => {
    const repo = new NamedKeyRepository(db);
    const key = repo.create({
      name: "Key",
      providerId: "anthropic",
      apiKey: "sk-ant-default-123",
      defaultModel: "claude-sonnet-4-20250514",
    });

    seedAgent(instanceId, "test-agent", key.id);

    // Agent has no model — should use key's defaultModel
    const agentConfig = makeAgentConfig({ model: undefined });
    const config = makeConfig();

    resolveModelForAgent(db, "test-inst" as InstanceSlug, agentConfig, config);

    expect(mockResolveModel).toHaveBeenCalledWith("anthropic", "claude-sonnet-4-20250514", {
      apiKey: "sk-ant-default-123",
    });
  });

  it("falls back to instance default named key when agent has no key", () => {
    const repo = new NamedKeyRepository(db);
    const key = repo.create({
      name: "Instance Default Key",
      providerId: "anthropic",
      apiKey: "sk-ant-instance-default",
      defaultModel: "claude-sonnet-4-20250514",
    });

    // Assign key to instance as default
    repo.assignToInstance(instanceId, key.id, true);

    // Agent has no named_key_id
    seedAgent(instanceId, "test-agent", null);

    const agentConfig = makeAgentConfig({ model: "anthropic/claude-sonnet-4-20250514" });
    const config = makeConfig();

    resolveModelForAgent(db, "test-inst" as InstanceSlug, agentConfig, config);

    expect(mockResolveModel).toHaveBeenCalledTimes(1);
    expect(mockResolveModel).toHaveBeenCalledWith("anthropic", "claude-sonnet-4-20250514", {
      apiKey: "sk-ant-instance-default",
    });
  });

  it("agent-level key takes priority over instance default", () => {
    const repo = new NamedKeyRepository(db);

    const instanceKey = repo.create({
      name: "Instance Key",
      providerId: "anthropic",
      apiKey: "sk-ant-instance-key",
      defaultModel: "claude-sonnet-4-20250514",
    });
    repo.assignToInstance(instanceId, instanceKey.id, true);

    const agentKey = repo.create({
      name: "Agent Key",
      providerId: "openai",
      apiKey: "sk-openai-agent-key",
      defaultModel: "gpt-4o",
    });
    seedAgent(instanceId, "test-agent", agentKey.id);

    const agentConfig = makeAgentConfig({ model: "openai/gpt-4o" });
    const config = makeConfig();

    resolveModelForAgent(db, "test-inst" as InstanceSlug, agentConfig, config);

    // Should use agent key, not instance default
    expect(mockResolveModel).toHaveBeenCalledTimes(1);
    expect(mockResolveModel).toHaveBeenCalledWith("openai", "gpt-4o", {
      apiKey: "sk-openai-agent-key",
    });
  });

  it("falls back to legacy when crypto is not available", () => {
    mockIsCryptoAvailable.mockReturnValue(false);

    const repo = new NamedKeyRepository(db);
    const key = repo.create({
      name: "Key",
      providerId: "anthropic",
      apiKey: "sk-ant-123",
      defaultModel: "claude-sonnet-4-20250514",
    });
    seedAgent(instanceId, "test-agent", key.id);

    const agentConfig = makeAgentConfig({ model: "anthropic/claude-sonnet-4-20250514" });
    const config = makeConfig();

    resolveModelForAgent(db, "test-inst" as InstanceSlug, agentConfig, config);

    // Should fall back to legacy — resolveModel called without apiKey
    expect(mockResolveModel).toHaveBeenCalledTimes(1);
    expect(mockResolveModel).toHaveBeenCalledWith("anthropic", "claude-sonnet-4-20250514");
  });

  it("falls back to legacy when agent row not found in DB", () => {
    // Don't seed agent — it doesn't exist in DB
    const agentConfig = makeAgentConfig({ model: "openai/gpt-4o" });
    const config = makeConfig();

    resolveModelForAgent(db, "test-inst" as InstanceSlug, agentConfig, config);

    expect(mockResolveModel).toHaveBeenCalledTimes(1);
    expect(mockResolveModel).toHaveBeenCalledWith("openai", "gpt-4o");
  });

  it("falls back to legacy when instance not found in DB", () => {
    seedAgent(instanceId, "test-agent", null);

    const agentConfig = makeAgentConfig({ model: "openai/gpt-4o" });
    const config = makeConfig();

    // Use a non-existent instance slug
    resolveModelForAgent(db, "nonexistent" as InstanceSlug, agentConfig, config);

    expect(mockResolveModel).toHaveBeenCalledTimes(1);
    expect(mockResolveModel).toHaveBeenCalledWith("openai", "gpt-4o");
  });

  it("uses config.defaultModel when agent has no model (legacy path)", () => {
    seedAgent(instanceId, "test-agent", null);

    const agentConfig = makeAgentConfig({ model: undefined });
    const config = makeConfig({ defaultModel: "openai/gpt-4o-mini" });

    // No named keys, no agent model — should use config.defaultModel
    resolveModelForAgent(db, "test-inst" as InstanceSlug, agentConfig, config);

    expect(mockResolveModel).toHaveBeenCalledTimes(1);
    expect(mockResolveModel).toHaveBeenCalledWith("openai", "gpt-4o-mini");
  });

  it("supports model aliases in legacy fallback", () => {
    seedAgent(instanceId, "test-agent", null);

    const agentConfig = makeAgentConfig({ model: "fast" });
    const config = makeConfig({
      models: [{ id: "fast", provider: "openai", model: "gpt-4o-mini" }],
    });

    resolveModelForAgent(db, "test-inst" as InstanceSlug, agentConfig, config);

    // Alias resolves to openai/gpt-4o-mini
    expect(mockResolveModel).toHaveBeenCalledTimes(1);
    expect(mockResolveModel).toHaveBeenCalledWith("openai", "gpt-4o-mini");
  });
});
