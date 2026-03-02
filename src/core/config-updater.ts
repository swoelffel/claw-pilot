// src/core/config-updater.ts
//
// Centralizes reading, writing, and classifying instance configuration changes.
// Follows the same read-modify-write pattern as agent-provisioner.ts.

import * as path from "node:path";
import { z } from "zod/v4";
import type { ServerConnection } from "../server/connection.js";
import type { Registry } from "./registry.js";
import { PROVIDER_ENV_VARS } from "./config-generator.js";
import { PROVIDER_CATALOG } from "../lib/provider-catalog.js";

// ---------------------------------------------------------------------------
// Constants
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
// Types
// ---------------------------------------------------------------------------

/** A single provider entry as returned by the config API */
export interface ProviderEntry {
  id: string;
  label: string;
  envVar: string;
  apiKeyMasked: string | null;
  apiKeySet: boolean;
  requiresKey: boolean;
  baseUrl: string | null;
  source: "models" | "auth";
}

/** Structured config payload returned by GET /api/instances/:slug/config */
export interface InstanceConfigPayload {
  general: {
    displayName: string;
    defaultModel: string;
    port: number;
    toolsProfile: string;
  };
  providers: ProviderEntry[];
  agentDefaults: {
    workspace: string;
    subagents: { maxConcurrent: number; archiveAfterMinutes: number };
    compaction: { mode: string; reserveTokensFloor?: number };
    contextPruning: { mode: string; ttl?: string };
    heartbeat: { every?: string; model?: string; target?: string };
  };
  agents: Array<{
    id: string;
    name: string;
    model: string | null;
    workspace: string;
    identity: { name?: string; emoji?: string; avatar?: string } | null;
  }>;
  channels: {
    telegram: {
      enabled: boolean;
      botTokenMasked: string | null;
      dmPolicy: string;
      groupPolicy: string;
      streamMode?: string;
    } | null;
  };
  plugins: {
    mem0: {
      enabled: boolean;
      ollamaUrl: string;
      qdrantHost: string;
      qdrantPort: number;
    } | null;
  };
  gateway: {
    port: number;
    bind: string;
    authMode: string;
    reloadMode: string;
    reloadDebounceMs: number;
  };
}

/** Partial patch sent by PATCH /api/instances/:slug/config */
export interface ConfigPatch {
  general?: {
    displayName?: string;
    defaultModel?: string;
    toolsProfile?: string;
    // Legacy single-provider fields (retro-compat — still accepted but deprecated)
    provider?: string;
    apiKey?: string;
  };
  providers?: {
    add?: Array<{ id: string; apiKey?: string }>;
    update?: Array<{ id: string; apiKey?: string }>;
    remove?: string[];
  };
  agentDefaults?: {
    workspace?: string;
    subagents?: { maxConcurrent?: number; archiveAfterMinutes?: number };
    compaction?: { mode?: string; reserveTokensFloor?: number };
    contextPruning?: { mode?: string; ttl?: string };
    heartbeat?: { every?: string; model?: string; target?: string };
  };
  agents?: Array<{
    id: string;
    name?: string;
    model?: string | null;
    identity?: { name?: string; emoji?: string; avatar?: string } | null;
  }>;
  channels?: {
    telegram?: {
      enabled?: boolean;
      botToken?: string;
      dmPolicy?: string;
      groupPolicy?: string;
      streamMode?: string;
    };
  };
  plugins?: {
    mem0?: {
      enabled?: boolean;
      ollamaUrl?: string;
      qdrantHost?: string;
      qdrantPort?: number;
    };
  };
  gateway?: {
    reloadMode?: string;
    reloadDebounceMs?: number;
  };
}

/**
 * Runtime Zod schema mirroring ConfigPatch.
 * Used by the dashboard API to validate incoming PATCH bodies.
 * `.strict()` rejects unknown fields to prevent arbitrary data injection.
 */
