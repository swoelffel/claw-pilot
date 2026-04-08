// src/core/model-discovery/adapters/mistral.ts
//
// Mistral model discovery adapter.
// Endpoint: GET /v1/models — requires Bearer token.
// Good response: capabilities (function_call, vision), context length.

import type { ProviderAdapter, DiscoveredModel } from "../types.js";
import { fetchJson, makeDiscoveredModel } from "./base.js";
import { PROVIDER_BASE_URLS } from "../../../lib/providers.js";

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

interface MistralCapabilities {
  completion_chat?: boolean;
  function_calling?: boolean;
  vision?: boolean;
  fine_tuning?: boolean;
}

interface MistralModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
  capabilities?: MistralCapabilities;
  max_context_length?: number;
  deprecation?: string | null;
}

interface MistralListResponse {
  object: string;
  data: MistralModel[];
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class MistralAdapter implements ProviderAdapter {
  readonly providerId = "mistral" as const;

  async discover(
    apiKey: string | undefined,
    baseUrl: string | undefined,
  ): Promise<DiscoveredModel[]> {
    if (!apiKey) return [];

    const base = baseUrl ?? PROVIDER_BASE_URLS.mistral ?? "https://api.mistral.ai/v1";
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
    };

    const response = await fetchJson<MistralListResponse>(`${base}/models`, { headers });

    // Filter: only models with function_calling capability, not deprecated
    return response.data
      .filter((m) => m.capabilities?.function_calling && !m.deprecation)
      .map((m) =>
        makeDiscoveredModel(this.providerId, m.id, {
          // Mistral uses OpenAI-compatible API
          api: "openai-completions",
          capabilities: {
            streaming: true,
            toolCalling: true,
            ...(m.capabilities?.vision && { vision: true }),
            ...(m.max_context_length !== undefined && { contextWindow: m.max_context_length }),
          },
        }),
      );
  }
}
