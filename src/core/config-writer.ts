// src/core/config-writer.ts
//
// Classifies config patches and applies them to openclaw.json + .env + DB.

import * as path from "node:path";
import type { ServerConnection } from "../server/connection.js";
import type { Registry } from "./registry.js";
import { PROVIDER_ENV_VARS } from "./config-generator.js";
import { parseEnv, serializeEnv, deepMerge } from "./config-helpers.js";
import type { ConfigPatch, ChangeClassification, ConfigPatchResult } from "./config-types.js";

// ---------------------------------------------------------------------------
// Classify changes
// ---------------------------------------------------------------------------

// Exception: these gateway sub-fields are hot-reloadable
const GATEWAY_HOT_RELOAD_FIELDS = new Set(["reloadMode", "reloadDebounceMs"]);

/** Classify a config patch: hot-reload, restart, or DB-only */
export function classifyChanges(patch: ConfigPatch): ChangeClassification {
  let requiresRestart = false;
  let restartReason: string | null = null;
  let hasFileChanges = false;

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
  }

  const dbOnly = !hasFileChanges && patch.general?.displayName !== undefined;

  return {
    requiresRestart,
    hotReloadOnly: hasFileChanges && !requiresRestart,
    dbOnly,
    restartReason,
  };
}

// ---------------------------------------------------------------------------
// Provider base URLs (used when adding a new provider)
// ---------------------------------------------------------------------------

const PROVIDER_BASE_URLS: Record<string, string> = {
  anthropic:  "https://api.anthropic.com",
  openai:     "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  google:     "https://generativelanguage.googleapis.com/v1beta",
  mistral:    "https://api.mistral.ai/v1",
  xai:        "https://api.x.ai/v1",
};

