// src/core/config-writer.ts
//
// Classifies config patches and applies them to openclaw.json + .env + DB.

import * as path from "node:path";
import type { ServerConnection } from "../server/connection.js";
import type { Registry } from "./registry.js";
import { PROVIDER_ENV_VARS, PROVIDER_BASE_URLS } from "../lib/providers.js";
import { parseEnv, serializeEnv, deepMerge } from "./config-helpers.js";
import type { ConfigPatch, ChangeClassification, ConfigPatchResult } from "./config-types.js";
import { OpenClawConfigSchema } from "./openclaw-config.schema.js";

// ---------------------------------------------------------------------------
// Classify changes
// ---------------------------------------------------------------------------

// Exception: these gateway sub-fields are hot-reloadable
const GATEWAY_HOT_RELOAD_FIELDS = new Set(["reloadMode", "reloadDebounceMs"]);

/** Classify a config patch: hot-reload, restart, or DB-only */
export function classifyChanges(
  patch: ConfigPatch,
): ChangeClassification & { pairingWarning: boolean } {
  let requiresRestart = false;
  let restartReason: string | null = null;
  let hasFileChanges = false;
  let pairingWarning = false;

  // general.displayName is DB-only; other general fields touch the file
  if (patch.general) {
    const { displayName: _displayName, ...rest } = patch.general;
    if (Object.keys(rest).length > 0) hasFileChanges = true;
  }

  // providers.add/update/remove → hot-reload (models.providers is hot-reloadable)
  if (patch.providers) {
    hasFileChanges = true;
  }

  if (patch.agentDefaults) hasFileChanges = true;
  if (patch.agents) hasFileChanges = true;
  if (patch.channels) hasFileChanges = true;

  // plugins.* → restart required
  if (patch.plugins) {
    hasFileChanges = true;
    requiresRestart = true;
    restartReason = "plugins.* changed — restart required";
  }

  // gateway.* → restart required, except reloadMode and reloadDebounceMs
  if (patch.gateway) {
    hasFileChanges = true;
    const gatewayKeys = Object.keys(patch.gateway);
    const nonHotReloadKeys = gatewayKeys.filter((k) => !GATEWAY_HOT_RELOAD_FIELDS.has(k));
    if (nonHotReloadKeys.length > 0) {
      requiresRestart = true;
      restartReason = `gateway.${nonHotReloadKeys[0]} changed — restart required`;
    }
    // gateway.port change → browser pairing will be lost (localStorage is origin-scoped)
    if (patch.gateway.port !== undefined) {
      pairingWarning = true;
    }
  }

  const dbOnly = !hasFileChanges && patch.general?.displayName !== undefined;

  return {
    requiresRestart,
    hotReloadOnly: hasFileChanges && !requiresRestart,
    dbOnly,
    restartReason,
    pairingWarning,
  };
}

// ---------------------------------------------------------------------------
// Provider detection helper
// ---------------------------------------------------------------------------

