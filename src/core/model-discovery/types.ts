// src/core/model-discovery/types.ts
//
// Types for the dynamic model discovery system.

import type {
  ModelApi,
  ModelCapabilities,
  ModelCost,
  ModelId,
  ProviderId,
} from "../../runtime/types.js";

// ---------------------------------------------------------------------------
// Discovered model — normalized output from a provider adapter
// ---------------------------------------------------------------------------

/** A model discovered from a provider API. Capabilities/cost may be partial. */
export interface DiscoveredModel {
  /** Model identifier WITHOUT provider prefix (e.g. "claude-opus-4-6") */
  id: ModelId;
  providerId: ProviderId;
  name: string;
  api: ModelApi;
  capabilities: Partial<ModelCapabilities>;
  cost: Partial<ModelCost>;
  discoveredAt: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// Discovery result — per-provider cache entry
// ---------------------------------------------------------------------------

export interface ProviderDiscoveryResult {
  providerId: ProviderId;
  models: DiscoveredModel[];
  discoveredAt: number; // ms epoch
  error?: string;
  source: "api" | "cache" | "static";
}

// ---------------------------------------------------------------------------
// Provider adapter interface
// ---------------------------------------------------------------------------

/** Each provider implements this interface to fetch and normalize its model list. */
export interface ProviderAdapter {
  readonly providerId: ProviderId;

  /**
   * Fetch models from the provider API.
   * @param apiKey — decrypted API key (undefined for no-auth providers)
   * @param baseUrl — override base URL (undefined = default)
   */
  discover(apiKey: string | undefined, baseUrl: string | undefined): Promise<DiscoveredModel[]>;
}

// ---------------------------------------------------------------------------
// DB row shapes (for SQLite persistence)
// ---------------------------------------------------------------------------

export interface DiscoveredModelRow {
  provider_id: string;
  model_id: string;
  name: string;
  api: string;
  capabilities: string; // JSON
  cost: string; // JSON
  discovered_at: string;
}

export interface DiscoveryStatusRow {
  provider_id: string;
  last_success: string | null;
  last_error: string | null;
  model_count: number;
}
