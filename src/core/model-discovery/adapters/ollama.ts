// src/core/model-discovery/adapters/ollama.ts
//
// Ollama model discovery adapter.
// Endpoint: GET /api/tags — no auth (local server).
// Lists locally-pulled models with family, quantization, parameter size.

import type { ProviderAdapter, DiscoveredModel } from "../types.js";
import { fetchJson, makeDiscoveredModel } from "./base.js";
import { logger } from "../../../lib/logger.js";

// ---------------------------------------------------------------------------
// API response shapes (native /api/tags endpoint)
// ---------------------------------------------------------------------------

interface OllamaModelDetails {
  family?: string;
  families?: string[];
  parameter_size?: string;
  quantization_level?: string;
  format?: string;
}

interface OllamaModel {
  name: string; // e.g. "deepseek-r1:32b"
  model?: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: OllamaModelDetails;
}

interface OllamaTagsResponse {
  models: OllamaModel[];
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class OllamaAdapter implements ProviderAdapter {
  readonly providerId = "ollama" as const;

  async discover(
    _apiKey: string | undefined,
    baseUrl: string | undefined,
  ): Promise<DiscoveredModel[]> {
    const base = baseUrl ?? "http://localhost:11434";

    let response: OllamaTagsResponse;
    try {
      response = await fetchJson<OllamaTagsResponse>(`${base}/api/tags`);
    } catch (err) {
      logger.warn("[ollama] Ollama not running or unreachable", { error: String(err) });
      return [];
    }

    return response.models.map((m) => {
      const modelId = m.name;
      return makeDiscoveredModel(this.providerId, modelId, {
        name: modelId,
        api: "ollama",
        capabilities: {
          streaming: true,
          // Most modern Ollama models support tool calling
          toolCalling: true,
        },
      });
    });
  }
}