export const ConfigPatchSchema = z.object({
  general: z.object({
    displayName: z.string().max(100).optional(),
    defaultModel: z.string().optional(),
    toolsProfile: z.string().optional(),
    provider: z.string().optional(),
    apiKey: z.string().optional(),
  }).strict().optional(),
  providers: z.object({
    add: z.array(z.object({ id: z.string(), apiKey: z.string().optional() }).strict()).optional(),
    update: z.array(z.object({ id: z.string(), apiKey: z.string().optional() }).strict()).optional(),
    remove: z.array(z.string()).optional(),
  }).strict().optional(),
  agentDefaults: z.object({
    workspace: z.string().optional(),
    subagents: z.object({
      maxConcurrent: z.number().int().min(1).optional(),
      archiveAfterMinutes: z.number().int().min(0).optional(),
    }).strict().optional(),
    compaction: z.object({
      mode: z.string().optional(),
      reserveTokensFloor: z.number().int().min(0).optional(),
    }).strict().optional(),
    contextPruning: z.object({
      mode: z.string().optional(),
      ttl: z.string().optional(),
    }).strict().optional(),
    heartbeat: z.object({
      every: z.string().optional(),
      model: z.string().optional(),
      target: z.string().optional(),
    }).strict().optional(),
  }).strict().optional(),
  agents: z.array(z.object({
    id: z.string(),
    name: z.string().optional(),
    model: z.string().nullable().optional(),
    identity: z.object({
      name: z.string().optional(),
      emoji: z.string().optional(),
      avatar: z.string().optional(),
    }).strict().nullable().optional(),
  }).strict()).optional(),
  channels: z.object({
    telegram: z.object({
      enabled: z.boolean().optional(),
      botToken: z.string().optional(),
      dmPolicy: z.string().optional(),
      groupPolicy: z.string().optional(),
      streamMode: z.string().optional(),
    }).strict().optional(),
  }).strict().optional(),
  plugins: z.object({
    mem0: z.object({
      enabled: z.boolean().optional(),
      ollamaUrl: z.string().optional(),
      qdrantHost: z.string().optional(),
      qdrantPort: z.number().int().min(1).max(65535).optional(),
    }).strict().optional(),
  }).strict().optional(),
  gateway: z.object({
    reloadMode: z.string().optional(),
    reloadDebounceMs: z.number().int().min(0).optional(),
  }).strict().optional(),
}).strict();

/** Result of classifying which fields require restart vs hot-reload */
export interface ChangeClassification {
  requiresRestart: boolean;
  hotReloadOnly: boolean;
  dbOnly: boolean;
  restartReason: string | null;
}

/** Result of applying a config patch */
export interface ConfigPatchResult {
  ok: boolean;
  restarted: boolean;
  hotReloaded: boolean;
  warnings: string[];
  restartReason?: string;
}

// ---------------------------------------------------------------------------
// Env file helpers
// ---------------------------------------------------------------------------

/** Parse a .env file into a key-value map */
function parseEnv(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx);
    const value = trimmed.slice(eqIdx + 1);
    map.set(key, value);
  }
  return map;
}

/** Serialize a key-value map back to .env format */
function serializeEnv(map: Map<string, string>): string {
  const lines: string[] = [];
  for (const [key, value] of map) {
    lines.push(`${key}=${value}`);
  }
  return lines.join("\n") + "\n";
}

/** Mask a secret value: show first 8 chars + *** + last 4 chars */
function maskSecret(value: string | undefined): string | null {
  if (!value || value.length === 0) return null;
  if (value.length <= 12) return "****";
  return value.slice(0, 8) + "***" + value.slice(-4);
}

// ---------------------------------------------------------------------------
// Deep merge utility
// ---------------------------------------------------------------------------

