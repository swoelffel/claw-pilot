// src/core/model-discovery/__tests__/adapters.test.ts
//
// Unit tests for provider discovery adapters.
// Each adapter is tested with a mocked fetch returning fixture data.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AnthropicAdapter } from "../adapters/anthropic.js";
import { OpenAIAdapter } from "../adapters/openai.js";
import { GoogleAdapter } from "../adapters/google.js";
import { MistralAdapter } from "../adapters/mistral.js";
import { XaiAdapter } from "../adapters/xai.js";
import { OpenRouterAdapter } from "../adapters/openrouter.js";
import { OllamaAdapter } from "../adapters/ollama.js";
import { OpenCodeAdapter } from "../adapters/opencode.js";

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockJsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(data),
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

describe("AnthropicAdapter", () => {
  const adapter = new AnthropicAdapter();

  it("returns empty array without API key", async () => {
    expect(await adapter.discover(undefined, undefined)).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("discovers models from API", async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        data: [
          { id: "claude-opus-4-6", display_name: "Claude Opus 4.6", type: "model" },
          { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6", type: "model" },
        ],
        has_more: false,
      }),
    );

    const models = await adapter.discover("test-key", undefined);
    expect(models).toHaveLength(2);
    expect(models[0]!.id).toBe("claude-opus-4-6");
    expect(models[0]!.providerId).toBe("anthropic");
    expect(models[0]!.api).toBe("anthropic-messages");
    expect(models[0]!.name).toBe("Claude Opus 4.6");

    // Check auth headers
    const call = mockFetch.mock.calls[0]!;
    expect(call[1]?.headers?.["x-api-key"]).toBe("test-key");
    expect(call[1]?.headers?.["anthropic-version"]).toBe("2023-06-01");
  });

  it("paginates when has_more is true", async () => {
    mockFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          data: [{ id: "model-1", display_name: "Model 1", type: "model" }],
          has_more: true,
          last_id: "model-1",
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          data: [{ id: "model-2", display_name: "Model 2", type: "model" }],
          has_more: false,
        }),
      );

    const models = await adapter.discover("key", undefined);
    expect(models).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

describe("OpenAIAdapter", () => {
  const adapter = new OpenAIAdapter();

  it("returns empty array without API key", async () => {
    expect(await adapter.discover(undefined, undefined)).toEqual([]);
  });

  it("filters to known model families", async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        object: "list",
        data: [
          { id: "gpt-5.2", object: "model", created: 0, owned_by: "openai" },
          { id: "gpt-4.1", object: "model", created: 0, owned_by: "openai" },
          { id: "o3", object: "model", created: 0, owned_by: "openai" },
          { id: "ft:gpt-5.2:custom", object: "model", created: 0, owned_by: "openai" },
          { id: "tts-1", object: "model", created: 0, owned_by: "openai" },
          { id: "whisper-1", object: "model", created: 0, owned_by: "openai" },
        ],
      }),
    );

    const models = await adapter.discover("key", undefined);
    const ids = models.map((m) => m.id);
    expect(ids).toContain("gpt-5.2");
    expect(ids).toContain("gpt-4.1");
    expect(ids).toContain("o3");
    expect(ids).not.toContain("ft:gpt-5.2:custom");
    expect(ids).not.toContain("tts-1");
    expect(ids).not.toContain("whisper-1");
  });
});

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

describe("GoogleAdapter", () => {
  const adapter = new GoogleAdapter();

  it("returns empty array without API key", async () => {
    expect(await adapter.discover(undefined, undefined)).toEqual([]);
  });

  it("filters by generateContent support and strips models/ prefix", async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        models: [
          {
            name: "models/gemini-2.5-pro",
            displayName: "Gemini 2.5 Pro",
            inputTokenLimit: 1000000,
            outputTokenLimit: 65536,
            supportedGenerationMethods: ["generateContent", "countTokens"],
          },
          {
            name: "models/embedding-001",
            displayName: "Embedding",
            supportedGenerationMethods: ["embedContent"],
          },
        ],
      }),
    );

    const models = await adapter.discover("key", undefined);
    expect(models).toHaveLength(1);
    expect(models[0]!.id).toBe("gemini-2.5-pro");
    expect(models[0]!.capabilities.contextWindow).toBe(1000000);
    expect(models[0]!.capabilities.maxOutputTokens).toBe(65536);
  });
});

// ---------------------------------------------------------------------------
// Mistral
// ---------------------------------------------------------------------------