/** Detect the current provider from an existing openclaw.json config object. */
function detectCurrentProvider(config: Record<string, unknown>): string {
  const models = config["models"] as Record<string, unknown> | undefined;
  const providers = models?.["providers"] as Record<string, unknown> | undefined;
  if (providers) {
    const ids = Object.keys(providers);
    if (ids.length > 0) return ids[0]!;
  }
  const auth = config["auth"] as Record<string, unknown> | undefined;
  const profiles = auth?.["profiles"] as Record<string, Record<string, unknown>> | undefined;
  if (profiles) {
    for (const profile of Object.values(profiles)) {
      if (profile["provider"]) return profile["provider"] as string;
    }
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Section patch functions
// ---------------------------------------------------------------------------

function applyGeneralSection(
  config: Record<string, unknown>,
  envMap: Map<string, string>,
  patch: ConfigPatch,
  registry: Registry,
  slug: string,
): boolean {
  let envChanged = false;
  const g = patch.general!;

  // displayName → DB only
  if (g.displayName !== undefined) {
    registry.updateInstance(slug, { displayName: g.displayName });
  }

  // defaultModel → agents.defaults.model
  if (g.defaultModel !== undefined) {
    const agentsConf = (config["agents"] ?? {}) as Record<string, unknown>;
    const defaults = (agentsConf["defaults"] ?? {}) as Record<string, unknown>;
    defaults["model"] = { primary: g.defaultModel };
    agentsConf["defaults"] = defaults;
    config["agents"] = agentsConf;
    registry.updateInstance(slug, { defaultModel: g.defaultModel });
  }

  // toolsProfile → tools.profile
  if (g.toolsProfile !== undefined) {
    const tools = (config["tools"] ?? {}) as Record<string, unknown>;
    tools["profile"] = g.toolsProfile;
    config["tools"] = tools;
  }

  // Legacy retro-compat: general.provider / general.apiKey
  if (g.provider !== undefined || g.apiKey !== undefined) {
    const legacyProvider = g.provider ?? detectCurrentProvider(config);
    if (g.apiKey !== undefined) {
      const envVar = PROVIDER_ENV_VARS[legacyProvider] ?? "";
      if (envVar && g.apiKey) {
        envMap.set(envVar, g.apiKey);
        envChanged = true;
      }
    }
  }

  return envChanged;
}

function applyProvidersSection(
  config: Record<string, unknown>,
  envMap: Map<string, string>,
  patch: ConfigPatch,
): boolean {
  let envChanged = false;
  const models = (config["models"] ?? {}) as Record<string, unknown>;
  const providers = (models["providers"] ?? {}) as Record<string, unknown>;
  const auth = (config["auth"] ?? {}) as Record<string, unknown>;
  const profiles = (auth["profiles"] ?? {}) as Record<string, unknown>;

  // ADD
  for (const add of patch.providers!.add ?? []) {
    const envVar = PROVIDER_ENV_VARS[add.id] ?? "";
    if (add.id === "opencode" || add.id === "kilocode") {
      profiles[`${add.id}:default`] = { provider: add.id, mode: "api_key" };
    } else {
      providers[add.id] = {
        apiKey: envVar ? `\${${envVar}}` : "",
        baseUrl: PROVIDER_BASE_URLS[add.id] ?? "",
        models: [],
      };
    }
    if (envVar && add.apiKey) {
      envMap.set(envVar, add.apiKey);
      envChanged = true;
    }
  }

  // UPDATE (API Key only)
  for (const upd of patch.providers!.update ?? []) {
    const envVar = PROVIDER_ENV_VARS[upd.id] ?? "";
    if (envVar && upd.apiKey) {
      envMap.set(envVar, upd.apiKey);
      envChanged = true;
    }
  }

  // REMOVE
  for (const removeId of patch.providers!.remove ?? []) {
    delete providers[removeId];
    for (const [key, profile] of Object.entries(profiles)) {
      if ((profile as Record<string, unknown>)["provider"] === removeId) {
        delete profiles[key];
      }
    }
    const envVar = PROVIDER_ENV_VARS[removeId] ?? "";
    if (envVar) {
      envMap.delete(envVar);
      envChanged = true;
    }
  }

  models["providers"] = providers;
  config["models"] = models;
  auth["profiles"] = profiles;
  config["auth"] = auth;

  return envChanged;
}

function applyAgentDefaultsSection(config: Record<string, unknown>, patch: ConfigPatch): void {
  const agentsConf = (config["agents"] ?? {}) as Record<string, unknown>;
  const defaults = (agentsConf["defaults"] ?? {}) as Record<string, unknown>;
  const ad = patch.agentDefaults!;

  if (ad.workspace !== undefined) defaults["workspace"] = ad.workspace;

  if (ad.subagents) {
    const sub = (defaults["subagents"] ?? {}) as Record<string, unknown>;
    deepMerge(sub, ad.subagents as unknown as Record<string, unknown>);
    defaults["subagents"] = sub;
  }
  if (ad.compaction) {
    const comp = (defaults["compaction"] ?? {}) as Record<string, unknown>;
    deepMerge(comp, ad.compaction as unknown as Record<string, unknown>);
    defaults["compaction"] = comp;
  }
  if (ad.contextPruning) {
    const cp = (defaults["contextPruning"] ?? {}) as Record<string, unknown>;
    deepMerge(cp, ad.contextPruning as unknown as Record<string, unknown>);
    defaults["contextPruning"] = cp;
  }
  if (ad.heartbeat) {
    const hb = (defaults["heartbeat"] ?? {}) as Record<string, unknown>;
    deepMerge(hb, ad.heartbeat as unknown as Record<string, unknown>);
    defaults["heartbeat"] = hb;
  }

  agentsConf["defaults"] = defaults;
  config["agents"] = agentsConf;
}

function applyAgentsSection(config: Record<string, unknown>, patch: ConfigPatch): void {
  const agentsConf = (config["agents"] ?? {}) as Record<string, unknown>;
  const currentList = (agentsConf["list"] ?? []) as Array<Record<string, unknown>>;

  for (const agentPatch of patch.agents!) {
    const existing = currentList.find((a) => a["id"] === agentPatch.id);
    if (existing) {
      if (agentPatch.name !== undefined) existing["name"] = agentPatch.name;
      if (agentPatch.model !== undefined) {
        existing["model"] = agentPatch.model !== null ? { primary: agentPatch.model } : undefined;
      }
      if (agentPatch.identity !== undefined) {
        existing["identity"] = agentPatch.identity;
      }
    }
  }

  agentsConf["list"] = currentList;
  config["agents"] = agentsConf;
}

function applyChannelsSection(
  config: Record<string, unknown>,
  envMap: Map<string, string>,
  patch: ConfigPatch,
): boolean {
  let envChanged = false;
  const channels = (config["channels"] ?? {}) as Record<string, unknown>;
  const telegram = (channels["telegram"] ?? {}) as Record<string, unknown>;
  const tg = patch.channels!.telegram!;

  if (tg.enabled !== undefined) telegram["enabled"] = tg.enabled;
  if (tg.dmPolicy !== undefined) telegram["dmPolicy"] = tg.dmPolicy;
  if (tg.groupPolicy !== undefined) telegram["groupPolicy"] = tg.groupPolicy;
  if (tg.streamMode !== undefined) telegram["streamMode"] = tg.streamMode;

  // botToken → .env
  if (tg.botToken !== undefined) {
    if (tg.botToken) {
      envMap.set("TELEGRAM_BOT_TOKEN", tg.botToken);
      telegram["botToken"] = "${TELEGRAM_BOT_TOKEN}";
    } else {
      envMap.delete("TELEGRAM_BOT_TOKEN");
    }
    envChanged = true;
  }

  channels["telegram"] = telegram;
  config["channels"] = channels;

  return envChanged;
}

function applyPluginsSection(config: Record<string, unknown>, patch: ConfigPatch): void {
  const plugins = (config["plugins"] ?? {}) as Record<string, unknown>;
  const mem0 = (plugins["@mem0/openclaw-mem0"] ?? {}) as Record<string, unknown>;
  const m = patch.plugins!.mem0!;

  if (m.enabled !== undefined) mem0["enabled"] = m.enabled;
  if (m.ollamaUrl !== undefined) {
    const ollama = (mem0["ollama"] ?? {}) as Record<string, unknown>;
    ollama["url"] = m.ollamaUrl;
    mem0["ollama"] = ollama;
  }
  if (m.qdrantHost !== undefined || m.qdrantPort !== undefined) {
    const qdrant = (mem0["qdrant"] ?? {}) as Record<string, unknown>;
    if (m.qdrantHost !== undefined) qdrant["host"] = m.qdrantHost;
    if (m.qdrantPort !== undefined) qdrant["port"] = m.qdrantPort;
    mem0["qdrant"] = qdrant;
  }

  plugins["@mem0/openclaw-mem0"] = mem0;
  config["plugins"] = plugins;
}

function applyGatewaySection(
  config: Record<string, unknown>,
  patch: ConfigPatch,
  registry: Registry,
  slug: string,
): void {
  const gw = (config["gateway"] ?? {}) as Record<string, unknown>;
  const reload = (gw["reload"] ?? {}) as Record<string, unknown>;

  if (patch.gateway!.port !== undefined) {
    gw["port"] = patch.gateway!.port;
    registry.updateInstance(slug, { port: patch.gateway!.port });
  }
  if (patch.gateway!.reloadMode !== undefined) reload["mode"] = patch.gateway!.reloadMode;
  if (patch.gateway!.reloadDebounceMs !== undefined)
    reload["debounceMs"] = patch.gateway!.reloadDebounceMs;

  gw["reload"] = reload;
  config["gateway"] = gw;
}

// ---------------------------------------------------------------------------
// Main patch orchestrator
// ---------------------------------------------------------------------------

/** Apply a config patch to openclaw.json + .env + DB */
export async function applyConfigPatch(
  conn: ServerConnection,
  registry: Registry,
  slug: string,
  configPath: string,
  stateDir: string,
  patch: ConfigPatch,
): Promise<ConfigPatchResult> {
  const warnings: string[] = [];

  // 1. Read current config and parse with Zod schema
  const configRaw = await conn.readFile(configPath);
  // Use a mutable Record for in-place mutations; Zod validates the initial shape
  const config = OpenClawConfigSchema.parse(JSON.parse(configRaw)) as Record<string, unknown>;

  // 2. Read current .env
  const envPath = path.join(stateDir, ".env");
  let envMap = new Map<string, string>();
  try {
    const envRaw = await conn.readFile(envPath);
    envMap = parseEnv(envRaw);
  } catch {
    // .env missing — will create
  }

  let envChanged = false;

  // 3. Apply each section
  if (patch.general) {
    envChanged = applyGeneralSection(config, envMap, patch, registry, slug) || envChanged;
  }
  if (patch.providers) {
    envChanged = applyProvidersSection(config, envMap, patch) || envChanged;
  }
  if (patch.agentDefaults) {
    applyAgentDefaultsSection(config, patch);
  }
  if (patch.agents) {
    applyAgentsSection(config, patch);
  }
  if (patch.channels?.telegram) {
    envChanged = applyChannelsSection(config, envMap, patch) || envChanged;
  }
  if (patch.plugins?.mem0) {
    applyPluginsSection(config, patch);
  }
  if (patch.gateway) {
    applyGatewaySection(config, patch, registry, slug);
  }

  // 4. Classify changes
  const classification = classifyChanges(patch);

  // 5. Write openclaw.json atomically (if file changes needed)
  if (!classification.dbOnly) {
    const tmpPath = configPath + ".tmp";
    const content = JSON.stringify(config, null, 2);
    await conn.writeFile(tmpPath, content);
    // Atomic rename
    await conn.rename(tmpPath, configPath);
  }

  // 6. Write .env if changed
  if (envChanged) {
    const tmpEnvPath = envPath + ".tmp";
    await conn.writeFile(tmpEnvPath, serializeEnv(envMap));
    await conn.rename(tmpEnvPath, envPath);
  }

  return {
    ok: true,
    requiresRestart: classification.requiresRestart,
    hotReloaded: classification.hotReloadOnly,
    warnings,
    restartReason: classification.restartReason ?? undefined,
    pairingWarning: classification.pairingWarning || undefined,
  };
}
