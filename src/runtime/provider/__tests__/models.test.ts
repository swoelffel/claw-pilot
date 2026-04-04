/**
 * runtime/provider/__tests__/models.test.ts
 *
 * Unit tests for the static model catalog.
 * Pure data assertions — no mocks needed.
 */

import { describe, it, expect } from "vitest";
import { MODEL_CATALOG, findModel, getProviderModels } from "../models.js";

// ---------------------------------------------------------------------------
// MODEL_CATALOG structure
// ---------------------------------------------------------------------------

describe("MODEL_CATALOG", () => {
  it("has 12 entries", () => {
    expect(MODEL_CATALOG).toHaveLength(12);
  });

  it("every entry has required fields", () => {
    for (const model of MODEL_CATALOG) {
      expect(model.id).toBeTruthy();
      expect(model.providerId).toBeTruthy();
      expect(model.name).toBeTruthy();
      expect(model.api).toBeTruthy();
      expect(model.capabilities).toBeDefined();
      expect(model.cost).toBeDefined();
    }
  });

  it("every entry has valid capabilities", () => {
    for (const model of MODEL_CATALOG) {
      const c = model.capabilities;
      expect(typeof c.streaming).toBe("boolean");
      expect(typeof c.toolCalling).toBe("boolean");
      expect(typeof c.vision).toBe("boolean");
      expect(typeof c.reasoning).toBe("boolean");
      expect(c.contextWindow).toBeGreaterThan(0);
      expect(c.maxOutputTokens).toBeGreaterThan(0);
    }
  });

  it("every entry has non-negative costs", () => {
    for (const model of MODEL_CATALOG) {
      expect(model.cost.inputPerMillion).toBeGreaterThanOrEqual(0);
      expect(model.cost.outputPerMillion).toBeGreaterThanOrEqual(0);
    }
  });

  it("has no duplicate IDs", () => {
    const ids = MODEL_CATALOG.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// Provider-specific checks
// ---------------------------------------------------------------------------

describe("Anthropic models", () => {
  const anthropicModels = MODEL_CATALOG.filter((m) => m.providerId === "anthropic");

  it("has 5 models", () => {
    expect(anthropicModels).toHaveLength(5);
  });

  it("all use anthropic-messages API", () => {
    for (const m of anthropicModels) {
      expect(m.api).toBe("anthropic-messages");
    }
  });

  it("all except Haiku have reasoning capability", () => {
    for (const m of anthropicModels) {
      if (m.id.includes("haiku")) {
        expect(m.capabilities.reasoning).toBe(false);
      } else {
        expect(m.capabilities.reasoning).toBe(true);
      }
    }
  });

  it("all have vision capability", () => {
    for (const m of anthropicModels) {
      expect(m.capabilities.vision).toBe(true);
    }
  });
});

describe("Ollama models", () => {
  const ollamaModels = MODEL_CATALOG.filter((m) => m.providerId === "ollama");

  it("has 2 models", () => {
    expect(ollamaModels).toHaveLength(2);
  });

  it("all have zero cost", () => {
    for (const m of ollamaModels) {
      expect(m.cost.inputPerMillion).toBe(0);
      expect(m.cost.outputPerMillion).toBe(0);
    }
  });

  it("none have vision or reasoning", () => {
    for (const m of ollamaModels) {
      expect(m.capabilities.vision).toBe(false);
      expect(m.capabilities.reasoning).toBe(false);
    }
  });
});

describe("Google models", () => {
  const googleModels = MODEL_CATALOG.filter((m) => m.providerId === "google");

  it("has 2 models", () => {
    expect(googleModels).toHaveLength(2);
  });

  it("all have 1M context window", () => {
    for (const m of googleModels) {
      expect(m.capabilities.contextWindow).toBe(1_000_000);
    }
  });
});

describe("OpenAI models", () => {
  const openaiModels = MODEL_CATALOG.filter((m) => m.providerId === "openai");

  it("has 3 models", () => {
    expect(openaiModels).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// findModel
// ---------------------------------------------------------------------------

describe("findModel", () => {
  it("returns the correct model for a known provider + ID", () => {
    const model = findModel("anthropic", "claude-sonnet-4-6");
    expect(model).toBeDefined();
    expect(model!.name).toBe("Claude Sonnet 4.6");
  });

  it("returns undefined for unknown provider", () => {
    expect(findModel("unknown", "claude-sonnet-4-6")).toBeUndefined();
  });

  it("returns undefined for unknown model ID", () => {
    expect(findModel("anthropic", "nonexistent")).toBeUndefined();
  });

  it("returns undefined when both are unknown", () => {
    expect(findModel("x", "y")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getProviderModels
// ---------------------------------------------------------------------------

describe("getProviderModels", () => {
  it("returns all Anthropic models", () => {
    const models = getProviderModels("anthropic");
    expect(models).toHaveLength(5);
    for (const m of models) {
      expect(m.providerId).toBe("anthropic");
    }
  });

  it("returns empty array for nonexistent provider", () => {
    expect(getProviderModels("nonexistent")).toEqual([]);
  });

  it("returns all Ollama models", () => {
    expect(getProviderModels("ollama")).toHaveLength(2);
  });
});
