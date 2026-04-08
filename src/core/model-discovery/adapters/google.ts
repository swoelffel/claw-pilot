// src/core/model-discovery/adapters/google.ts
//
// Google Gemini model discovery adapter.
// Endpoint: GET /v1beta/models?key=... — requires API key as query param.
// Rich response: token limits, supported generation methods.

import type { ProviderAdapter, DiscoveredModel } from "../types.js";
import { fetchJson, makeDiscoveredModel } from "./base.js";
import { PROVIDER_BASE_URLS } from "../../../lib/providers.js";

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

interface GoogleModel {
  name: string; // "models/gemini-2.5-pro"
  displayName: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
  version?: string;
}

interface GoogleListResponse {
  models: GoogleModel[];
  nextPageToken?: string;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class GoogleAdapter implements ProviderAdapter {
  readonly providerId = "google" as const;

  async discover(
    apiKey: string | undefined,
    baseUrl: string | undefined,
  ): Promise<DiscoveredModel[]> {
    if (!apiKey) return [];

    const base =
      baseUrl ?? PROVIDER_BASE_URLS.google ?? "https://generativelanguage.googleapis.com/v1beta";
    const allModels: GoogleModel[] = [];
    let pageToken: string | undefined;

    // Paginate
    for (;;) {
      const url = new URL(`${base}/models`);
      url.searchParams.set("key", apiKey);
      url.searchParams.set("pageSize", "100");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const page = await fetchJson<GoogleListResponse>(url.toString());
      allModels.push(...page.models);

      if (!page.nextPageToken) break;
      pageToken = page.nextPageToken;
    }

    // Filter: only models that support generateContent (= chat/completion)
    return allModels
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => {
        // Extract model ID from "models/gemini-2.5-pro" format
        const modelId = m.name.replace(/^models\//, "");
        return makeDiscoveredModel(this.providerId, modelId, {
          name: m.displayName || modelId,
          api: "google-generative-ai",
          capabilities: {
            streaming: true,
            toolCalling: true,
            ...(m.inputTokenLimit !== undefined && { contextWindow: m.inputTokenLimit }),
            ...(m.outputTokenLimit !== undefined && { maxOutputTokens: m.outputTokenLimit }),
          },
        });
      });
  }
}
