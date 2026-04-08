// src/core/model-discovery/adapters/xai.ts
//
// xAI (Grok) model discovery adapter.
// Endpoint: GET /v1/models — requires Bearer token.
// OpenAI-compatible response with extended fields.

import type { ProviderAdapter, DiscoveredModel } from "../types.js";
import { fetchJson, makeDiscoveredModel } from "./base.js";
import { PROVIDER_BASE_URLS } from "../../../lib/providers.js";

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

interface XaiModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

interface XaiListResponse {
  object: string;
  data: XaiModel[];
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class XaiAdapter implements ProviderAdapter {
  readonly providerId = "xai" as const;

  async discover(
    apiKey: string | undefined,
    baseUrl: string | undefined,
  ): Promise<DiscoveredModel[]> {
    if (!apiKey) return [];

    const base = baseUrl ?? PROVIDER_BASE_URLS.xai ?? "https://api.x.ai/v1";
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
    };

    const response = await fetchJson<XaiListResponse>(`${base}/models`, { headers });

    return response.data.map((m) =>
      makeDiscoveredModel(this.providerId, m.id, {
        // xAI uses OpenAI-compatible API
        api: "openai-completions",
        capabilities: {
          streaming: true,
          toolCalling: true,
        },
      }),
    );
  }
}
