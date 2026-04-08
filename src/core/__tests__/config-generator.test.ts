// src/core/__tests__/config-generator.test.ts
import { describe, it, expect } from "vitest";
import { generateEnv } from "../config-generator.js";

describe("generateEnv", () => {
  it("includes gateway token", () => {
    const env = generateEnv({
      gatewayToken: "abcdef123456",
    });
    expect(env).toContain("OPENCLAW_GW_AUTH_TOKEN=abcdef123456");
  });

  it("includes telegram bot token when provided", () => {
    const env = generateEnv({
      gatewayToken: "abcdef123456",
      telegramBotToken: "123:abc",
    });
    expect(env).toContain("OPENCLAW_GW_AUTH_TOKEN=abcdef123456");
    expect(env).toContain("TELEGRAM_BOT_TOKEN=123:abc");
  });

  it("omits telegram token when not provided", () => {
    const env = generateEnv({
      gatewayToken: "token",
    });
    expect(env).not.toContain("TELEGRAM_BOT_TOKEN");
  });

  it("does not include any API key lines", () => {
    const env = generateEnv({ gatewayToken: "token" });
    expect(env).not.toContain("API_KEY");
  });
});
