// src/core/model-discovery/adapters/openai.ts
//
// OpenAI model discovery adapter.
// Endpoint: GET /v1/models — requires Bearer token.
// Poor response: id + owner only. Filters by known model families.

import type { ProviderAdapter, DiscoveredModel } from "../types.js";
import { fetchJson, makeDiscoveredModel } from "./base.js";
import { PROVIDER_BASE_URLS } from "../../../lib/providers.js";

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

interface OpenAIModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

interface OpenAIListResponse {
  object: string;
  data: OpenAIModel[];
}

// ---------------------------------------------------------------------------
// Filtering — only keep known model families relevant for chat + tool calling
// ---------------------------------------------------------------------------

const ALLOWED_PREFIXES = ["gpt-5", "gpt-4", "o3", "o4"];

function isRelevantModel(id: string): boolean {
  // Exclude fine-tuned, deprecated snapshots, internal models
  if (id.includes(":ft-") || id.includes("-instruct") || id.startsWith("ft:")) return false;
  return ALLOWED_PREFIXES.some((prefix) => id.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class OpenAIAdapter implements ProviderAdapter {
  readonly providerId = "openai" as const;

  async discover(
    apiKey: string | undefined,
    baseUrl: string | undefined,
  ): Promise<DiscoveredModel[]> {
    if (!apiKey) return [];

    const base = baseUrl ?? PROVIDER_BASE_URLS.openai ?? "https://api.openai.com/v1";
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
    };

    const response = await fetchJson<OpenAIListResponse>(`${base}/models`, { headers });

    return response.data
      .filter((m) => isRelevantModel(m.id))
      .map((m) =>
        makeDiscoveredModel(this.providerId, m.id, {
          api: "openai-completions",
          capabilities: {
            streaming: true,
            toolCalling: true,
          },
        }),
      );
  }
}
