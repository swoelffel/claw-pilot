// src/core/__tests__/config-generator.test.ts
import { describe, it, expect } from "vitest";
import { generateEnv } from "../config-generator.js";

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
    const env = generateEnv({
      provider: "anthropic",
      apiKey: "sk-ant-test",
      gatewayToken: "token",
    });
    expect(env).not.toContain("TELEGRAM_BOT_TOKEN");
  });

  it("writes correct env var for openai", () => {
    const env = generateEnv({ provider: "openai", apiKey: "sk-openai-x", gatewayToken: "token" });
    expect(env).toContain("OPENAI_API_KEY=sk-openai-x");
    expect(env).not.toContain("ANTHROPIC_API_KEY");
  });

  it("writes GEMINI_API_KEY for google provider (not GOOGLE_API_KEY)", () => {
    const env = generateEnv({ provider: "google", apiKey: "AIza-test", gatewayToken: "token" });
    expect(env).toContain("GEMINI_API_KEY=AIza-test");
    expect(env).not.toContain("GOOGLE_API_KEY");
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

  it("matches full .env snapshot for anthropic", () => {
    const env = generateEnv({
      provider: "anthropic",
      apiKey: "sk-ant-test123",
      gatewayToken: "abcdef123456",
    });
    expect(env).toMatchSnapshot();
  });
});
