// src/core/model-discovery/adapters/anthropic.ts
//
// Anthropic model discovery adapter.
// Endpoint: GET /v1/models — requires x-api-key + anthropic-version headers.
// Rich response: capabilities, token limits.

import type { ProviderAdapter, DiscoveredModel } from "../types.js";
import { fetchJson, makeDiscoveredModel } from "./base.js";
import { PROVIDER_BASE_URLS } from "../../../lib/providers.js";

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

interface AnthropicModel {
  id: string;
  display_name: string;
  type: string;
  created_at: string;
}

interface AnthropicListResponse {
  data: AnthropicModel[];
  has_more: boolean;
  first_id?: string;
  last_id?: string;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class AnthropicAdapter implements ProviderAdapter {
  readonly providerId = "anthropic" as const;

  async discover(
    apiKey: string | undefined,
    baseUrl: string | undefined,
  ): Promise<DiscoveredModel[]> {
    if (!apiKey) return [];

    const base = baseUrl ?? PROVIDER_BASE_URLS.anthropic ?? "https://api.anthropic.com";
    const headers: Record<string, string> = {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    };

    const allModels: AnthropicModel[] = [];
    let afterId: string | undefined;

    // Paginate through all models
    for (;;) {
      const url = new URL(`${base}/v1/models`);
      url.searchParams.set("limit", "100");
      if (afterId) url.searchParams.set("after_id", afterId);

      const page = await fetchJson<AnthropicListResponse>(url.toString(), { headers });
      allModels.push(...page.data);

      if (!page.has_more || !page.last_id) break;
      afterId = page.last_id;
    }

    return allModels.map((m) =>
      makeDiscoveredModel(this.providerId, m.id, {
        name: m.display_name || m.id,
        api: "anthropic-messages",
        capabilities: {
          streaming: true,
          toolCalling: true,
          vision: true,
        },
      }),
    );
  }
}
