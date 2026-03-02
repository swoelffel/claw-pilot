// src/core/config-reader.ts
//
// Reads openclaw.json + .env and returns a structured payload for the frontend.

import * as path from "node:path";
import type { ServerConnection } from "../server/connection.js";
import { PROVIDER_ENV_VARS } from "./config-generator.js";
import { PROVIDER_CATALOG } from "../lib/provider-catalog.js";
import { parseEnv, maskSecret } from "./config-helpers.js";
import type { ProviderEntry, InstanceConfigPayload } from "./config-types.js";

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