// ---------------------------------------------------------------------------
// Patch functions
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

  // 1. Read current config
  const configRaw = await conn.readFile(configPath);
  const config = JSON.parse(configRaw) as Record<string, unknown>;

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

  // 3. Apply general section
  if (patch.general) {
    const g = patch.general;

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
    // Treat as providers.update for the given provider
    if (g.provider !== undefined || g.apiKey !== undefined) {
      const legacyProvider = g.provider ?? (() => {
        // Detect current provider from config
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
      })();

      if (g.apiKey !== undefined) {
        const envVar = PROVIDER_ENV_VARS[legacyProvider] ?? "";
        if (envVar && g.apiKey) {
          envMap.set(envVar, g.apiKey);
          envChanged = true;
        }
      }
    }
  }

  // 4. Apply providers section (new multi-provider format)
  if (patch.providers) {
    const models = (config["models"] ?? {}) as Record<string, unknown>;
    const providers = (models["providers"] ?? {}) as Record<string, unknown>;
    const auth = (config["auth"] ?? {}) as Record<string, unknown>;
    const profiles = (auth["profiles"] ?? {}) as Record<string, unknown>;

    // ADD
    for (const add of patch.providers.add ?? []) {
      const envVar = PROVIDER_ENV_VARS[add.id] ?? "";
      if (add.id === "opencode" || add.id === "kilocode") {
        // auth.profiles
        profiles[`${add.id}:default`] = { provider: add.id, mode: "api_key" };
      } else {
        // models.providers
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
    for (const upd of patch.providers.update ?? []) {
      const envVar = PROVIDER_ENV_VARS[upd.id] ?? "";
      if (envVar && upd.apiKey) {
        envMap.set(envVar, upd.apiKey);
        envChanged = true;
      }
    }

    // REMOVE
    for (const removeId of patch.providers.remove ?? []) {
      delete providers[removeId];
      // Also remove from auth.profiles
      for (const [key, profile] of Object.entries(profiles)) {
        if ((profile as Record<string, unknown>)["provider"] === removeId) {
          delete profiles[key];
        }
      }
      // Remove env var
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
  }

  // 5. Apply agentDefaults section
  if (patch.agentDefaults) {
    const agentsConf = (config["agents"] ?? {}) as Record<string, unknown>;
    const defaults = (agentsConf["defaults"] ?? {}) as Record<string, unknown>;

    if (patch.agentDefaults.workspace !== undefined) {
      defaults["workspace"] = patch.agentDefaults.workspace;
    }

    if (patch.agentDefaults.subagents) {
      const sub = (defaults["subagents"] ?? {}) as Record<string, unknown>;
      deepMerge(sub, patch.agentDefaults.subagents as unknown as Record<string, unknown>);
      defaults["subagents"] = sub;
    }

    if (patch.agentDefaults.compaction) {
      const comp = (defaults["compaction"] ?? {}) as Record<string, unknown>;
      deepMerge(comp, patch.agentDefaults.compaction as unknown as Record<string, unknown>);
      defaults["compaction"] = comp;
    }

    if (patch.agentDefaults.contextPruning) {
      const cp = (defaults["contextPruning"] ?? {}) as Record<string, unknown>;
      deepMerge(cp, patch.agentDefaults.contextPruning as unknown as Record<string, unknown>);
      defaults["contextPruning"] = cp;
    }

    if (patch.agentDefaults.heartbeat) {
      const hb = (defaults["heartbeat"] ?? {}) as Record<string, unknown>;
      deepMerge(hb, patch.agentDefaults.heartbeat as unknown as Record<string, unknown>);
      defaults["heartbeat"] = hb;
    }

    agentsConf["defaults"] = defaults;
    config["agents"] = agentsConf;
  }

  // 6. Apply agents list changes
  if (patch.agents) {
    const agentsConf = (config["agents"] ?? {}) as Record<string, unknown>;
    const currentList = (agentsConf["list"] ?? []) as Array<Record<string, unknown>>;

    for (const agentPatch of patch.agents) {
      const existing = currentList.find((a) => a["id"] === agentPatch.id);
      if (existing) {
        if (agentPatch.name !== undefined) existing["name"] = agentPatch.name;
        if (agentPatch.model !== undefined) {
          existing["model"] = agentPatch.model !== null
            ? { primary: agentPatch.model }
            : undefined;
        }
        if (agentPatch.identity !== undefined) {
          existing["identity"] = agentPatch.identity;
        }
      }
    }

    agentsConf["list"] = currentList;
    config["agents"] = agentsConf;
  }

  // 7. Apply channels section
  if (patch.channels?.telegram) {
    const channels = (config["channels"] ?? {}) as Record<string, unknown>;
    const telegram = (channels["telegram"] ?? {}) as Record<string, unknown>;
    const tg = patch.channels.telegram;

    if (tg.enabled !== undefined) telegram["enabled"] = tg.enabled;
    if (tg.dmPolicy !== undefined) telegram["dmPolicy"] = tg.dmPolicy;
    if (tg.groupPolicy !== undefined) telegram["groupPolicy"] = tg.groupPolicy;
    if (tg.streamMode !== undefined) telegram["streamMode"] = tg.streamMode;

    // botToken → .env
    if (tg.botToken !== undefined) {
      if (tg.botToken) {
        envMap.set("TELEGRAM_BOT_TOKEN", tg.botToken);
        // Ensure config references the env var
        telegram["botToken"] = "${TELEGRAM_BOT_TOKEN}";
      } else {
        envMap.delete("TELEGRAM_BOT_TOKEN");
      }
      envChanged = true;
    }

    channels["telegram"] = telegram;
    config["channels"] = channels;
  }

  // 8. Apply plugins section
  if (patch.plugins?.mem0) {
    const plugins = (config["plugins"] ?? {}) as Record<string, unknown>;
    const mem0 = (plugins["@mem0/openclaw-mem0"] ?? {}) as Record<string, unknown>;
    const m = patch.plugins.mem0;

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

  // 9. Apply gateway section (only hot-reloadable fields)
  if (patch.gateway) {
    const gw = (config["gateway"] ?? {}) as Record<string, unknown>;
    const reload = (gw["reload"] ?? {}) as Record<string, unknown>;

    if (patch.gateway.reloadMode !== undefined) reload["mode"] = patch.gateway.reloadMode;
    if (patch.gateway.reloadDebounceMs !== undefined) reload["debounceMs"] = patch.gateway.reloadDebounceMs;

    gw["reload"] = reload;
    config["gateway"] = gw;
  }

  // 10. Classify changes
  const classification = classifyChanges(patch);

  // 11. Write openclaw.json atomically (if file changes needed)
  if (!classification.dbOnly) {
    const tmpPath = configPath + ".tmp";
    const content = JSON.stringify(config, null, 2);
    await conn.writeFile(tmpPath, content);
    // Atomic rename — use execFile to avoid shell injection risks
    await conn.execFile("mv", [tmpPath, configPath]);
  }

  // 12. Write .env if changed
  if (envChanged) {
    const tmpEnvPath = envPath + ".tmp";
    await conn.writeFile(tmpEnvPath, serializeEnv(envMap));
    await conn.execFile("mv", [tmpEnvPath, envPath]);
  }

  return {
    ok: true,
    restarted: classification.requiresRestart,
    hotReloaded: classification.hotReloadOnly,
    warnings,
    restartReason: classification.restartReason ?? undefined,
  };
}
