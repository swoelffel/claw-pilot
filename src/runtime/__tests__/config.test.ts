import { describe, it, expect } from "vitest";
import {
  parseRuntimeConfig,
  safeParseRuntimeConfig,
  createDefaultRuntimeConfig,
  RuntimeConfigSchema,
} from "../config/index.js";

describe("RuntimeConfigSchema", () => {
  it("parses a minimal valid config", () => {
    const config = parseRuntimeConfig({ version: 1 });
    expect(config.version).toBe(1);
    expect(config.defaultModel).toBe("anthropic/claude-sonnet-4-5");
    expect(config.agents).toHaveLength(0);
    expect(config.providers).toHaveLength(0);
  });

  it("applies defaults for missing optional fields", () => {
    const config = parseRuntimeConfig({ version: 1 });
    expect(config.telegram.enabled).toBe(false);
    expect(config.webChat.enabled).toBe(true);
    expect(config.compaction.auto).toBe(true);
    expect(config.compaction.threshold).toBe(0.85);
    expect(config.mcpEnabled).toBe(false);
  });

  it("validates agent model format", () => {
    const result = safeParseRuntimeConfig({
      version: 1,
      agents: [
        {
          id: "main",
          name: "Main",
          model: "invalid-format", // missing provider/
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid agent model format", () => {
    const result = safeParseRuntimeConfig({
      version: 1,
      agents: [
        {
          id: "main",
          name: "Main",
          model: "anthropic/claude-sonnet-4-5",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid permission action", () => {
    const result = safeParseRuntimeConfig({
      version: 1,
      globalPermissions: [
        { permission: "read", pattern: "**", action: "maybe" }, // invalid
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects compaction threshold out of range", () => {
    const result = safeParseRuntimeConfig({
      version: 1,
      compaction: { threshold: 1.5 }, // > 0.99
    });
    expect(result.success).toBe(false);
  });
});

describe("createDefaultRuntimeConfig", () => {
  it("creates a valid config with one default agent", () => {
    const config = createDefaultRuntimeConfig({});
    expect(config.version).toBe(1);
    expect(config.agents).toHaveLength(1);
    expect(config.agents[0]!.id).toBe("main");
    expect(config.agents[0]!.isDefault).toBe(true);
    expect(config.agents[0]!.toolProfile).toBe("coding");
  });

  it("uses provided defaultModel", () => {
    const config = createDefaultRuntimeConfig({
      defaultModel: "openai/gpt-4o",
    });
    expect(config.defaultModel).toBe("openai/gpt-4o");
    expect(config.agents[0]!.model).toBe("openai/gpt-4o");
  });

  it("enables telegram when requested", () => {
    const config = createDefaultRuntimeConfig({ telegramEnabled: true });
    expect(config.telegram.enabled).toBe(true);
  });

  it("produces a config that passes schema validation", () => {
    const config = createDefaultRuntimeConfig({});
    const result = safeParseRuntimeConfig(config);
    expect(result.success).toBe(true);
  });
});
