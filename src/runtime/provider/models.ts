/**
 * runtime/provider/models.ts
 *
 * Static model catalog for claw-runtime.
 * Covers the 5 initial providers: Anthropic, OpenAI, Google, Ollama, OpenRouter.
 *
 * Models are listed with capabilities, context limits, and indicative pricing.
 * Pricing is in USD per million tokens (as of early 2026 — update as needed).
 */

import type { ModelInfo } from "../types.js";

export const MODEL_CATALOG: ModelInfo[] = [
  // ---------------------------------------------------------------------------
  // Anthropic
  // ---------------------------------------------------------------------------
  {
    id: "claude-opus-4-5",
    providerId: "anthropic",
    name: "Claude Opus 4.5",
    api: "anthropic-messages",
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: true,
      reasoning: true,
      contextWindow: 200_000,
      maxOutputTokens: 32_000,
    },
    cost: { inputPerMillion: 15, outputPerMillion: 75 },
  },
  {
    id: "claude-sonnet-4-5",
    providerId: "anthropic",
    name: "Claude Sonnet 4.5",
    api: "anthropic-messages",
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: true,
      reasoning: true,
      contextWindow: 200_000,
      maxOutputTokens: 16_000,
    },
    cost: { inputPerMillion: 3, outputPerMillion: 15 },
  },
  {
    id: "claude-haiku-3-5",
    providerId: "anthropic",
    name: "Claude Haiku 3.5",
    api: "anthropic-messages",
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: true,
      reasoning: false,
      contextWindow: 200_000,
      maxOutputTokens: 8_192,
    },
    cost: { inputPerMillion: 0.8, outputPerMillion: 4 },
  },

  // ---------------------------------------------------------------------------
  // OpenAI
  // ---------------------------------------------------------------------------
  {
    id: "gpt-4o",
    providerId: "openai",
    name: "GPT-4o",
    api: "openai-completions",
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: true,
      reasoning: false,
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
    },
    cost: { inputPerMillion: 2.5, outputPerMillion: 10 },
  },
  {
    id: "gpt-4o-mini",
    providerId: "openai",
    name: "GPT-4o Mini",
    api: "openai-completions",
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: true,
      reasoning: false,
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
    },
    cost: { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  },
  {
    id: "o3-mini",
    providerId: "openai",
    name: "o3-mini",
    api: "openai-completions",
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: false,
      reasoning: true,
      contextWindow: 200_000,
      maxOutputTokens: 100_000,
    },
    cost: { inputPerMillion: 1.1, outputPerMillion: 4.4 },
  },

  // ---------------------------------------------------------------------------
  // Google
  // ---------------------------------------------------------------------------
  {
    id: "gemini-2.0-flash",
    providerId: "google",
    name: "Gemini 2.0 Flash",
    api: "google-generative-ai",
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: true,
      reasoning: false,
      contextWindow: 1_000_000,
      maxOutputTokens: 8_192,
    },
    cost: { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  },
  {
    id: "gemini-2.5-pro",
    providerId: "google",
    name: "Gemini 2.5 Pro",
    api: "google-generative-ai",
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: true,
      reasoning: true,
      contextWindow: 1_000_000,
      maxOutputTokens: 65_536,
    },
    cost: { inputPerMillion: 1.25, outputPerMillion: 10 },
  },

  // ---------------------------------------------------------------------------
  // Ollama (local — no cost, context varies by model)
  // ---------------------------------------------------------------------------
  {
    id: "llama3.2",
    providerId: "ollama",
    name: "Llama 3.2 (8B)",
    api: "ollama",
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: false,
      reasoning: false,
      contextWindow: 128_000,
      maxOutputTokens: 8_192,
    },
    cost: { inputPerMillion: 0, outputPerMillion: 0 },
  },
  {
    id: "qwen2.5-coder",
    providerId: "ollama",
    name: "Qwen 2.5 Coder",
    api: "ollama",
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: false,
      reasoning: false,
      contextWindow: 32_768,
      maxOutputTokens: 8_192,
    },
    cost: { inputPerMillion: 0, outputPerMillion: 0 },
  },
];

/** Look up a model by provider + model ID */
export function findModel(providerId: string, modelId: string): ModelInfo | undefined {
  return MODEL_CATALOG.find((m) => m.providerId === providerId && m.id === modelId);
}

/** @public Get all models for a given provider */
export function getProviderModels(providerId: string): ModelInfo[] {
  return MODEL_CATALOG.filter((m) => m.providerId === providerId);
}
