// src/core/model-discovery/__tests__/service.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { ModelDiscoveryService } from "../service.js";
import type { ProviderAdapter, DiscoveredModel } from "../types.js";
import { PROVIDER_CATALOG } from "../../../lib/provider-catalog.js";
import { MODEL_CATALOG } from "../../../runtime/provider/models.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create an in-memory DB with the discovery tables. */
function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE discovered_models (
      provider_id   TEXT NOT NULL,
      model_id      TEXT NOT NULL,
      name          TEXT NOT NULL,
      api           TEXT NOT NULL,
      capabilities  TEXT NOT NULL DEFAULT '{}',
      cost          TEXT NOT NULL DEFAULT '{}',
      discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (provider_id, model_id)
    );
    CREATE TABLE discovery_status (
      provider_id    TEXT PRIMARY KEY,
      last_success   TEXT,
      last_error     TEXT,
      model_count    INTEGER DEFAULT 0
    );
    CREATE TABLE named_api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      provider_id TEXT NOT NULL,
      encrypted_api_key TEXT NOT NULL,
      default_model TEXT NOT NULL,
      base_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function makeDiscoveredModel(
  providerId: string,
  id: string,
  overrides?: Partial<DiscoveredModel>,
): DiscoveredModel {
  return {
    id,
    providerId,
    name: id,
    api: "anthropic-messages",
    capabilities: { streaming: true, toolCalling: true },
    cost: { inputPerMillion: 10, outputPerMillion: 50 },
    discoveredAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Mock crypto to avoid needing MASTER_ENCRYPTION_KEY
vi.mock("../../../lib/crypto.js", () => ({
  isCryptoAvailable: () => false,
  encrypt: (s: string) => s,
  decrypt: (s: string) => s,
}));

describe("ModelDiscoveryService", () => {
  let db: Database.Database;
  let service: ModelDiscoveryService;

  beforeEach(() => {
    db = createTestDb();
    // Use a very long poll interval so the timer doesn't fire during tests
    service = new ModelDiscoveryService(db, { pollIntervalMs: 999_999_999 });
  });

  afterEach(() => {
    service.stop();
    db.close();
  });

  // -------------------------------------------------------------------------
  // getProviders — static fallback
  // -------------------------------------------------------------------------

  it("returns static PROVIDER_CATALOG when no discovery results", () => {
    const providers = service.getProviders();
    expect(providers.length).toBe(PROVIDER_CATALOG.length);
    // Each should have the same models as the static catalog
    const anthropic = providers.find((p) => p.id === "anthropic");
    const staticAnthropic = PROVIDER_CATALOG.find((p) => p.id === "anthropic");
    expect(anthropic?.models).toEqual(staticAnthropic?.models);
  });

  // -------------------------------------------------------------------------
  // getProviders — merges discovered models
  // -------------------------------------------------------------------------

  it("merges discovered models into provider list", () => {
    // Simulate a discovery result by poking the cache
    const models = [
      makeDiscoveredModel("anthropic", "claude-opus-4-6"),
      makeDiscoveredModel("anthropic", "claude-new-model"),
    ];

    // Access cache via discoverProvider workaround — inject directly
    // @ts-expect-error private access for testing
    service.cache.set("anthropic", {
      providerId: "anthropic",
      models,
      discoveredAt: Date.now(),
      source: "api" as const,
    });

    const providers = service.getProviders();
    const anthropic = providers.find((p) => p.id === "anthropic")!;
    expect(anthropic.models).toContain("anthropic/claude-opus-4-6");
    expect(anthropic.models).toContain("anthropic/claude-new-model");
    // Static models NOT in discovery should NOT appear
    expect(anthropic.models).not.toContain("anthropic/claude-sonnet-4-6");
  });

  // -------------------------------------------------------------------------
  // getProviders — preserves defaultModel when present in discovered
  // -------------------------------------------------------------------------

  it("preserves defaultModel from static if present in discovered list", () => {
    const staticAnthropic = PROVIDER_CATALOG.find((p) => p.id === "anthropic")!;
    const defaultModelId = staticAnthropic.defaultModel.replace("anthropic/", "");

    const models = [makeDiscoveredModel("anthropic", defaultModelId)];
    // @ts-expect-error private access
    service.cache.set("anthropic", {
      providerId: "anthropic",
      models,
      discoveredAt: Date.now(),
      source: "api" as const,
    });

    const anthropic = service.getProviders().find((p) => p.id === "anthropic")!;
    expect(anthropic.defaultModel).toBe(staticAnthropic.defaultModel);
  });

  // -------------------------------------------------------------------------
  // getModelCatalog — enriches with discovered data
  // -------------------------------------------------------------------------

  it("includes both static and discovered models in catalog", () => {
    const discovered = makeDiscoveredModel("anthropic", "brand-new-model", {
      capabilities: { contextWindow: 500_000 },
      cost: { inputPerMillion: 20, outputPerMillion: 100 },
    });

    // @ts-expect-error private access
    service.cache.set("anthropic", {
      providerId: "anthropic",
      models: [discovered],
      discoveredAt: Date.now(),
      source: "api" as const,
    });

    const catalog = service.getModelCatalog();
    // Should contain static entries
    expect(catalog.some((m) => m.id === "claude-opus-4-6" && m.providerId === "anthropic")).toBe(
      true,
    );
    // Should contain new discovered model with defaults filled in
    const newModel = catalog.find(
      (m) => m.id === "brand-new-model" && m.providerId === "anthropic",
    );
    expect(newModel).toBeDefined();
    expect(newModel?.capabilities.contextWindow).toBe(500_000);
    expect(newModel?.cost.inputPerMillion).toBe(20);
    // Default capabilities should be filled
    expect(newModel?.capabilities.streaming).toBe(true);
  });

  // -------------------------------------------------------------------------
  // getModelCatalog — discovered overrides static capabilities
  // -------------------------------------------------------------------------

  it("discovered capabilities override static for existing models", () => {
    const discovered = makeDiscoveredModel("anthropic", "claude-opus-4-6", {
      capabilities: { contextWindow: 1_000_000 },
    });

    // @ts-expect-error private access
    service.cache.set("anthropic", {
      providerId: "anthropic",
      models: [discovered],
      discoveredAt: Date.now(),
      source: "api" as const,
    });

    const catalog = service.getModelCatalog();
    const opus = catalog.find((m) => m.id === "claude-opus-4-6" && m.providerId === "anthropic");
    expect(opus?.capabilities.contextWindow).toBe(1_000_000);
    // Other static capabilities preserved
    expect(opus?.capabilities.vision).toBe(true);
  });

  // -------------------------------------------------------------------------
  // findModel — discovery first, then static
  // -------------------------------------------------------------------------

  it("findModel returns discovered model when available", () => {
    const discovered = makeDiscoveredModel("anthropic", "new-model", {
      cost: { inputPerMillion: 42 },
    });

    // @ts-expect-error private access
    service.cache.set("anthropic", {
      providerId: "anthropic",
      models: [discovered],
      discoveredAt: Date.now(),
      source: "api" as const,
    });

    const found = service.findModel("anthropic", "new-model");
    expect(found).toBeDefined();
    expect(found?.cost.inputPerMillion).toBe(42);
  });

  it("findModel falls back to static catalog", () => {
    const found = service.findModel("anthropic", "claude-sonnet-4-6");
    expect(found).toBeDefined();
    expect(found?.id).toBe("claude-sonnet-4-6");
  });

  it("findModel returns undefined for unknown model", () => {
    expect(service.findModel("anthropic", "nonexistent")).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // DB persistence — cold start
  // -------------------------------------------------------------------------

  it("persists discovered models to DB and loads on cold start", () => {
    // Seed DB with a discovered model
    db.prepare(
      `INSERT INTO discovered_models (provider_id, model_id, name, api, capabilities, cost, discovered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "anthropic",
      "cached-model",
      "Cached Model",
      "anthropic-messages",
      JSON.stringify({ streaming: true, contextWindow: 200_000 }),
      JSON.stringify({ inputPerMillion: 5 }),
      new Date().toISOString(),
    );

    // Create a new service that should load from DB
    const service2 = new ModelDiscoveryService(db, { pollIntervalMs: 999_999_999 });
    // Manually trigger load (normally done in start(), but we skip start to avoid async)
    // @ts-expect-error private access
    service2._loadFromDb();

    const found = service2.findModel("anthropic", "cached-model");
    expect(found).toBeDefined();
    expect(found?.name).toBe("Cached Model");
    expect(found?.capabilities.contextWindow).toBe(200_000);
    service2.stop();
  });

  // -------------------------------------------------------------------------
  // invalidateProvider clears cache
  // -------------------------------------------------------------------------

  it("invalidateProvider clears the cache for a provider", () => {
    // @ts-expect-error private access
    service.cache.set("anthropic", {
      providerId: "anthropic",
      models: [makeDiscoveredModel("anthropic", "test")],
      discoveredAt: Date.now(),
      source: "api" as const,
    });

    // Before invalidation
    expect(service.findModel("anthropic", "test")).toBeDefined();

    // Invalidate — this also triggers re-discovery which will fail (no key), clearing the model
    service.invalidateProvider("anthropic");
    // Cache should be cleared immediately
    // @ts-expect-error private access
    expect(service.cache.has("anthropic")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // static-only providers (kilocode) are never discovered
  // -------------------------------------------------------------------------

  it("static-only providers like kilocode keep their static catalog", () => {
    const providers = service.getProviders();
    const kilocode = providers.find((p) => p.id === "kilocode");
    const staticKilocode = PROVIDER_CATALOG.find((p) => p.id === "kilocode");
    expect(kilocode?.models).toEqual(staticKilocode?.models);
  });
});
