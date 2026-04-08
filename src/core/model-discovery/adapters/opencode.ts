// src/core/model-discovery/adapters/opencode.ts
//
// OpenCode Zen model discovery adapter.
// Endpoint: GET https://opencode.ai/zen/v1/models — no auth required.
// OpenAI-compatible response but minimal (id only, 39 models).

import type { ProviderAdapter, DiscoveredModel } from "../types.js";
import { fetchJson, makeDiscoveredModel } from "./base.js";

// ---------------------------------------------------------------------------
// API response shapes (OpenAI-compatible)
// ---------------------------------------------------------------------------

interface OpenCodeModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

interface OpenCodeListResponse {
  object: string;
  data: OpenCodeModel[];
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class OpenCodeAdapter implements ProviderAdapter {
  readonly providerId = "opencode" as const;

  async discover(
    _apiKey: string | undefined,
    _baseUrl: string | undefined,
  ): Promise<DiscoveredModel[]> {
    const response = await fetchJson<OpenCodeListResponse>("https://opencode.ai/zen/v1/models");

    return response.data.map((m) =>
      makeDiscoveredModel(this.providerId, m.id, {
        // OpenCode is a proxy — models come from various providers.
        // Uses OpenAI-compatible API.
        api: "openai-completions",
        capabilities: {
          streaming: true,
          toolCalling: true,
        },
      }),
    );
  }
}
