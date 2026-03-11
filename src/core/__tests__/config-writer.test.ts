// src/core/__tests__/config-writer.test.ts
//
// Unit tests for applyConfigPatch() — verifies that config patches are
// correctly applied to openclaw.json + .env + DB.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { applyConfigPatch } from "../config-writer.js";
import { MockConnection } from "./mock-connection.js";
import type { ConfigPatch } from "../config-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONFIG_PATH = "/home/openclaw/.openclaw-demo/openclaw.json";
const STATE_DIR = "/home/openclaw/.openclaw-demo";
const ENV_PATH = `${STATE_DIR}/.env`;
const SLUG = "demo";

/** Minimal valid openclaw.json */
function makeMinimalConfig(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify(
    {
      gateway: { port: 18789, bind: "loopback", auth: { mode: "token" } },
      agents: {
        defaults: {
          model: { primary: "anthropic/claude-sonnet-4-6" },
          workspace: "workspace",
        },
      },
      models: {
        providers: {
          anthropic: {
            apiKey: "${ANTHROPIC_API_KEY}",
            baseUrl: "https://api.anthropic.com",
            models: [],
          },
        },
      },
      ...overrides,
    },
    null,
    2,
  );
}

/** Create a mock Registry */
function makeMockRegistry() {
  return {
    updateInstance: vi.fn(),
    getInstance: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("applyConfigPatch", () => {
  let conn: MockConnection;
  let registry: ReturnType<typeof makeMockRegistry>;

  beforeEach(() => {
    conn = new MockConnection();
    registry = makeMockRegistry();
    conn.files.set(CONFIG_PATH, makeMinimalConfig());
  });

  // -------------------------------------------------------------------------
  // 1. general.displayName → DB updated, fichier non modifié (dbOnly)
  // -------------------------------------------------------------------------

  it("general.displayName → DB updated, fichier non modifié (dbOnly)", async () => {
    const originalContent = conn.files.get(CONFIG_PATH)!;
    const patch: ConfigPatch = { general: { displayName: "My Instance" } };

    const result = await applyConfigPatch(
      conn,
      registry as never,
      SLUG,
      CONFIG_PATH,
      STATE_DIR,
      patch,
    );

    expect(result.ok).toBe(true);
    expect(result.requiresRestart).toBe(false);
    expect(result.hotReloaded).toBe(false);
    // DB should be updated
    expect(registry.updateInstance).toHaveBeenCalledWith(SLUG, { displayName: "My Instance" });
    // File should NOT be modified (dbOnly)
    expect(conn.files.get(CONFIG_PATH)).toBe(originalContent);
  });

  // -------------------------------------------------------------------------
  // 2. general.defaultModel → openclaw.json mis à jour, hotReloaded = true
  // -------------------------------------------------------------------------

  it("general.defaultModel → openclaw.json mis à jour, hotReloaded = true", async () => {
    const patch: ConfigPatch = { general: { defaultModel: "openai/gpt-4o" } };

    const result = await applyConfigPatch(
      conn,
      registry as never,
      SLUG,
      CONFIG_PATH,
      STATE_DIR,
      patch,
    );

    expect(result.ok).toBe(true);
    expect(result.hotReloaded).toBe(true);
    expect(result.requiresRestart).toBe(false);

    // File should be updated
    const updatedConfig = JSON.parse(conn.files.get(CONFIG_PATH)!);
    expect(updatedConfig.agents.defaults.model).toEqual({ primary: "openai/gpt-4o" });
    // DB should also be updated
    expect(registry.updateInstance).toHaveBeenCalledWith(SLUG, { defaultModel: "openai/gpt-4o" });
  });

  // -------------------------------------------------------------------------
  // 3. providers.add → provider ajouté dans models.providers
  // -------------------------------------------------------------------------

  it("providers.add → provider ajouté dans models.providers", async () => {
    const patch: ConfigPatch = {
      providers: {
        add: [{ id: "openai", apiKey: "sk-openai-test123456789" }],
      },
    };

    const result = await applyConfigPatch(
      conn,
      registry as never,
      SLUG,
      CONFIG_PATH,
      STATE_DIR,
      patch,
    );

    expect(result.ok).toBe(true);
    expect(result.hotReloaded).toBe(true);

    const updatedConfig = JSON.parse(conn.files.get(CONFIG_PATH)!);
    expect(updatedConfig.models.providers.openai).toBeDefined();
    expect(updatedConfig.models.providers.openai.apiKey).toBe("${OPENAI_API_KEY}");
  });

  // -------------------------------------------------------------------------
  // 4. providers.update → .env mis à jour avec nouvelle API key
  // -------------------------------------------------------------------------

  it("providers.update → .env mis à jour avec nouvelle API key", async () => {
    conn.files.set(ENV_PATH, "ANTHROPIC_API_KEY=sk-ant-old\n");
    const patch: ConfigPatch = {
      providers: {
        update: [{ id: "anthropic", apiKey: "sk-ant-new-key-12345" }],
      },
    };

    const result = await applyConfigPatch(
      conn,
      registry as never,
      SLUG,
      CONFIG_PATH,
      STATE_DIR,
      patch,
    );

    expect(result.ok).toBe(true);
    expect(result.hotReloaded).toBe(true);

    // .env should be updated
    const envContent = conn.files.get(ENV_PATH)!;
    expect(envContent).toContain("ANTHROPIC_API_KEY=sk-ant-new-key-12345");
    expect(envContent).not.toContain("sk-ant-old");
  });

  // -------------------------------------------------------------------------
  // 5. providers.remove → provider supprimé
  // -------------------------------------------------------------------------

  it("providers.remove → provider supprimé", async () => {
    conn.files.set(ENV_PATH, "ANTHROPIC_API_KEY=sk-ant-test\n");
    const patch: ConfigPatch = {
      providers: { remove: ["anthropic"] },
    };

    const result = await applyConfigPatch(
      conn,
      registry as never,
      SLUG,
      CONFIG_PATH,
      STATE_DIR,
      patch,
    );

    expect(result.ok).toBe(true);
    expect(result.hotReloaded).toBe(true);

    const updatedConfig = JSON.parse(conn.files.get(CONFIG_PATH)!);
    expect(updatedConfig.models?.providers?.anthropic).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 6. channels.telegram.enabled = false → telegram.enabled = false dans config
  // -------------------------------------------------------------------------

  it("channels.telegram.enabled = false → telegram.enabled = false dans config", async () => {
    conn.files.set(
      CONFIG_PATH,
      makeMinimalConfig({
        channels: {
          telegram: {
            enabled: true,
            botToken: "${TELEGRAM_BOT_TOKEN}",
            dmPolicy: "pairing",
            groupPolicy: "allowlist",
          },
        },
      }),
    );

    const patch: ConfigPatch = {
      channels: { telegram: { enabled: false } },
    };

    const result = await applyConfigPatch(
      conn,
      registry as never,
      SLUG,
      CONFIG_PATH,
      STATE_DIR,
      patch,
    );

    expect(result.ok).toBe(true);
    expect(result.hotReloaded).toBe(true);

    const updatedConfig = JSON.parse(conn.files.get(CONFIG_PATH)!);
    expect(updatedConfig.channels.telegram.enabled).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 7. gateway.port → requiresRestart = true, pairingWarning = true
  // -------------------------------------------------------------------------

  it("gateway.port → requiresRestart = true, pairingWarning = true", async () => {
    const patch: ConfigPatch = { gateway: { port: 18795 } };

    const result = await applyConfigPatch(
      conn,
      registry as never,
      SLUG,
      CONFIG_PATH,
      STATE_DIR,
      patch,
    );

    expect(result.ok).toBe(true);
    expect(result.requiresRestart).toBe(true);
    expect(result.pairingWarning).toBe(true);
    expect(result.hotReloaded).toBe(false);

    const updatedConfig = JSON.parse(conn.files.get(CONFIG_PATH)!);
    expect(updatedConfig.gateway.port).toBe(18795);
    // DB should be updated with new port
    expect(registry.updateInstance).toHaveBeenCalledWith(SLUG, { port: 18795 });
  });

  // -------------------------------------------------------------------------
  // 8. plugins.mem0 → requiresRestart = true
  // -------------------------------------------------------------------------

  it("plugins.mem0 → requiresRestart = true", async () => {
    const patch: ConfigPatch = {
      plugins: {
        mem0: {
          enabled: true,
          ollamaUrl: "http://127.0.0.1:11434",
          qdrantHost: "127.0.0.1",
          qdrantPort: 6333,
        },
      },
    };

    const result = await applyConfigPatch(
      conn,
      registry as never,
      SLUG,
      CONFIG_PATH,
      STATE_DIR,
      patch,
    );

    expect(result.ok).toBe(true);
    expect(result.requiresRestart).toBe(true);
    expect(result.hotReloaded).toBe(false);

    const updatedConfig = JSON.parse(conn.files.get(CONFIG_PATH)!);
    expect(updatedConfig.plugins?.["@mem0/openclaw-mem0"]).toBeDefined();
    expect(updatedConfig.plugins["@mem0/openclaw-mem0"].enabled).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 9. Round-trip : écriture puis lecture → données cohérentes
  // -------------------------------------------------------------------------

  it("round-trip : écriture puis lecture → données cohérentes", async () => {
    const { readInstanceConfig } = await import("../config-reader.js");

    // Apply a patch
    const patch: ConfigPatch = {
      general: { defaultModel: "openai/gpt-4o" },
      agentDefaults: {
        subagents: { maxConcurrent: 8 },
        compaction: { mode: "manual" },
      },
    };

    await applyConfigPatch(conn, registry as never, SLUG, CONFIG_PATH, STATE_DIR, patch);

    // Read back
    const result = await readInstanceConfig(conn, CONFIG_PATH, STATE_DIR);

    expect(result.general.defaultModel).toBe("openai/gpt-4o");
    expect(result.agentDefaults.subagents.maxConcurrent).toBe(8);
    expect(result.agentDefaults.compaction.mode).toBe("manual");
  });

  // -------------------------------------------------------------------------
  // 10. Config malformée → throw
  // -------------------------------------------------------------------------

  it("config malformée → throw", async () => {
    conn.files.set(CONFIG_PATH, "{ invalid json }");
    const patch: ConfigPatch = { general: { displayName: "Test" } };

    await expect(
      applyConfigPatch(conn, registry as never, SLUG, CONFIG_PATH, STATE_DIR, patch),
    ).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // Bonus: agentDefaults.workspace → mis à jour dans le fichier
  // -------------------------------------------------------------------------

  it("agentDefaults.workspace → mis à jour dans le fichier", async () => {
    const patch: ConfigPatch = {
      agentDefaults: { workspace: "my-workspace" },
    };

    await applyConfigPatch(conn, registry as never, SLUG, CONFIG_PATH, STATE_DIR, patch);

    const updatedConfig = JSON.parse(conn.files.get(CONFIG_PATH)!);
    expect(updatedConfig.agents.defaults.workspace).toBe("my-workspace");
  });

  // -------------------------------------------------------------------------
  // Bonus: providers.add opencode → auth.profiles (pas models.providers)
  // -------------------------------------------------------------------------

  it("providers.add opencode → auth.profiles (pas models.providers)", async () => {
    const patch: ConfigPatch = {
      providers: { add: [{ id: "opencode" }] },
    };

    await applyConfigPatch(conn, registry as never, SLUG, CONFIG_PATH, STATE_DIR, patch);

    const updatedConfig = JSON.parse(conn.files.get(CONFIG_PATH)!);
    expect(updatedConfig.auth?.profiles?.["opencode:default"]).toBeDefined();
    expect(updatedConfig.auth.profiles["opencode:default"].provider).toBe("opencode");
    // Should NOT be in models.providers
    expect(updatedConfig.models?.providers?.opencode).toBeUndefined();
  });
});
