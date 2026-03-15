/**
 * runtime/provider/provider.ts
 *
 * LLM provider abstraction for claw-runtime.
 *
 * Wraps the Vercel AI SDK to provide:
 * - A unified LanguageModel interface across all providers
 * - Provider resolution from config + env vars
 * - Integration with the auth profile rotation system
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI as createOllamaCompat } from "@ai-sdk/openai"; // Ollama uses OpenAI-compat API
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

import type { ProviderId, ModelId, ModelApi } from "../types.js";
import { findModel } from "./models.js";

// ---------------------------------------------------------------------------
// Provider config
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  id: ProviderId;
  api: ModelApi;
  /** Base URL override (required for Ollama, optional for others) */
  baseUrl: string | undefined;
  /** API key (resolved from env var by the caller) */
  apiKey: string | undefined;
  /** Extra headers to inject */
  headers: Record<string, string> | undefined;
}

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a LanguageModel instance from a provider config + model ID.
 * Throws if the provider or model is not supported.
 */
export function resolveLanguageModel(config: ProviderConfig, modelId: ModelId): LanguageModel {
  switch (config.api) {
    case "anthropic-messages": {
      const client = createAnthropic({
        ...(config.apiKey !== undefined && { apiKey: config.apiKey }),
        ...(config.baseUrl !== undefined && { baseURL: config.baseUrl }),
        ...(config.headers !== undefined && { headers: config.headers }),
      });
      return client(modelId);
    }

    case "openai-completions":
    case "openai-responses": {
      const client = createOpenAI({
        ...(config.apiKey !== undefined && { apiKey: config.apiKey }),
        ...(config.baseUrl !== undefined && { baseURL: config.baseUrl }),
        ...(config.headers !== undefined && { headers: config.headers }),
      });
      return client(modelId);
    }

    case "google-generative-ai": {
      const client = createGoogleGenerativeAI({
        ...(config.apiKey !== undefined && { apiKey: config.apiKey }),
        ...(config.baseUrl !== undefined && { baseURL: config.baseUrl }),
        ...(config.headers !== undefined && { headers: config.headers }),
      });
      return client(modelId);
    }

    case "ollama": {
      // Ollama exposes an OpenAI-compatible API at http://localhost:11434/v1
      const client = createOllamaCompat({
        apiKey: "ollama", // Ollama doesn't require a real key
        baseURL: config.baseUrl ?? "http://localhost:11434/v1",
        ...(config.headers !== undefined && { headers: config.headers }),
      });
      return client(modelId);
    }

    case "openrouter": {
      const client = createOpenRouter({
        ...(config.apiKey !== undefined && { apiKey: config.apiKey }),
        ...(config.baseUrl !== undefined && { baseURL: config.baseUrl }),
        ...(config.headers !== undefined && { headers: config.headers }),
      });
      return client(modelId);
    }

    default: {
      const _exhaustive: never = config.api;
      throw new Error(`Unsupported provider API: ${String(_exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

/** Static provider descriptors (id, name, env var for API key) */
export interface ProviderDescriptor {
  id: ProviderId;
  name: string;
  api: ModelApi;
  /** Environment variable name that holds the API key */
  apiKeyEnvVar?: string;
  /** Default base URL (if different from SDK default) */
  defaultBaseUrl?: string;
}

export const PROVIDER_REGISTRY: ProviderDescriptor[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    api: "anthropic-messages",
    apiKeyEnvVar: "ANTHROPIC_API_KEY",
  },
  {
    id: "openai",
    name: "OpenAI",
    api: "openai-completions",
    apiKeyEnvVar: "OPENAI_API_KEY",
  },
  {
    id: "google",
    name: "Google Gemini",
    api: "google-generative-ai",
    apiKeyEnvVar: "GOOGLE_GENERATIVE_AI_API_KEY",
  },
  {
    id: "ollama",
    name: "Ollama (local)",
    api: "ollama",
    defaultBaseUrl: "http://localhost:11434/v1",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    api: "openrouter",
    apiKeyEnvVar: "OPENROUTER_API_KEY",
  },
];

/** Look up a provider descriptor by ID */
export function getProviderDescriptor(id: ProviderId): ProviderDescriptor | undefined {
  return PROVIDER_REGISTRY.find((p) => p.id === id);
}

// ---------------------------------------------------------------------------
// Model resolution helper
// ---------------------------------------------------------------------------

export interface ResolvedModel {
  languageModel: LanguageModel;
  providerId: ProviderId;
  modelId: ModelId;
  /** Cost info from catalog (undefined for custom/unknown models) */
  costPerMillion: { input: number; output: number } | undefined;
}

/**
 * Resolve a LanguageModel from a "provider/model" string or separate IDs.
 * API key is resolved from the provided env map (or process.env as fallback).
 */
export function resolveModel(
  providerId: ProviderId,
  modelId: ModelId,
  options: {
    apiKey?: string;
    baseUrl?: string;
    headers?: Record<string, string>;
    env?: Record<string, string | undefined>;
  } = {},
): ResolvedModel {
  const descriptor = getProviderDescriptor(providerId);
  if (!descriptor) {
    throw new Error(
      `Unknown provider: "${providerId}". Available: ${PROVIDER_REGISTRY.map((p) => p.id).join(", ")}`,
    );
  }

  // Resolve API key: explicit > env map > process.env
  const env = options.env ?? process.env;
  const apiKey =
    options.apiKey ?? (descriptor.apiKeyEnvVar ? env[descriptor.apiKeyEnvVar] : undefined);

  const config: ProviderConfig = {
    id: providerId,
    api: descriptor.api,
    baseUrl: options.baseUrl ?? descriptor.defaultBaseUrl,
    apiKey,
    headers: options.headers,
  };

  const languageModel = resolveLanguageModel(config, modelId);
  const catalogEntry = findModel(providerId, modelId);

  return {
    languageModel,
    providerId,
    modelId,
    costPerMillion: catalogEntry
      ? {
          input: catalogEntry.cost.inputPerMillion,
          output: catalogEntry.cost.outputPerMillion,
        }
      : undefined,
  };
}