/**
 * Deep-merge source into target. Arrays are replaced (not merged element-by-element).
 * Only modifies fields present in source; absent fields in target are preserved.
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = target[key];
    if (
      srcVal !== null &&
      typeof srcVal === "object" &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === "object" &&
      !Array.isArray(tgtVal)
    ) {
      target[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>,
      );
    } else {
      target[key] = srcVal;
    }
  }
  return target;
}

// ---------------------------------------------------------------------------
// Read all providers from openclaw.json + .env
// ---------------------------------------------------------------------------

function readProviders(
  config: Record<string, unknown>,
  envMap: Map<string, string>,
): ProviderEntry[] {
  const providerEntries: ProviderEntry[] = [];

  // 1. Read models.providers
  const models = config["models"] as Record<string, unknown> | undefined;
  const modelsProviders = (models?.["providers"] ?? {}) as Record<string, Record<string, unknown>>;

  for (const [providerId, providerConf] of Object.entries(modelsProviders)) {
    const envVar = PROVIDER_ENV_VARS[providerId] ?? "";
    const apiKeyRaw = envVar ? envMap.get(envVar) : undefined;
    const catalogEntry = PROVIDER_CATALOG.find((p) => p.id === providerId);
    providerEntries.push({
      id: providerId,
      label: catalogEntry?.label ?? providerId,
      envVar,
      apiKeyMasked: maskSecret(apiKeyRaw),
      apiKeySet: !!apiKeyRaw,
      requiresKey: catalogEntry?.requiresKey ?? true,
      baseUrl: (providerConf["baseUrl"] as string) ?? null,
      source: "models",
    });
  }

  // 2. Read auth.profiles for opencode/kilocode (if not already in models.providers)
  const auth = config["auth"] as Record<string, unknown> | undefined;
  const authProfiles = (auth?.["profiles"] ?? {}) as Record<string, Record<string, unknown>>;

  for (const [, profile] of Object.entries(authProfiles)) {
    const provider = profile["provider"] as string | undefined;
    if (provider && !providerEntries.some((p) => p.id === provider)) {
      const envVar = PROVIDER_ENV_VARS[provider] ?? "";
      const apiKeyRaw = envVar ? envMap.get(envVar) : undefined;
      const catalogEntry = PROVIDER_CATALOG.find((p) => p.id === provider);
      providerEntries.push({
        id: provider,
        label: catalogEntry?.label ?? provider,
        envVar,
        apiKeyMasked: maskSecret(apiKeyRaw),
        apiKeySet: !!apiKeyRaw,
        requiresKey: catalogEntry?.requiresKey ?? false,
        baseUrl: null,
        source: "auth",
      });
    }
  }

  return providerEntries;
}

// ---------------------------------------------------------------------------
// Read functions
// ---------------------------------------------------------------------------

/** Read openclaw.json + .env and return a structured payload for the frontend */
export async function readInstanceConfig(
  conn: ServerConnection,
  configPath: string,
  stateDir: string,
): Promise<InstanceConfigPayload> {
  // Read openclaw.json
  const configRaw = await conn.readFile(configPath);
  const config = JSON.parse(configRaw) as Record<string, unknown>;

  // Read .env
  const envPath = path.join(stateDir, ".env");
  let envMap = new Map<string, string>();
  try {
    const envRaw = await conn.readFile(envPath);
    envMap = parseEnv(envRaw);
  } catch {
    // .env missing — not fatal
  }

  // Extract all providers
  const providers = readProviders(config, envMap);

  // Extract agents config
  const agentsConf = config["agents"] as Record<string, unknown> | undefined;
  const defaults = agentsConf?.["defaults"] as Record<string, unknown> | undefined;
  const defaultModel = defaults?.["model"] as Record<string, unknown> | string | undefined;
  const defaultModelStr = typeof defaultModel === "object" && defaultModel !== null
    ? (defaultModel["primary"] as string | undefined) ?? ""
    : typeof defaultModel === "string" ? defaultModel : "";

  const defaultSubagents = defaults?.["subagents"] as Record<string, unknown> | undefined;
  const defaultCompaction = defaults?.["compaction"] as Record<string, unknown> | undefined;
  const defaultContextPruning = defaults?.["contextPruning"] as Record<string, unknown> | undefined;
  const defaultHeartbeat = defaults?.["heartbeat"] as Record<string, unknown> | undefined;

  // Extract agents list
  const agentsList = (agentsConf?.["list"] ?? []) as Array<Record<string, unknown>>;
  const agents = agentsList.map((a) => {
    const model = a["model"] as Record<string, unknown> | string | null | undefined;
    const modelStr = typeof model === "object" && model !== null
      ? (model["primary"] as string | undefined) ?? null
      : typeof model === "string" ? model : null;
    const identity = a["identity"] as Record<string, string> | null | undefined;
    return {
      id: a["id"] as string,
      name: a["name"] as string ?? a["id"] as string,
      model: modelStr,
      workspace: (a["workspace"] as string) ?? `workspace-${a["id"]}`,
      identity: identity ? {
        name: identity["name"],
        emoji: identity["emoji"],
        avatar: identity["avatar"],
      } : null,
    };
  });

  // Extract tools
  const tools = config["tools"] as Record<string, unknown> | undefined;
  const toolsProfile = (tools?.["profile"] as string) ?? "coding";

  // Extract gateway
  const gateway = config["gateway"] as Record<string, unknown> | undefined;
  const gwAuth = gateway?.["auth"] as Record<string, unknown> | undefined;
  const gwReload = gateway?.["reload"] as Record<string, unknown> | undefined;

  // Extract channels
  const channels = config["channels"] as Record<string, unknown> | undefined;
  const telegram = channels?.["telegram"] as Record<string, unknown> | undefined;
  let telegramPayload: InstanceConfigPayload["channels"]["telegram"] = null;
  if (telegram) {
    const botTokenRaw = envMap.get("TELEGRAM_BOT_TOKEN");
    telegramPayload = {
      enabled: telegram["enabled"] !== false,
      botTokenMasked: maskSecret(botTokenRaw),
      dmPolicy: (telegram["dmPolicy"] as string) ?? "pairing",
      groupPolicy: (telegram["groupPolicy"] as string) ?? "allowlist",
      streamMode: telegram["streamMode"] as string | undefined,
    };
  }

  // Extract plugins
  const plugins = config["plugins"] as Record<string, unknown> | undefined;
  const mem0 = plugins?.["@mem0/openclaw-mem0"] as Record<string, unknown> | undefined;
  let mem0Payload: InstanceConfigPayload["plugins"]["mem0"] = null;
  if (mem0) {
    const ollama = mem0["ollama"] as Record<string, unknown> | undefined;
    const qdrant = mem0["qdrant"] as Record<string, unknown> | undefined;
    mem0Payload = {
      enabled: mem0["enabled"] !== false,
      ollamaUrl: (ollama?.["url"] as string) ?? "http://127.0.0.1:11434",
      qdrantHost: (qdrant?.["host"] as string) ?? "127.0.0.1",
      qdrantPort: (qdrant?.["port"] as number) ?? 6333,
    };
  }

  return {
    general: {
      displayName: "", // Will be enriched from DB by the route handler
      defaultModel: defaultModelStr,
      port: (gateway?.["port"] as number) ?? 0,
      toolsProfile,
    },
    providers,
    agentDefaults: {
      workspace: (defaults?.["workspace"] as string) ?? "workspace",
      subagents: {
        maxConcurrent: (defaultSubagents?.["maxConcurrent"] as number) ?? 4,
        archiveAfterMinutes: (defaultSubagents?.["archiveAfterMinutes"] as number) ?? 60,
      },
      compaction: {
        mode: (defaultCompaction?.["mode"] as string) ?? "auto",
        reserveTokensFloor: defaultCompaction?.["reserveTokensFloor"] as number | undefined,
      },
      contextPruning: {
        mode: (defaultContextPruning?.["mode"] as string) ?? "off",
        ttl: defaultContextPruning?.["ttl"] as string | undefined,
      },
      heartbeat: {
        every: defaultHeartbeat?.["every"] as string | undefined,
        model: defaultHeartbeat?.["model"] as string | undefined,
        target: defaultHeartbeat?.["target"] as string | undefined,
      },
    },
    agents,
    channels: { telegram: telegramPayload },
    plugins: { mem0: mem0Payload },
    gateway: {
      port: (gateway?.["port"] as number) ?? 0,
      bind: (gateway?.["bind"] as string) ?? "loopback",
      authMode: (gwAuth?.["mode"] as string) ?? "token",
      reloadMode: (gwReload?.["mode"] as string) ?? "hybrid",
      reloadDebounceMs: (gwReload?.["debounceMs"] as number) ?? 500,
    },
  };
}

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
