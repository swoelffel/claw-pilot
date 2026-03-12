// src/core/__tests__/migrator.test.ts
import { describe, it, expect } from "vitest";
import { buildRuntimeConfig } from "../migrator.js";
import type { OpenClawConfig } from "../openclaw-config.schema.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const minimalConfig: OpenClawConfig = {
  gateway: { port: 18789 },
};

const fullConfig: OpenClawConfig = {
  gateway: { port: 18789 },
  agents: {
    defaults: {
      model: "anthropic/claude-sonnet-4-5",
    },
    list: [
      { id: "main", name: "Main Agent" },
      { id: "coder", name: "Coder", model: "anthropic/claude-opus-4-5" },
    ],
  },
  models: {
    providers: {
      anthropic: { apiKey: "sk-ant-test123", baseUrl: undefined },
      openai: { apiKey: "sk-openai-test456" },
    },
  },
  channels: {
    telegram: {
      enabled: true,
      botToken: "bot123:TOKEN",
      dmPolicy: "allow",
      groupPolicy: "deny",
    },
  },
  plugins: { mem0: { enabled: true } },
  auth: { profiles: { default: { provider: "anthropic", mode: "api-key" } } },
  tools: { profile: "coding" },
};

const objectModelConfig: OpenClawConfig = {
  gateway: { port: 18789 },
  agents: {
    defaults: {
      model: { primary: "anthropic/claude-sonnet-4-5" },
    },
    list: [{ id: "main", name: "Main", model: { primary: "openai/gpt-4o" } }],
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildRuntimeConfig — minimal config", () => {
  it("returns a valid RuntimeConfig with defaults", () => {
    const { config, report } = buildRuntimeConfig(minimalConfig);
    expect(config.version).toBe(1);
    expect(config.defaultModel).toBe("anthropic/claude-sonnet-4-5");
    expect(config.agents).toHaveLength(0);
    expect(config.providers).toHaveLength(0);
    expect(config.telegram.enabled).toBe(false);
    expect(report.agentCount).toBe(0);
    expect(report.providerCount).toBe(0);
    expect(report.warnings).toHaveLength(0);
    expect(report.envEntries).toHaveLength(0);
  });
});

describe("buildRuntimeConfig — full config", () => {
  it("extracts default model from agents.defaults", () => {
    const { config } = buildRuntimeConfig(fullConfig);
    expect(config.defaultModel).toBe("anthropic/claude-sonnet-4-5");
  });

  it("converts agents list", () => {
    const { config, report } = buildRuntimeConfig(fullConfig);
    expect(config.agents).toHaveLength(2);
    expect(report.agentCount).toBe(2);

    const main = config.agents.find((a) => a.id === "main");
    expect(main).toBeDefined();
    expect(main!.name).toBe("Main Agent");
    expect(main!.model).toBe("anthropic/claude-sonnet-4-5"); // falls back to default

    const coder = config.agents.find((a) => a.id === "coder");
    expect(coder).toBeDefined();
    expect(coder!.model).toBe("anthropic/claude-opus-4-5");
  });

  it("marks first agent as default when none is set", () => {
    const { config } = buildRuntimeConfig(fullConfig);
    expect(config.agents[0]!.isDefault).toBe(true);
    expect(config.agents[1]!.isDefault).toBe(false);
  });

  it("converts providers and generates env entries", () => {
    const { config, report } = buildRuntimeConfig(fullConfig);
    expect(config.providers).toHaveLength(2);
    expect(report.providerCount).toBe(2);

    const anthropic = config.providers.find((p) => p.id === "anthropic");
    expect(anthropic).toBeDefined();
    expect(anthropic!.authProfiles).toHaveLength(1);
    expect(anthropic!.authProfiles[0]!.apiKeyEnvVar).toBe("ANTHROPIC_API_KEY");

    const envKeys = report.envEntries.map((e) => e.key);
    expect(envKeys).toContain("ANTHROPIC_API_KEY");
    expect(envKeys).toContain("OPENAI_API_KEY");

    const anthropicEnv = report.envEntries.find((e) => e.key === "ANTHROPIC_API_KEY");
    expect(anthropicEnv!.value).toBe("sk-ant-test123");
  });

  it("converts telegram config and generates env entry", () => {
    const { config, report } = buildRuntimeConfig(fullConfig);
    expect(config.telegram.enabled).toBe(true);
    expect(config.telegram.botTokenEnvVar).toBe("TELEGRAM_BOT_TOKEN");

    const tgEnv = report.envEntries.find((e) => e.key === "TELEGRAM_BOT_TOKEN");
    expect(tgEnv).toBeDefined();
    expect(tgEnv!.value).toBe("bot123:TOKEN");
  });

  it("warns about unmappable telegram fields", () => {
    const { report } = buildRuntimeConfig(fullConfig);
    const tgWarnings = report.warnings.filter((w) => w.field.startsWith("channels.telegram"));
    expect(tgWarnings.length).toBeGreaterThanOrEqual(2);
    const fields = tgWarnings.map((w) => w.field);
    expect(fields).toContain("channels.telegram.dmPolicy");
    expect(fields).toContain("channels.telegram.groupPolicy");
  });

  it("warns about plugins", () => {
    const { report } = buildRuntimeConfig(fullConfig);
    const pluginWarning = report.warnings.find((w) => w.field === "plugins");
    expect(pluginWarning).toBeDefined();
  });

  it("warns about auth.profiles", () => {
    const { report } = buildRuntimeConfig(fullConfig);
    const authWarning = report.warnings.find((w) => w.field === "auth.profiles");
    expect(authWarning).toBeDefined();
  });

  it("warns about tools.profile", () => {
    const { report } = buildRuntimeConfig(fullConfig);
    const toolsWarning = report.warnings.find((w) => w.field === "tools.profile");
    expect(toolsWarning).toBeDefined();
  });
});

describe("buildRuntimeConfig — object model ref", () => {
  it("normalizes { primary: 'provider/model' } to string", () => {
    const { config } = buildRuntimeConfig(objectModelConfig);
    expect(config.defaultModel).toBe("anthropic/claude-sonnet-4-5");
    expect(config.agents[0]!.model).toBe("openai/gpt-4o");
  });
});

describe("buildRuntimeConfig — provider without apiKey", () => {
  it("creates provider with empty authProfiles when no apiKey", () => {
    const cfg: OpenClawConfig = {
      gateway: { port: 18789 },
      models: {
        providers: {
          ollama: { baseUrl: "http://localhost:11434" },
        },
      },
    };
    const { config, report } = buildRuntimeConfig(cfg);
    const ollama = config.providers.find((p) => p.id === "ollama");
    expect(ollama).toBeDefined();
    expect(ollama!.baseUrl).toBe("http://localhost:11434");
    expect(ollama!.authProfiles).toHaveLength(0);
    expect(report.envEntries).toHaveLength(0);
  });
});
