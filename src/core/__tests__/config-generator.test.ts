// src/core/__tests__/config-generator.test.ts
import { describe, it, expect } from "vitest";
import { generateConfig, generateEnv } from "../config-generator.js";
import type { WizardAnswers } from "../config-generator.js";

const baseAnswers: WizardAnswers = {
  slug: "demo1",
  displayName: "Demo One",
  port: 18789,
  agents: [{ id: "main", name: "Main", isDefault: true }],
  defaultModel: "anthropic/claude-sonnet-4-6",
  provider: "anthropic",
  apiKey: "sk-ant-test123",
  telegram: { enabled: false },
  nginx: { enabled: false },
  mem0: { enabled: false },
};

describe("generateConfig", () => {
  it("produces valid JSON", () => {
    const json = generateConfig(baseAnswers);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("includes gateway port", () => {
    const config = JSON.parse(generateConfig(baseAnswers));
    expect(config.gateway.port).toBe(18789);
  });

  it("uses variable reference for API key (not literal)", () => {
    const config = JSON.parse(generateConfig(baseAnswers));
    expect(config.models.providers.anthropic.apiKey).toBe("${ANTHROPIC_API_KEY}");
  });

  it("includes baseUrl and models array for anthropic (v2026.2.14)", () => {
    const config = JSON.parse(generateConfig(baseAnswers));
    expect(config.models.providers.anthropic.baseUrl).toBe("https://api.anthropic.com");
    expect(Array.isArray(config.models.providers.anthropic.models)).toBe(true);
  });

  it("uses correct provider block for openai", () => {
    const answers: WizardAnswers = { ...baseAnswers, provider: "openai", apiKey: "sk-openai-test" };
    const config = JSON.parse(generateConfig(answers));
    expect(config.models.providers.openai.apiKey).toBe("${OPENAI_API_KEY}");
    expect(config.models.providers.openai.baseUrl).toBe("https://api.openai.com/v1");
    expect(config.models.providers.anthropic).toBeUndefined();
  });

  it("uses correct provider block for google (not gemini)", () => {
    const answers: WizardAnswers = { ...baseAnswers, provider: "google", apiKey: "AIza-test" };
    const config = JSON.parse(generateConfig(answers));
    expect(config.models.providers.google.apiKey).toBe("${GOOGLE_API_KEY}");
    expect(config.models.providers.google.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta");
    expect(config.models.providers.gemini).toBeUndefined();
  });

  it("uses correct provider block for xai", () => {
    const answers: WizardAnswers = { ...baseAnswers, provider: "xai", apiKey: "xai-test" };
    const config = JSON.parse(generateConfig(answers));
    expect(config.models.providers.xai.apiKey).toBe("${XAI_API_KEY}");
    expect(config.models.providers.xai.baseUrl).toBe("https://api.x.ai/v1");
  });

  it("uses opencode auth.profiles when provider is opencode (no models.providers)", () => {
    const answers: WizardAnswers = { ...baseAnswers, provider: "opencode", apiKey: "" };
    const config = JSON.parse(generateConfig(answers));
    expect(config.auth.profiles["opencode:default"].provider).toBe("opencode");
    expect(config.models).toBeUndefined();
  });

  it("uses model as object { primary } (v2026.2.14)", () => {
    const config = JSON.parse(generateConfig(baseAnswers));
    expect(config.agents.defaults.model).toEqual({ primary: "anthropic/claude-sonnet-4-6" });
  });

  it("does NOT include cache or heartbeat in agents.defaults", () => {
    const config = JSON.parse(generateConfig(baseAnswers));
    expect(config.agents.defaults.cache).toBeUndefined();
    expect(config.agents.defaults.heartbeat).toBeUndefined();
  });

  it("includes multi-agent setup with agentToAgent allow array (v2026.2.14)", () => {
    const answers: WizardAnswers = {
      ...baseAnswers,
      agents: [
        { id: "main", name: "Main", isDefault: true },
        { id: "pm", name: "Project Manager" },
      ],
    };
    const config = JSON.parse(generateConfig(answers));
    expect(config.tools.agentToAgent.enabled).toBe(true);
    expect(config.tools.agentToAgent.allow).toContain("main");
    expect(config.tools.agentToAgent.allow).toContain("pm");
    expect(config.tools.agentToAgent.agents).toBeUndefined();
  });

  it("uses bindings with match.channel + match.accountId (v2026.2.14)", () => {
    const answers: WizardAnswers = {
      ...baseAnswers,
      agents: [
        { id: "main", name: "Main", isDefault: true },
        { id: "agent1", name: "Agent One" },
      ],
    };
    const config = JSON.parse(generateConfig(answers));
    expect(config.bindings).toHaveLength(1);
    expect(config.bindings[0].agentId).toBe("agent1");
    expect(config.bindings[0].match.channel).toBe("webchat");
    expect(config.bindings[0].match.accountId).toBe("agent1");
    expect(config.bindings[0].type).toBeUndefined();
    expect(config.bindings[0].path).toBeUndefined();
  });

  it("uses gateway.bind=loopback and auth.mode=token (v2026.2.14)", () => {
    const config = JSON.parse(generateConfig(baseAnswers));
    expect(config.gateway.bind).toBe("loopback");
    expect(config.gateway.mode).toBe("local");
    expect(config.gateway.auth.mode).toBe("token");
    expect(config.gateway.auth.type).toBeUndefined();
    expect(config.gateway.host).toBeUndefined();
  });

  it("includes telegram config when enabled", () => {
    const answers: WizardAnswers = {
      ...baseAnswers,
      telegram: { enabled: true, botToken: "123:abc" },
    };
    const config = JSON.parse(generateConfig(answers));
    expect(config.channels.telegram.enabled).toBe(true);
    expect(config.channels.telegram.botToken).toBe("${TELEGRAM_BOT_TOKEN}");
  });

  it("includes mem0 plugin when enabled", () => {
    const answers: WizardAnswers = {
      ...baseAnswers,
      mem0: { enabled: true, ollamaUrl: "http://127.0.0.1:11434" },
    };
    const config = JSON.parse(generateConfig(answers));
    expect(config.plugins["@mem0/openclaw-mem0"].enabled).toBe(true);
  });

  it("does NOT include telegram when disabled", () => {
    const config = JSON.parse(generateConfig(baseAnswers));
    expect(config.channels).toBeUndefined();
  });

  it("does NOT include slug in meta (v2026.2.24)", () => {
    const config = JSON.parse(generateConfig(baseAnswers));
    expect(config.meta.slug).toBeUndefined();
    expect(config.meta.lastTouchedVersion).toBe("2026.2.24");
  });
});

describe("generateEnv", () => {
  it("includes all required vars", () => {
    const env = generateEnv({
      provider: "anthropic",
      apiKey: "sk-ant-test",
      gatewayToken: "abcdef123456",
      telegramBotToken: "123:abc",
    });
    expect(env).toContain("ANTHROPIC_API_KEY=sk-ant-test");
    expect(env).toContain("OPENCLAW_GW_AUTH_TOKEN=abcdef123456");
    expect(env).toContain("TELEGRAM_BOT_TOKEN=123:abc");
  });

  it("omits telegram token when not provided", () => {
    const env = generateEnv({ provider: "anthropic", apiKey: "sk-ant-test", gatewayToken: "token" });
    expect(env).not.toContain("TELEGRAM_BOT_TOKEN");
  });

  it("writes correct env var for openai", () => {
    const env = generateEnv({ provider: "openai", apiKey: "sk-openai-x", gatewayToken: "token" });
    expect(env).toContain("OPENAI_API_KEY=sk-openai-x");
    expect(env).not.toContain("ANTHROPIC_API_KEY");
  });

  it("writes GOOGLE_API_KEY for google provider (not GEMINI_API_KEY)", () => {
    const env = generateEnv({ provider: "google", apiKey: "AIza-test", gatewayToken: "token" });
    expect(env).toContain("GOOGLE_API_KEY=AIza-test");
    expect(env).not.toContain("GEMINI_API_KEY");
  });

  it("writes XAI_API_KEY for xai provider", () => {
    const env = generateEnv({ provider: "xai", apiKey: "xai-test", gatewayToken: "token" });
    expect(env).toContain("XAI_API_KEY=xai-test");
  });

  it("omits API key line for opencode", () => {
    const env = generateEnv({ provider: "opencode", apiKey: "", gatewayToken: "token" });
    expect(env).not.toContain("ANTHROPIC_API_KEY");
    expect(env).not.toContain("OPENAI_API_KEY");
    expect(env).toContain("OPENCLAW_GW_AUTH_TOKEN=token");
  });
});
