// src/core/model-discovery/service.ts
//
// ModelDiscoveryService — periodic polling of provider APIs to discover available models.
//
// Architecture:
// - In-memory cache (Map<ProviderId, ProviderDiscoveryResult>) for fast access
// - SQLite persistence (discovered_models / discovery_status) for cold-start
// - setInterval polling (24h default), same pattern as Monitor
// - Fallback to PROVIDER_CATALOG static data when discovery fails or has no results
//
// Events:
// - start() — loads from DB + triggers immediate discoverAll()
// - invalidateProvider(id) — called by named-keys routes on CRUD

import type Database from "better-sqlite3";

import type { ModelInfo, ProviderId, ModelCapabilities, ModelCost } from "../../runtime/types.js";
import type { ProviderInfo } from "../../lib/provider-catalog.js";
import type {
  DiscoveredModel,
  DiscoveredModelRow,
  ProviderAdapter,
  ProviderDiscoveryResult,
} from "./types.js";
import { PROVIDER_CATALOG } from "../../lib/provider-catalog.js";
import { MODEL_CATALOG } from "../../runtime/provider/models.js";
import { PROVIDER_ENV_VARS } from "../../lib/providers.js";
import { isCryptoAvailable } from "../../lib/crypto.js";
import { getSecretProvider } from "../secrets/index.js";
import { NamedKeyRepository } from "../repositories/named-key-repository.js";
import { logger } from "../../lib/logger.js";
import { constants } from "../../lib/constants.js";

// Adapters
import { AnthropicAdapter } from "./adapters/anthropic.js";
import { OpenAIAdapter } from "./adapters/openai.js";
import { GoogleAdapter } from "./adapters/google.js";
import { MistralAdapter } from "./adapters/mistral.js";
import { XaiAdapter } from "./adapters/xai.js";
import { OpenRouterAdapter } from "./adapters/openrouter.js";
import { OllamaAdapter } from "./adapters/ollama.js";
import { OpenCodeAdapter } from "./adapters/opencode.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Providers that don't need an API key for discovery. */
const NO_AUTH_PROVIDERS = new Set(["openrouter", "ollama", "opencode"]);

/** Providers that have no discovery endpoint (keep static). */
const STATIC_ONLY_PROVIDERS = new Set(["kilocode"]);