describe("MistralAdapter", () => {
  const adapter = new MistralAdapter();

  it("returns empty array without API key", async () => {
    expect(await adapter.discover(undefined, undefined)).toEqual([]);
  });

  it("filters by function_calling capability", async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        object: "list",
        data: [
          {
            id: "mistral-large",
            object: "model",
            created: 0,
            owned_by: "mistralai",
            capabilities: { function_calling: true, vision: true },
            max_context_length: 128000,
          },
          {
            id: "mistral-embed",
            object: "model",
            created: 0,
            owned_by: "mistralai",
            capabilities: { function_calling: false },
          },
          {
            id: "deprecated-model",
            object: "model",
            created: 0,
            owned_by: "mistralai",
            capabilities: { function_calling: true },
            deprecation: "2026-01-01",
          },
        ],
      }),
    );

    const models = await adapter.discover("key", undefined);
    expect(models).toHaveLength(1);
    expect(models[0]!.id).toBe("mistral-large");
    expect(models[0]!.capabilities.vision).toBe(true);
    expect(models[0]!.capabilities.contextWindow).toBe(128000);
  });
});

// ---------------------------------------------------------------------------
// xAI
// ---------------------------------------------------------------------------

describe("XaiAdapter", () => {
  const adapter = new XaiAdapter();

  it("returns empty array without API key", async () => {
    expect(await adapter.discover(undefined, undefined)).toEqual([]);
  });

  it("discovers all models", async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        object: "list",
        data: [
          { id: "grok-4", object: "model", created: 0, owned_by: "xai" },
          { id: "grok-3", object: "model", created: 0, owned_by: "xai" },
        ],
      }),
    );

    const models = await adapter.discover("key", undefined);
    expect(models).toHaveLength(2);
    expect(models[0]!.api).toBe("openai-completions");
  });
});

// ---------------------------------------------------------------------------
// OpenRouter
// ---------------------------------------------------------------------------

describe("OpenRouterAdapter", () => {
  const adapter = new OpenRouterAdapter();

  it("filters by tool_calling and known families", async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        data: [
          {
            id: "anthropic/claude-opus-4-6",
            name: "Claude Opus 4.6",
            context_length: 200000,
            supported_parameters: ["tools", "temperature"],
            pricing: { prompt: "0.000015", completion: "0.000075" },
            architecture: { input_modalities: ["text", "image"] },
          },
          {
            id: "unknown-vendor/obscure-model",
            name: "Obscure",
            supported_parameters: ["tools"],
          },
          {
            id: "google/gemini-3-pro",
            name: "Gemini 3 Pro",
            supported_parameters: ["temperature"],
          },
        ],
      }),
    );

    const models = await adapter.discover(undefined, undefined);
    // Only anthropic/claude-opus-4-6 matches (known family + tool_calling)
    expect(models).toHaveLength(1);
    expect(models[0]!.id).toBe("anthropic/claude-opus-4-6");
    expect(models[0]!.capabilities.contextWindow).toBe(200000);
    expect(models[0]!.capabilities.vision).toBe(true);
    expect(models[0]!.cost.inputPerMillion).toBe(15);
    expect(models[0]!.cost.outputPerMillion).toBe(75);
  });
});

// ---------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------

describe("OllamaAdapter", () => {
  const adapter = new OllamaAdapter();

  it("returns empty array when Ollama is unreachable", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const models = await adapter.discover(undefined, undefined);
    expect(models).toEqual([]);
  });

  it("discovers locally pulled models", async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        models: [
          { name: "llama3.2", modified_at: "2026-01-01", size: 4000000000, digest: "abc" },
          { name: "qwen2.5-coder:7b", modified_at: "2026-01-01", size: 3000000000, digest: "def" },
        ],
      }),
    );

    const models = await adapter.discover(undefined, undefined);
    expect(models).toHaveLength(2);
    expect(models[0]!.id).toBe("llama3.2");
    expect(models[0]!.api).toBe("ollama");
  });
});

// ---------------------------------------------------------------------------
// OpenCode
// ---------------------------------------------------------------------------

describe("OpenCodeAdapter", () => {
  const adapter = new OpenCodeAdapter();

  it("discovers all models (no auth needed)", async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        object: "list",
        data: [
          { id: "claude-opus-4-6", object: "model", created: 0, owned_by: "opencode" },
          { id: "gpt-5.2", object: "model", created: 0, owned_by: "opencode" },
        ],
      }),
    );

    const models = await adapter.discover(undefined, undefined);
    expect(models).toHaveLength(2);
    expect(models[0]!.api).toBe("openai-completions");
    expect(models[0]!.providerId).toBe("opencode");
  });
});
