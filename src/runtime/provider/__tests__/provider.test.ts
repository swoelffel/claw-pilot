/**
 * runtime/provider/__tests__/provider.test.ts
 *
 * Unit tests for provider resolution.
 * Mocks SDK create* functions to avoid real HTTP calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all SDK provider factories
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => vi.fn(() => ({ modelId: "mock-anthropic" }))),
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => vi.fn(() => ({ modelId: "mock-openai" }))),
}));
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn(() => vi.fn(() => ({ modelId: "mock-google" }))),
}));
vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: vi.fn(() => vi.fn(() => ({ modelId: "mock-openrouter" }))),
}));

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  PROVIDER_REGISTRY,
  getProviderDescriptor,
  resolveLanguageModel,
  resolveModel,
} from "../provider.js";

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// PROVIDER_REGISTRY
// ---------------------------------------------------------------------------

describe("PROVIDER_REGISTRY", () => {
  it("has 8 providers", () => {
    expect(PROVIDER_REGISTRY).toHaveLength(8);
  });

  it("has unique IDs", () => {
    const ids = PROVIDER_REGISTRY.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes expected providers", () => {
    const ids = PROVIDER_REGISTRY.map((p) => p.id);
    expect(ids).toContain("anthropic");
    expect(ids).toContain("openai");
    expect(ids).toContain("google");
    expect(ids).toContain("ollama");
    expect(ids).toContain("openrouter");
  });

  it("Ollama has a default base URL", () => {
    const ollama = getProviderDescriptor("ollama");
    expect(ollama!.defaultBaseUrl).toBe("http://localhost:11434/v1");
  });
});

// ---------------------------------------------------------------------------
// getProviderDescriptor
// ---------------------------------------------------------------------------

describe("getProviderDescriptor", () => {
  it("returns descriptor for known provider", () => {
    const d = getProviderDescriptor("anthropic");
    expect(d).toBeDefined();
    expect(d!.name).toBe("Anthropic");
    expect(d!.apiKeyEnvVar).toBe("ANTHROPIC_API_KEY");
  });

  it("returns undefined for unknown provider", () => {
    expect(getProviderDescriptor("unknown" as any)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resolveLanguageModel
// ---------------------------------------------------------------------------

describe("resolveLanguageModel", () => {
  it("creates Anthropic model", () => {
    resolveLanguageModel(
      {
        id: "anthropic",
        api: "anthropic-messages",
        apiKey: "key",
        baseUrl: undefined,
        headers: undefined,
      },
      "claude-sonnet-4-6",
    );
    expect(createAnthropic).toHaveBeenCalledWith({ apiKey: "key" });
  });

  it("creates OpenAI model for openai-completions", () => {
    resolveLanguageModel(
      {
        id: "openai",
        api: "openai-completions",
        apiKey: "key",
        baseUrl: undefined,
        headers: undefined,
      },
      "gpt-4o",
    );
    expect(createOpenAI).toHaveBeenCalled();
  });

  it("creates Google model", () => {
    resolveLanguageModel(
      {
        id: "google",
        api: "google-generative-ai",
        apiKey: "key",
        baseUrl: undefined,
        headers: undefined,
      },
      "gemini-2.0-flash",
    );
    expect(createGoogleGenerativeAI).toHaveBeenCalled();
  });

  it("creates Ollama model with default base URL", () => {
    resolveLanguageModel(
      { id: "ollama", api: "ollama", apiKey: undefined, baseUrl: undefined, headers: undefined },
      "llama3.2",
    );
    // Ollama uses createOpenAI internally
    expect(createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "ollama", baseURL: "http://localhost:11434/v1" }),
    );
  });

  it("creates OpenRouter model", () => {
    resolveLanguageModel(
      {
        id: "openrouter",
        api: "openrouter",
        apiKey: "key",
        baseUrl: undefined,
        headers: undefined,
      },
      "meta-llama/llama-3-70b",
    );
    expect(createOpenRouter).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// resolveModel
// ---------------------------------------------------------------------------

describe("resolveModel", () => {
  it("resolves a known model with cost info", () => {
    const result = resolveModel("anthropic", "claude-sonnet-4-6", { apiKey: "test-key" });
    expect(result.providerId).toBe("anthropic");
    expect(result.modelId).toBe("claude-sonnet-4-6");
    expect(result.costPerMillion).toEqual({ input: 3, output: 15 });
    expect(result.languageModel).toBeDefined();
  });

  it("throws for unknown provider", () => {
    expect(() => resolveModel("unknown" as any, "model")).toThrow(/Unknown provider/);
  });

  it("returns undefined costPerMillion for unknown model", () => {
    const result = resolveModel("anthropic", "custom-model", { apiKey: "key" });
    expect(result.costPerMillion).toBeUndefined();
  });

  it("resolves API key from env map", () => {
    resolveModel("anthropic", "claude-sonnet-4-6", {
      env: { ANTHROPIC_API_KEY: "env-key" },
    });
    expect(createAnthropic).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "env-key" }));
  });

  it("explicit apiKey takes precedence over env", () => {
    resolveModel("anthropic", "claude-sonnet-4-6", {
      apiKey: "explicit",
      env: { ANTHROPIC_API_KEY: "env-key" },
    });
    expect(createAnthropic).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "explicit" }));
  });
});
