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
  anthropicApiKey: "sk-ant-test123",
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
    expect(config.models.providers.anthropic.apiKey).toBe(
      "${ANTHROPIC_API_KEY}",
    );
  });

  it("includes multi-agent setup with agentToAgent", () => {
    const answers: WizardAnswers = {
      ...baseAnswers,
      agents: [
        { id: "main", name: "Main", isDefault: true },
        { id: "pm", name: "Project Manager" },
      ],
    };
    const config = JSON.parse(generateConfig(answers));
    expect(config.tools.agentToAgent.enabled).toBe(true);
    expect(config.tools.agentToAgent.agents.main.enabled).toBe(true);
    expect(config.tools.agentToAgent.agents.pm.enabled).toBe(true);
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

  it("includes slug in meta", () => {
    const config = JSON.parse(generateConfig(baseAnswers));
    expect(config.meta.slug).toBe("demo1");
  });
});

describe("generateEnv", () => {
  it("includes all required vars", () => {
    const env = generateEnv({
      anthropicApiKey: "sk-ant-test",
      gatewayToken: "abcdef123456",
      telegramBotToken: "123:abc",
    });
    expect(env).toContain("ANTHROPIC_API_KEY=sk-ant-test");
    expect(env).toContain("OPENCLAW_GW_AUTH_TOKEN=abcdef123456");
    expect(env).toContain("TELEGRAM_BOT_TOKEN=123:abc");
  });

  it("omits telegram token when not provided", () => {
    const env = generateEnv({
      anthropicApiKey: "sk-ant-test",
      gatewayToken: "token",
    });
    expect(env).not.toContain("TELEGRAM_BOT_TOKEN");
  });
});
