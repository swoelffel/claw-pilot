import { describe, it, expect } from "vitest";
import {
  parseRuntimeConfig,
  safeParseRuntimeConfig,
  createDefaultRuntimeConfig,
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

  it("validates agent model format — rejects empty string", () => {
    // model accepts "provider/model" format OR named aliases (e.g. "fast")
    // Only an empty string is rejected (min(1) constraint)
    const result = safeParseRuntimeConfig({
      version: 1,
      agents: [
        {
          id: "main",
          name: "Main",
          model: "", // empty string is invalid
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("accepts agent model as named alias (no slash)", () => {
    const result = safeParseRuntimeConfig({
      version: 1,
      agents: [
        {
          id: "main",
          name: "Main",
          model: "fast", // named alias — resolved at runtime via config.models
        },
      ],
    });
    expect(result.success).toBe(true);
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

// ---------------------------------------------------------------------------
// AgentConfigSchema — promptMode and instructionUrls (v0.22.0)
// ---------------------------------------------------------------------------

describe("AgentConfigSchema — promptMode", () => {
  /**
   * Objective: promptMode="full" is a valid value.
   * Positive test: config with promptMode="full" must parse successfully.
   */
  it('[positive] promptMode="full" is accepted', () => {
    const result = safeParseRuntimeConfig({
      version: 1,
      agents: [{ id: "a", name: "A", model: "anthropic/claude-3", promptMode: "full" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents[0]!.promptMode).toBe("full");
    }
  });

  /**
   * Objective: promptMode="minimal" is a valid value.
   * Positive test: config with promptMode="minimal" must parse successfully.
   */
  it('[positive] promptMode="minimal" is accepted', () => {
    const result = safeParseRuntimeConfig({
      version: 1,
      agents: [{ id: "a", name: "A", model: "anthropic/claude-3", promptMode: "minimal" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents[0]!.promptMode).toBe("minimal");
    }
  });

  /**
   * Objective: promptMode is optional — omitting it must still produce a valid config.
   * Positive test: agent without promptMode parses and the field is undefined.
   */
  it("[positive] promptMode absent → field is undefined (optional)", () => {
    const result = safeParseRuntimeConfig({
      version: 1,
      agents: [{ id: "a", name: "A", model: "anthropic/claude-3" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents[0]!.promptMode).toBeUndefined();
    }
  });

  /**
   * Objective: an invalid promptMode value must be rejected.
   * Negative test: promptMode="turbo" is not in the enum → ZodError.
   */
  it('[negative] promptMode="turbo" is rejected (not in enum)', () => {
    const result = safeParseRuntimeConfig({
      version: 1,
      agents: [{ id: "a", name: "A", model: "anthropic/claude-3", promptMode: "turbo" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("AgentConfigSchema — instructionUrls", () => {
  /**
   * Objective: a valid URL array is accepted.
   * Positive test: instructionUrls with a proper HTTPS URL parses successfully.
   */
  it("[positive] instructionUrls with valid URL is accepted", () => {
    const result = safeParseRuntimeConfig({
      version: 1,
      agents: [
        {
          id: "a",
          name: "A",
          model: "anthropic/claude-3",
          instructionUrls: ["https://example.com/instructions.md"],
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents[0]!.instructionUrls).toEqual([
        "https://example.com/instructions.md",
      ]);
    }
  });

  /**
   * Objective: instructionUrls is optional — omitting it must still produce a valid config.
   * Positive test: agent without instructionUrls parses and the field is undefined.
   */
  it("[positive] instructionUrls absent → field is undefined (optional)", () => {
    const result = safeParseRuntimeConfig({
      version: 1,
      agents: [{ id: "a", name: "A", model: "anthropic/claude-3" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents[0]!.instructionUrls).toBeUndefined();
    }
  });

  /**
   * Objective: a non-URL string in instructionUrls must be rejected.
   * Negative test: "not-a-url" fails Zod's url() validator → ZodError.
   */
  it('[negative] instructionUrls with "not-a-url" is rejected', () => {
    const result = safeParseRuntimeConfig({
      version: 1,
      agents: [
        {
          id: "a",
          name: "A",
          model: "anthropic/claude-3",
          instructionUrls: ["not-a-url"],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  /**
   * Objective: an empty instructionUrls array is valid.
   * Positive test: empty array parses without error.
   */
  it("[positive] instructionUrls as empty array is accepted", () => {
    const result = safeParseRuntimeConfig({
      version: 1,
      agents: [
        {
          id: "a",
          name: "A",
          model: "anthropic/claude-3",
          instructionUrls: [],
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("AgentConfigSchema — heartbeat", () => {
  it("[positive] heartbeat absent → field is undefined (optional)", () => {
    const result = safeParseRuntimeConfig({
      version: 1,
      agents: [{ id: "a", name: "A", model: "anthropic/claude-3" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents[0]!.heartbeat).toBeUndefined();
    }
  });

  it('[positive] heartbeat with every="30m" is accepted', () => {
    const result = safeParseRuntimeConfig({
      version: 1,
      agents: [{ id: "a", name: "A", model: "anthropic/claude-3", heartbeat: { every: "30m" } }],
    });
    expect(result.success).toBe(true);
  });

  it("[positive] heartbeat with all optional fields is accepted", () => {
    const result = safeParseRuntimeConfig({
      version: 1,
      agents: [
        {
          id: "a",
          name: "A",
          model: "anthropic/claude-3",
          heartbeat: {
            every: "1h",
            prompt: "Check status",
            activeHours: { start: "09:00", end: "17:00", tz: "Europe/Paris" },
            model: "anthropic/claude-3",
            ackMaxChars: 200,
          },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("[negative] heartbeat with invalid every value is rejected", () => {
    const result = safeParseRuntimeConfig({
      version: 1,
      agents: [{ id: "a", name: "A", model: "anthropic/claude-3", heartbeat: { every: "2d" } }],
    });
    expect(result.success).toBe(false);
  });

  it("[negative] heartbeat with missing every field is rejected", () => {
    const result = safeParseRuntimeConfig({
      version: 1,
      agents: [{ id: "a", name: "A", model: "anthropic/claude-3", heartbeat: { prompt: "hello" } }],
    });
    expect(result.success).toBe(false);
  });

  it("[positive] heartbeat.activeHours without tz is accepted (tz is optional)", () => {
    const result = safeParseRuntimeConfig({
      version: 1,
      agents: [
        {
          id: "a",
          name: "A",
          model: "anthropic/claude-3",
          heartbeat: { every: "1h", activeHours: { start: "09:00", end: "17:00" } },
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents[0]?.heartbeat?.activeHours?.tz).toBeUndefined();
    }
  });
});

describe("AgentConfigSchema — timeoutMs", () => {
  it("[positive] timeoutMs absent → field is undefined (optional)", () => {
    const result = safeParseRuntimeConfig({
      version: 1,
      agents: [{ id: "a", name: "A", model: "anthropic/claude-3" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents[0]!.timeoutMs).toBeUndefined();
    }
  });

  it("[positive] timeoutMs=60000 is accepted", () => {
    const result = safeParseRuntimeConfig({
      version: 1,
      agents: [{ id: "a", name: "A", model: "anthropic/claude-3", timeoutMs: 60000 }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents[0]!.timeoutMs).toBe(60000);
    }
  });

  it("[negative] timeoutMs=500 is rejected (min 1000)", () => {
    const result = safeParseRuntimeConfig({
      version: 1,
      agents: [{ id: "a", name: "A", model: "anthropic/claude-3", timeoutMs: 500 }],
    });
    expect(result.success).toBe(false);
  });
});

describe("createDefaultRuntimeConfig", () => {
  it("creates a valid config with one default agent", () => {
    const config = createDefaultRuntimeConfig({});
    expect(config.version).toBe(1);
    expect(config.agents).toHaveLength(1);
    expect(config.agents[0]!.id).toBe("pilot");
    expect(config.agents[0]!.isDefault).toBe(true);
    expect(config.agents[0]!.toolProfile).toBe("full");
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
