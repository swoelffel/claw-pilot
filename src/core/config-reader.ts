// src/core/config-reader.ts
//
// Reads openclaw.json + .env and returns a structured payload for the frontend.

import * as path from "node:path";
import type { ServerConnection } from "../server/connection.js";
import { PROVIDER_ENV_VARS } from "./config-generator.js";
import { PROVIDER_CATALOG } from "../lib/provider-catalog.js";
import { parseEnv, maskSecret } from "./config-helpers.js";
import type { ProviderEntry, InstanceConfigPayload } from "./config-types.js";
import { OpenClawConfigSchema } from "./openclaw-config.schema.js";

// ---------------------------------------------------------------------------
// Read all providers from openclaw.json + .env
// ---------------------------------------------------------------------------

function readProviders(
  config: ReturnType<typeof OpenClawConfigSchema.parse>,
  envMap: Map<string, string>,
): ProviderEntry[] {
  const providerEntries: ProviderEntry[] = [];

  // 1. Read models.providers
  const modelsProviders = config.models?.providers ?? {};

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
      baseUrl: (providerConf.baseUrl as string | undefined) ?? null,
      source: "models",
    });
  }

  // 2. Read auth.profiles for opencode/kilocode (if not already in models.providers)
  const authProfiles = config.auth?.profiles ?? {};

  for (const [, profile] of Object.entries(authProfiles)) {
    const provider = profile.provider;
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
  // Read openclaw.json and parse with Zod schema
  const configRaw = await conn.readFile(configPath);
  const config = OpenClawConfigSchema.parse(JSON.parse(configRaw));

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
  const agentsConf = config.agents;
  const defaults = agentsConf?.defaults;
  const defaultModel = defaults?.model;
  const defaultModelStr =
    typeof defaultModel === "object" && defaultModel !== null
      ? ((defaultModel as { primary: string }).primary ?? "")
      : typeof defaultModel === "string"
        ? defaultModel
        : "";

  const defaultSubagents = defaults?.subagents;
  const defaultCompaction = defaults?.compaction;
  const defaultContextPruning = defaults?.contextPruning;
  const defaultHeartbeat = defaults?.heartbeat;

  // Extract agents list
  const agentsList = agentsConf?.list ?? [];

  // Synthesize main agent from agents.defaults if not present in agents.list[]
  // (legacy configs or pre-v0.12.6 deployments may omit main from the list)
  const hasMainInList = agentsList.some((a) => a.id === "main");
  const mainEntry = hasMainInList
    ? []
    : [
        {
          id: "main",
          name: defaults?.name ?? "Main",
          model: defaultModelStr || null,
          workspace: defaults?.workspace ?? "workspace",
          identity: null,
        },
      ];

  const agents = [
    ...mainEntry,
    ...agentsList.map((a) => {
      const model = a.model;
      const modelStr =
        typeof model === "object" && model !== null
          ? ((model as { primary: string }).primary ?? null)
          : typeof model === "string"
            ? model
            : null;
      const identity = a.identity;
      return {
        id: a.id,
        name: a.name ?? a.id,
        model: modelStr,
        workspace: a.workspace ?? `workspace-${a.id}`,
        identity: identity
          ? {
              ...(identity.name !== undefined && { name: identity.name }),
              ...(identity.emoji !== undefined && { emoji: identity.emoji }),
              ...(identity.avatar !== undefined && { avatar: identity.avatar }),
            }
          : null,
      };
    }),
  ];

  // Extract tools
  const toolsProfile = config.tools?.profile ?? "coding";

  // Extract gateway
  const gateway = config.gateway;
  const gwAuth = gateway.auth;
  const gwReload = gateway.reload;

  // Extract channels
  const telegram = config.channels?.telegram;
  let telegramPayload: InstanceConfigPayload["channels"]["telegram"] = null;
  if (telegram) {
    const botTokenRaw = envMap.get("TELEGRAM_BOT_TOKEN");
    telegramPayload = {
      enabled: telegram.enabled !== false,
      botTokenMasked: maskSecret(botTokenRaw),
      dmPolicy: telegram.dmPolicy ?? "pairing",
      groupPolicy: telegram.groupPolicy ?? "allowlist",
      ...(telegram.streamMode !== undefined && { streamMode: telegram.streamMode }),
    };
  }

  // Extract plugins
  const plugins = config.plugins;
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
      port: gateway.port ?? 0,
      toolsProfile,
    },
    providers,
    agentDefaults: {
      workspace: defaults?.workspace ?? "workspace",
      subagents: {
        maxConcurrent: defaultSubagents?.maxConcurrent ?? 4,
        archiveAfterMinutes: defaultSubagents?.archiveAfterMinutes ?? 60,
      },
      compaction: {
        mode: defaultCompaction?.mode ?? "auto",
        ...(defaultCompaction?.reserveTokensFloor !== undefined && {
          reserveTokensFloor: defaultCompaction.reserveTokensFloor,
        }),
      },
      contextPruning: {
        mode: defaultContextPruning?.mode ?? "off",
        ...(defaultContextPruning?.ttl !== undefined && { ttl: defaultContextPruning.ttl }),
      },
      heartbeat: {
        ...(defaultHeartbeat?.every !== undefined && { every: defaultHeartbeat.every }),
        ...(defaultHeartbeat?.model !== undefined && { model: defaultHeartbeat.model }),
        ...(defaultHeartbeat?.target !== undefined && { target: defaultHeartbeat.target }),
      },
    },
    agents,
    channels: { telegram: telegramPayload },
    plugins: { mem0: mem0Payload },
    gateway: {
      port: gateway.port ?? 0,
      bind: gateway.bind ?? "loopback",
      authMode: gwAuth?.mode ?? "token",
      reloadMode: gwReload?.mode ?? "hybrid",
      reloadDebounceMs: gwReload?.debounceMs ?? 500,
    },
  };
}
