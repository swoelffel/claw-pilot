// src/runtime/provider/model-discovery.ts
//
// Dynamic model discovery — queries provider APIs to list available models.
// Used by the profile dashboard to populate the default model selector.

import { PROVIDER_BASE_URLS } from "../../lib/providers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscoveredModel {
  id: string;
  name: string;
  providerId: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch available models from a provider's API.
 * Returns a list of models or throws on network/auth error.
 *
 * @param providerId  Provider identifier (anthropic, openai, google, openrouter, ollama)
 * @param apiKey      API key for authentication (empty string for Ollama)
 * @param baseUrl     Override base URL (required for Ollama if not default)
 */
export async function discoverModels(
  providerId: string,
  apiKey: string,
  baseUrl?: string | null,
): Promise<DiscoveredModel[]> {
  switch (providerId) {
    case "anthropic":
      return discoverAnthropic(apiKey, baseUrl);
    case "openai":
      return discoverOpenAI(apiKey, baseUrl, "openai");
    case "openrouter":
      return discoverOpenAI(apiKey, baseUrl ?? "https://openrouter.ai/api/v1", "openrouter");
    case "google":
      return discoverGoogle(apiKey, baseUrl);
    case "ollama":
      return discoverOllama(baseUrl ?? "http://localhost:11434");
    case "mistral":
      return discoverOpenAI(apiKey, baseUrl ?? "https://api.mistral.ai/v1", "mistral");
    case "xai":
      return discoverOpenAI(apiKey, baseUrl ?? "https://api.x.ai/v1", "xai");
    default:
      throw new Error(`Unsupported provider for model discovery: ${providerId}`);
  }
}

// ---------------------------------------------------------------------------
// Provider-specific implementations
// ---------------------------------------------------------------------------

/** Anthropic: GET /v1/models with x-api-key header */
async function discoverAnthropic(
  apiKey: string,
  baseUrl?: string | null,
): Promise<DiscoveredModel[]> {
  const base = baseUrl ?? PROVIDER_BASE_URLS["anthropic"] ?? "https://api.anthropic.com";
  const res = await fetch(`${base}/v1/models`, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Anthropic API error: ${res.status} ${res.statusText}`);

  const body = (await res.json()) as { data?: Array<{ id: string; display_name?: string }> };
  return (body.data ?? []).map((m) => ({
    id: m.id,
    name: m.display_name ?? m.id,
    providerId: "anthropic",
  }));
}

/** OpenAI-compatible: GET /v1/models with Bearer token (works for OpenAI, OpenRouter, Mistral, xAI) */
async function discoverOpenAI(
  apiKey: string,
  baseUrl: string | null | undefined,
  providerId: string,
): Promise<DiscoveredModel[]> {
  const base = baseUrl ?? PROVIDER_BASE_URLS[providerId] ?? "https://api.openai.com/v1";
  const res = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`${providerId} API error: ${res.status} ${res.statusText}`);

  const body = (await res.json()) as { data?: Array<{ id: string; name?: string }> };
  return (body.data ?? [])
    .map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      providerId,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Google: GET /v1beta/models?key=<apiKey> */
async function discoverGoogle(apiKey: string, baseUrl?: string | null): Promise<DiscoveredModel[]> {
  const base =
    baseUrl ?? PROVIDER_BASE_URLS["google"] ?? "https://generativelanguage.googleapis.com/v1beta";
  const res = await fetch(`${base}/models?key=${encodeURIComponent(apiKey)}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Google API error: ${res.status} ${res.statusText}`);

  const body = (await res.json()) as {
    models?: Array<{ name: string; displayName?: string }>;
  };
  return (body.models ?? []).map((m) => {
    // Google returns "models/gemini-2.0-flash" — strip prefix
    const id = m.name.replace(/^models\//, "");
    return {
      id,
      name: m.displayName ?? id,
      providerId: "google",
    };
  });
}

/** Ollama: GET /api/tags (local, no auth) */
async function discoverOllama(baseUrl: string): Promise<DiscoveredModel[]> {
  const res = await fetch(`${baseUrl}/api/tags`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Ollama API error: ${res.status} ${res.statusText}`);

  const body = (await res.json()) as { models?: Array<{ name: string }> };
  return (body.models ?? []).map((m) => ({
    id: m.name,
    name: m.name,
    providerId: "ollama",
  }));
}