/** Default capabilities for models with no capability data. */
const DEFAULT_CAPABILITIES: ModelCapabilities = {
  streaming: true,
  toolCalling: true,
  vision: false,
  reasoning: false,
  contextWindow: 128_000,
  maxOutputTokens: 8_192,
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface ModelDiscoveryServiceOptions {
  pollIntervalMs?: number;
}

export class ModelDiscoveryService {
  private readonly db: Database.Database;
  private readonly cache = new Map<ProviderId, ProviderDiscoveryResult>();
  private readonly adapters: Map<ProviderId, ProviderAdapter>;
  private readonly pollIntervalMs: number;
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(db: Database.Database, opts?: ModelDiscoveryServiceOptions) {
    this.db = db;
    this.pollIntervalMs = opts?.pollIntervalMs ?? constants.MODEL_DISCOVERY_POLL_INTERVAL_MS;

    // Register all adapters
    const adapterList: ProviderAdapter[] = [
      new AnthropicAdapter(),
      new OpenAIAdapter(),
      new GoogleAdapter(),
      new MistralAdapter(),
      new XaiAdapter(),
      new OpenRouterAdapter(),
      new OllamaAdapter(),
      new OpenCodeAdapter(),
    ];
    this.adapters = new Map(adapterList.map((a) => [a.providerId, a]));
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Start the discovery polling timer and trigger an immediate discovery. */
  start(): void {
    // 1. Load from DB for cold-start
    this._loadFromDb();

    // 2. Trigger immediate discovery (non-blocking)
    void this.discoverAll();

    // 3. Start periodic polling
    this.interval = setInterval(() => {
      void this.discoverAll();
    }, this.pollIntervalMs);
    if (this.interval.unref) this.interval.unref();
  }

  /** Stop the polling timer. */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  // -------------------------------------------------------------------------
  // Discovery
  // -------------------------------------------------------------------------

  /** Discover models from all providers in parallel. */
  async discoverAll(): Promise<void> {
    const providerIds = [...this.adapters.keys()];
    const results = await Promise.allSettled(providerIds.map((id) => this.discoverProvider(id)));

    let totalModels = 0;
    let errors = 0;
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        totalModels += r.value.models.length;
      } else {
        errors++;
      }
    }

    logger.debug(
      `Model discovery: ${totalModels} models from ${providerIds.length - errors} providers (${errors} errors)`,
    );
  }

  /** Discover models from a single provider. Returns the result or null on error. */
  async discoverProvider(providerId: ProviderId): Promise<ProviderDiscoveryResult | null> {
    if (STATIC_ONLY_PROVIDERS.has(providerId)) return null;

    const adapter = this.adapters.get(providerId);
    if (!adapter) return null;

    try {
      // Resolve API key
      const { apiKey, baseUrl } = await this._resolveCredentials(providerId);

      // Skip auth-requiring providers without a key
      if (!NO_AUTH_PROVIDERS.has(providerId) && !apiKey) {
        return null;
      }

      const models = await adapter.discover(apiKey, baseUrl);

      const result: ProviderDiscoveryResult = {
        providerId,
        models,
        discoveredAt: Date.now(),
        source: "api",
      };

      this.cache.set(providerId, result);
      this._persistToDb(providerId, models);
      this._updateStatus(providerId, models.length, null);

      logger.debug(`Model discovery [${providerId}]: ${models.length} models`);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`Model discovery [${providerId}] failed: ${message}`);
      this._updateStatus(providerId, null, message);

      // Keep existing cache on error (stale is better than empty)
      return this.cache.get(providerId) ?? null;
    }
  }

  /**
   * Invalidate cache for a provider and trigger immediate re-discovery.
   * Called by named-keys routes after create/update/delete.
   */
  invalidateProvider(providerId: ProviderId): void {
    this.cache.delete(providerId);
    void this.discoverProvider(providerId);
  }

  // -------------------------------------------------------------------------
  // Public getters — merge static + discovered
  // -------------------------------------------------------------------------

  /**
   * Get the provider list for the UI (same shape as PROVIDER_CATALOG).
   * Merges static catalog with discovered models.
   */
  getProviders(): ProviderInfo[] {
    return PROVIDER_CATALOG.map((staticProvider) => {
      const discovered = this.cache.get(staticProvider.id);

      // No discovery results — return static as-is
      if (!discovered || discovered.models.length === 0) {
        return { ...staticProvider, models: [...staticProvider.models] };
      }

      // Build model list from discovered models (prefixed with provider/)
      const discoveredModels = discovered.models.map((m) => `${staticProvider.id}/${m.id}`);

      // Keep defaultModel if it's in the discovered list, otherwise pick first
      const defaultModel = discoveredModels.includes(staticProvider.defaultModel)
        ? staticProvider.defaultModel
        : (discoveredModels[0] ?? staticProvider.defaultModel);

      return {
        ...staticProvider,
        models: discoveredModels,
        defaultModel,
      };
    });
  }

  /**
   * Get the enriched MODEL_CATALOG for runtime use.
   * Merges static MODEL_CATALOG with discovered model data.
   */
  getModelCatalog(): ModelInfo[] {
    const result = new Map<string, ModelInfo>();

    // 1. Seed with static catalog
    for (const m of MODEL_CATALOG) {
      result.set(`${m.providerId}/${m.id}`, m);
    }

    // 2. Overlay discovered models
    for (const [, discovery] of this.cache) {
      for (const dm of discovery.models) {
        const key = `${dm.providerId}/${dm.id}`;
        const existing = result.get(key);

        if (existing) {
          // Merge: discovered data enriches static (discovered wins where present)
          result.set(key, this._mergeModelInfo(existing, dm));
        } else {
          // New model: create ModelInfo from discovered data + defaults
          result.set(key, this._toModelInfo(dm));
        }
      }
    }

    return [...result.values()];
  }

  /** Lookup a single model, checking discovery cache first, then static catalog. */
  findModel(providerId: ProviderId, modelId: string): ModelInfo | undefined {
    const _key = `${providerId}/${modelId}`;

    // Check discovered
    const discovery = this.cache.get(providerId);
    if (discovery) {
      const dm = discovery.models.find((m) => m.id === modelId);
      if (dm) {
        // Check if there's a static entry to merge with
        const staticEntry = MODEL_CATALOG.find(
          (m) => m.providerId === providerId && m.id === modelId,
        );
        return staticEntry ? this._mergeModelInfo(staticEntry, dm) : this._toModelInfo(dm);
      }
    }

    // Fallback to static
    return MODEL_CATALOG.find((m) => m.providerId === providerId && m.id === modelId);
  }

  // -------------------------------------------------------------------------
  // Private — credential resolution
  // -------------------------------------------------------------------------

  private async _resolveCredentials(providerId: ProviderId): Promise<{
    apiKey: string | undefined;
    baseUrl: string | undefined;
  }> {
    let apiKey: string | undefined;
    let baseUrl: string | undefined;

    // 1. Try named API keys (if crypto is available)
    if (isCryptoAvailable()) {
      try {
        const repo = new NamedKeyRepository(this.db);
        const keys = repo.listAll();
        const providerKey = keys.find((k) => k.providerId === providerId);
        if (providerKey) {
          apiKey = repo.decryptApiKey(providerKey.id);
          baseUrl = providerKey.baseUrl ?? undefined;
        }
      } catch (err) {
        logger.debug("[service] named key resolution failed, falling back to env vars", {
          error: String(err),
        });
      }
    }

    // 2. Fallback to env vars — resolved via SecretProvider (R5). The env
    //    provider reads process.env first, preserving the legacy lookup.
    if (!apiKey) {
      const envVar = PROVIDER_ENV_VARS[providerId];
      if (envVar) {
        const provider = getSecretProvider();
        if (await provider.has(envVar)) {
          apiKey = await provider.get(envVar);
        }
      }
    }

    return { apiKey, baseUrl };
  }

  // -------------------------------------------------------------------------
  // Private — DB persistence (cold-start cache)
  // -------------------------------------------------------------------------

  private _loadFromDb(): void {
    try {
      const rows = this.db.prepare("SELECT * FROM discovered_models").all() as DiscoveredModelRow[];

      // Group by provider_id
      const grouped = new Map<string, DiscoveredModel[]>();
      for (const row of rows) {
        if (!grouped.has(row.provider_id)) {
          grouped.set(row.provider_id, []);
        }
        grouped.get(row.provider_id)!.push({
          id: row.model_id,
          providerId: row.provider_id,
          name: row.name,
          api: row.api as DiscoveredModel["api"],
          capabilities: JSON.parse(row.capabilities) as Partial<ModelCapabilities>,
          cost: JSON.parse(row.cost) as Partial<ModelCost>,
          discoveredAt: row.discovered_at,
        });
      }

      for (const [providerId, models] of grouped) {
        this.cache.set(providerId, {
          providerId,
          models,
          discoveredAt: Date.now(),
          source: "cache",
        });
      }

      if (rows.length > 0) {
        logger.debug(`Model discovery: loaded ${rows.length} models from DB cache`);
      }
    } catch (err) {
      logger.debug("[service] failed to load discovered models from DB (migration pending?)", {
        error: String(err),
      });
    }
  }

  private _persistToDb(providerId: ProviderId, models: DiscoveredModel[]): void {
    try {
      const deleteStmt = this.db.prepare("DELETE FROM discovered_models WHERE provider_id = ?");
      const insertStmt = this.db.prepare(
        `INSERT INTO discovered_models (provider_id, model_id, name, api, capabilities, cost, discovered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );

      this.db.transaction(() => {
        deleteStmt.run(providerId);
        for (const m of models) {
          insertStmt.run(
            m.providerId,
            m.id,
            m.name,
            m.api,
            JSON.stringify(m.capabilities),
            JSON.stringify(m.cost),
            m.discoveredAt,
          );
        }
      })();
    } catch (err) {
      logger.error("[service] failed to persist discovered models to DB", { error: String(err) });
    }
  }

  private _updateStatus(
    providerId: ProviderId,
    modelCount: number | null,
    error: string | null,
  ): void {
    try {
      this.db
        .prepare(
          `INSERT INTO discovery_status (provider_id, last_success, last_error, model_count)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(provider_id) DO UPDATE SET
             last_success = COALESCE(excluded.last_success, last_success),
             last_error = excluded.last_error,
             model_count = COALESCE(excluded.model_count, model_count)`,
        )
        .run(providerId, error === null ? new Date().toISOString() : null, error, modelCount);
    } catch (err) {
      logger.error("[service] failed to update discovery status in DB", { error: String(err) });
    }
  }

  // -------------------------------------------------------------------------
  // Private — merge helpers
  // -------------------------------------------------------------------------

  /** Merge a static ModelInfo with discovered data (discovered wins where present). */
  private _mergeModelInfo(existing: ModelInfo, dm: DiscoveredModel): ModelInfo {
    return {
      ...existing,
      capabilities: {
        ...existing.capabilities,
        // Override with discovered values where present
        ...(dm.capabilities.streaming !== undefined && { streaming: dm.capabilities.streaming }),
        ...(dm.capabilities.toolCalling !== undefined && {
          toolCalling: dm.capabilities.toolCalling,
        }),
        ...(dm.capabilities.vision !== undefined && { vision: dm.capabilities.vision }),
        ...(dm.capabilities.reasoning !== undefined && { reasoning: dm.capabilities.reasoning }),
        ...(dm.capabilities.contextWindow !== undefined && {
          contextWindow: dm.capabilities.contextWindow,
        }),
        ...(dm.capabilities.maxOutputTokens !== undefined && {
          maxOutputTokens: dm.capabilities.maxOutputTokens,
        }),
      },
      cost: {
        ...existing.cost,
        ...(dm.cost.inputPerMillion !== undefined && { inputPerMillion: dm.cost.inputPerMillion }),
        ...(dm.cost.outputPerMillion !== undefined && {
          outputPerMillion: dm.cost.outputPerMillion,
        }),
      },
    };
  }

  /** Convert a DiscoveredModel to a full ModelInfo (with defaults for missing fields). */
  private _toModelInfo(dm: DiscoveredModel): ModelInfo {
    return {
      id: dm.id,
      providerId: dm.providerId,
      name: dm.name,
      api: dm.api,
      capabilities: {
        ...DEFAULT_CAPABILITIES,
        ...(dm.capabilities.streaming !== undefined && { streaming: dm.capabilities.streaming }),
        ...(dm.capabilities.toolCalling !== undefined && {
          toolCalling: dm.capabilities.toolCalling,
        }),
        ...(dm.capabilities.vision !== undefined && { vision: dm.capabilities.vision }),
        ...(dm.capabilities.reasoning !== undefined && { reasoning: dm.capabilities.reasoning }),
        ...(dm.capabilities.contextWindow !== undefined && {
          contextWindow: dm.capabilities.contextWindow,
        }),
        ...(dm.capabilities.maxOutputTokens !== undefined && {
          maxOutputTokens: dm.capabilities.maxOutputTokens,
        }),
      },
      cost: {
        inputPerMillion: dm.cost.inputPerMillion ?? 0,
        outputPerMillion: dm.cost.outputPerMillion ?? 0,
      },
    };
  }
}
