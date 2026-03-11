// src/core/__tests__/config-reader.test.ts
//
// Unit tests for readInstanceConfig() — verifies that openclaw.json + .env
// are correctly parsed and returned as a structured InstanceConfigPayload.

import { describe, it, expect, beforeEach } from "vitest";
import { readInstanceConfig } from "../config-reader.js";
import { MockConnection } from "./mock-connection.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONFIG_PATH = "/home/openclaw/.openclaw-demo/openclaw.json";
const STATE_DIR = "/home/openclaw/.openclaw-demo";
const ENV_PATH = `${STATE_DIR}/.env`;

/** Minimal valid openclaw.json */
function makeMinimalConfig(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify(
    {
      gateway: { port: 18789, bind: "loopback", auth: { mode: "token" } },
      agents: {
        defaults: {
          model: "anthropic/claude-sonnet-4-6",
          workspace: "workspace",
        },
      },
      ...overrides,
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("readInstanceConfig", () => {
  let conn: MockConnection;

  beforeEach(() => {
    conn = new MockConnection();
  });

  // -------------------------------------------------------------------------
  // 1. Config minimale valide
  // -------------------------------------------------------------------------

  it("config minimale valide → retourne InstanceConfigPayload correct", async () => {
    conn.files.set(CONFIG_PATH, makeMinimalConfig());

    const result = await readInstanceConfig(conn, CONFIG_PATH, STATE_DIR);

    expect(result.general.port).toBe(18789);
    expect(result.general.defaultModel).toBe("anthropic/claude-sonnet-4-6");
    expect(result.gateway.port).toBe(18789);
    expect(result.gateway.bind).toBe("loopback");
    expect(result.gateway.authMode).toBe("token");
    expect(result.agentDefaults.workspace).toBe("workspace");
    // Defaults for missing fields
    expect(result.agentDefaults.subagents.maxConcurrent).toBe(4);
    expect(result.agentDefaults.subagents.archiveAfterMinutes).toBe(60);
    expect(result.agentDefaults.compaction.mode).toBe("auto");
    expect(result.agentDefaults.contextPruning.mode).toBe("off");
  });

  // -------------------------------------------------------------------------
  // 2. Config avec providers anthropic
  // -------------------------------------------------------------------------

  it("config avec providers anthropic → providers array contient l'entrée anthropic", async () => {
    conn.files.set(
      CONFIG_PATH,
      makeMinimalConfig({
        models: {
          providers: {
            anthropic: {
              apiKey: "${ANTHROPIC_API_KEY}",
              baseUrl: "https://api.anthropic.com",
              models: [],
            },
          },
        },
      }),
    );
    conn.files.set(ENV_PATH, "ANTHROPIC_API_KEY=sk-ant-test1234567890\n");

    const result = await readInstanceConfig(conn, CONFIG_PATH, STATE_DIR);

    expect(result.providers).toHaveLength(1);
    const anthropic = result.providers[0]!;
    expect(anthropic.id).toBe("anthropic");
    expect(anthropic.source).toBe("models");
    expect(anthropic.apiKeySet).toBe(true);
    expect(anthropic.apiKeyMasked).not.toBeNull();
    expect(anthropic.baseUrl).toBe("https://api.anthropic.com");
  });

  // -------------------------------------------------------------------------
  // 3. Config avec auth.profiles (opencode)
  // -------------------------------------------------------------------------

  it("config avec auth.profiles (opencode) → providers array contient opencode", async () => {
    conn.files.set(
      CONFIG_PATH,
      makeMinimalConfig({
        auth: {
          profiles: {
            "opencode:default": { provider: "opencode", mode: "api_key" },
          },
        },
      }),
    );

    const result = await readInstanceConfig(conn, CONFIG_PATH, STATE_DIR);

    const opencode = result.providers.find((p) => p.id === "opencode");
    expect(opencode).toBeDefined();
    expect(opencode?.source).toBe("auth");
  });

  // -------------------------------------------------------------------------
  // 4. Config avec telegram activé
  // -------------------------------------------------------------------------

  it("config avec telegram activé → channels.telegram non null", async () => {
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
    conn.files.set(ENV_PATH, "TELEGRAM_BOT_TOKEN=123456:ABCdef\n");

    const result = await readInstanceConfig(conn, CONFIG_PATH, STATE_DIR);

    expect(result.channels.telegram).not.toBeNull();
    expect(result.channels.telegram?.enabled).toBe(true);
    expect(result.channels.telegram?.dmPolicy).toBe("pairing");
    expect(result.channels.telegram?.groupPolicy).toBe("allowlist");
    expect(result.channels.telegram?.botTokenMasked).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // 5. Config avec mem0 activé
  // -------------------------------------------------------------------------

  it("config avec mem0 activé → plugins.mem0 non null", async () => {
    conn.files.set(
      CONFIG_PATH,
      makeMinimalConfig({
        plugins: {
          "@mem0/openclaw-mem0": {
            enabled: true,
            ollama: { url: "http://127.0.0.1:11434" },
            qdrant: { host: "127.0.0.1", port: 6333 },
          },
        },
      }),
    );

    const result = await readInstanceConfig(conn, CONFIG_PATH, STATE_DIR);

    expect(result.plugins.mem0).not.toBeNull();
    expect(result.plugins.mem0?.enabled).toBe(true);
    expect(result.plugins.mem0?.ollamaUrl).toBe("http://127.0.0.1:11434");
    expect(result.plugins.mem0?.qdrantHost).toBe("127.0.0.1");
    expect(result.plugins.mem0?.qdrantPort).toBe(6333);
  });

  // -------------------------------------------------------------------------
  // 6. .env absent → envMap vide, pas d'erreur
  // -------------------------------------------------------------------------

  it(".env absent → envMap vide, pas d'erreur", async () => {
    conn.files.set(
      CONFIG_PATH,
      makeMinimalConfig({
        models: {
          providers: {
            anthropic: { apiKey: "${ANTHROPIC_API_KEY}", baseUrl: "https://api.anthropic.com" },
          },
        },
      }),
    );
    // No .env file set

    const result = await readInstanceConfig(conn, CONFIG_PATH, STATE_DIR);

    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]!.apiKeySet).toBe(false);
    expect(result.providers[0]!.apiKeyMasked).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 7. .env présent avec ANTHROPIC_API_KEY → apiKeySet = true, apiKeyMasked masqué
  // -------------------------------------------------------------------------

  it(".env présent avec ANTHROPIC_API_KEY → apiKeySet = true, apiKeyMasked masqué", async () => {
    conn.files.set(
      CONFIG_PATH,
      makeMinimalConfig({
        models: {
          providers: {
            anthropic: { apiKey: "${ANTHROPIC_API_KEY}", baseUrl: "https://api.anthropic.com" },
          },
        },
      }),
    );
    conn.files.set(ENV_PATH, "ANTHROPIC_API_KEY=sk-ant-api03-verylongkey1234567890\n");

    const result = await readInstanceConfig(conn, CONFIG_PATH, STATE_DIR);

    const anthropic = result.providers.find((p) => p.id === "anthropic");
    expect(anthropic?.apiKeySet).toBe(true);
    expect(anthropic?.apiKeyMasked).not.toBeNull();
    // Should not contain the full key
    expect(anthropic?.apiKeyMasked).not.toBe("sk-ant-api03-verylongkey1234567890");
    // Should contain masked portion
    expect(anthropic?.apiKeyMasked).toContain("***");
  });

  // -------------------------------------------------------------------------
  // 8. Config malformée (JSON invalide) → throw
  // -------------------------------------------------------------------------

  it("config malformée (JSON invalide) → throw", async () => {
    conn.files.set(CONFIG_PATH, "{ invalid json }");

    await expect(readInstanceConfig(conn, CONFIG_PATH, STATE_DIR)).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // 9. Config sans gateway.port → throw (Zod validation)
  // -------------------------------------------------------------------------

  it("config sans gateway.port → throw (Zod validation)", async () => {
    conn.files.set(
      CONFIG_PATH,
      JSON.stringify({
        gateway: { bind: "loopback" }, // missing port
        agents: { defaults: { model: "anthropic/claude-sonnet-4-6" } },
      }),
    );

    await expect(readInstanceConfig(conn, CONFIG_PATH, STATE_DIR)).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // 10. agents.list présent → agents array inclut les entrées de la liste
  // -------------------------------------------------------------------------

  it("agents.list présent → agents array inclut les entrées de la liste", async () => {
    conn.files.set(
      CONFIG_PATH,
      makeMinimalConfig({
        agents: {
          defaults: {
            model: "anthropic/claude-sonnet-4-6",
            workspace: "workspace",
          },
          list: [
            {
              id: "main",
              name: "Main Agent",
              model: { primary: "anthropic/claude-sonnet-4-6" },
              workspace: "workspace",
            },
            {
              id: "pm",
              name: "Project Manager",
              model: "openai/gpt-4o",
              workspace: "workspace-pm",
            },
          ],
        },
      }),
    );

    const result = await readInstanceConfig(conn, CONFIG_PATH, STATE_DIR);

    expect(result.agents).toHaveLength(2);
    const main = result.agents.find((a) => a.id === "main");
    const pm = result.agents.find((a) => a.id === "pm");
    expect(main).toBeDefined();
    expect(main?.name).toBe("Main Agent");
    expect(pm).toBeDefined();
    expect(pm?.name).toBe("Project Manager");
    expect(pm?.model).toBe("openai/gpt-4o");
  });

  // -------------------------------------------------------------------------
  // Bonus: model as object { primary } is correctly extracted
  // -------------------------------------------------------------------------

  it("model as object { primary } → defaultModelStr correct", async () => {
    conn.files.set(
      CONFIG_PATH,
      JSON.stringify({
        gateway: { port: 18789 },
        agents: {
          defaults: {
            model: { primary: "anthropic/claude-opus-4-5" },
          },
        },
      }),
    );

    const result = await readInstanceConfig(conn, CONFIG_PATH, STATE_DIR);

    expect(result.general.defaultModel).toBe("anthropic/claude-opus-4-5");
  });

  // -------------------------------------------------------------------------
  // Bonus: gateway defaults when fields are missing
  // -------------------------------------------------------------------------

  it("gateway sans reload → reloadMode et reloadDebounceMs ont des valeurs par défaut", async () => {
    conn.files.set(
      CONFIG_PATH,
      JSON.stringify({
        gateway: { port: 18790 },
      }),
    );

    const result = await readInstanceConfig(conn, CONFIG_PATH, STATE_DIR);

    expect(result.gateway.reloadMode).toBe("hybrid");
    expect(result.gateway.reloadDebounceMs).toBe(500);
  });
});
