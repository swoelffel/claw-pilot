// src/core/model-discovery/adapters/openrouter.ts
//
// OpenRouter model discovery adapter.
// Endpoint: GET /api/v1/models — NO auth required.
// Richest response: pricing, architecture, modalities, 300+ models.
// Filtered to tool-calling models from known families, capped at 50.

import type { ProviderAdapter, DiscoveredModel } from "../types.js";
import { fetchJson, makeDiscoveredModel } from "./base.js";

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

interface OpenRouterPricing {
  prompt?: string; // cost per token as string
  completion?: string;
}

interface OpenRouterArchitecture {
  modality?: string;
  input_modalities?: string[];
  output_modalities?: string[];
}

interface OpenRouterModel {
  id: string; // "anthropic/claude-opus-4-6"
  name: string;
  description?: string;
  context_length?: number;
  architecture?: OpenRouterArchitecture;
  pricing?: OpenRouterPricing;
  supported_parameters?: string[];
}

interface OpenRouterListResponse {
  data: OpenRouterModel[];
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

const KNOWN_FAMILIES = [
  "anthropic/",
  "openai/",
  "google/",
  "meta-llama/",
  "mistralai/",
  "qwen/",
  "deepseek/",
  "x-ai/",
  "cohere/",
];

const MAX_MODELS = 50;

function hasToolCalling(m: OpenRouterModel): boolean {
  return m.supported_parameters?.includes("tools") ?? false;
}

function isKnownFamily(id: string): boolean {
  return KNOWN_FAMILIES.some((prefix) => id.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class OpenRouterAdapter implements ProviderAdapter {
  readonly providerId = "openrouter" as const;

  async discover(
    _apiKey: string | undefined,
    _baseUrl: string | undefined,
  ): Promise<DiscoveredModel[]> {
    const response = await fetchJson<OpenRouterListResponse>("https://openrouter.ai/api/v1/models");

    return response.data
      .filter((m) => hasToolCalling(m) && isKnownFamily(m.id))
      .slice(0, MAX_MODELS)
      .map((m) => {
        const cost: DiscoveredModel["cost"] = {};
        if (m.pricing?.prompt) {
          // OpenRouter gives cost per token — convert to per million
          cost.inputPerMillion = parseFloat(m.pricing.prompt) * 1_000_000;
        }
        if (m.pricing?.completion) {
          cost.outputPerMillion = parseFloat(m.pricing.completion) * 1_000_000;
        }

        return makeDiscoveredModel(this.providerId, m.id, {
          name: m.name || m.id,
          api: "openrouter",
          capabilities: {
            streaming: true,
            toolCalling: true,
            ...(m.context_length !== undefined && { contextWindow: m.context_length }),
            ...(m.architecture?.input_modalities?.includes("image") && { vision: true }),
          },
          cost,
        });
      });
  }
}
