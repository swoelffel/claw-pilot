// src/dashboard/routes/instances/config-builders.ts
// Builder functions for InstanceConfig payloads
import type { ProviderEntry, InstanceConfig } from "./config-schemas.js";
import { PROVIDER_CATALOG } from "../../../lib/provider-catalog.js";
import { PROVIDER_ENV_VARS, PROVIDER_BASE_URLS } from "../../../lib/providers.js";
import { readEnvVar, maskSecret } from "../../../lib/dotenv.js";
import type { RuntimeConfig } from "../../../runtime/index.js";

// ---------------------------------------------------------------------------
// Helper: Build complete InstanceConfig from RuntimeConfig
// ---------------------------------------------------------------------------

export function buildInstanceConfig(
  instance: { display_name?: string | null; default_model?: string | null; port: number },
  config: RuntimeConfig,
  stateDir: string,
): InstanceConfig {
  // Map runtime agents to UI format
  const agents = config.agents.map((a) => ({
    id: a.id,
    name: a.name,
    model: a.model ?? null,
    toolProfile: a.toolProfile ?? "executor",
    ...(a.customTools !== undefined ? { customTools: a.customTools } : {}),
    maxSteps: a.maxSteps ?? 20,
    temperature: a.temperature ?? null,
    thinking: a.thinking?.enabled
      ? { enabled: true, budgetTokens: a.thinking.budgetTokens ?? 10000 }
      : null,
    timeoutMs: a.timeoutMs ?? 300000,
    chunkTimeoutMs: a.chunkTimeoutMs ?? 120000,
    promptMode: a.promptMode ?? "full",
    allowSubAgents: a.allowSubAgents ?? true,
    instructionUrls: a.instructionUrls ?? [],
    bootstrapFiles: a.bootstrapFiles ?? [],
    archetype: a.archetype ?? null,
    autoSelectSkills: a.autoSelectSkills ?? false,
    ...(a.autoSelectSkillsTopN !== undefined
      ? { autoSelectSkillsTopN: a.autoSelectSkillsTopN }
      : {}),
    heartbeat: a.heartbeat?.every
      ? {
          every: a.heartbeat.every,
          ...(a.heartbeat.model !== undefined ? { model: a.heartbeat.model } : {}),
          ...(a.heartbeat.ackMaxChars !== undefined
            ? { ackMaxChars: a.heartbeat.ackMaxChars }
            : {}),
          ...(a.heartbeat.prompt !== undefined ? { prompt: a.heartbeat.prompt } : {}),
          ...(a.heartbeat.activeHours !== undefined
            ? {
                activeHours: {
                  start: a.heartbeat.activeHours.start,
                  end: a.heartbeat.activeHours.end,
                  ...(a.heartbeat.activeHours.tz !== undefined
                    ? { tz: a.heartbeat.activeHours.tz }
                    : {}),
                },
              }
            : {}),
        }
      : null,
  }));

  // Read .env for providers and telegram
  const envPath = `${stateDir}/.env`;

  // Map providers to UI format (enriched ProviderEntry)
  const providers: ProviderEntry[] = config.providers.map((p) => {
    const catalogEntry = PROVIDER_CATALOG.find((c) => c.id === p.id);
    const envVar = PROVIDER_ENV_VARS[p.id] ?? `${p.id.toUpperCase()}_API_KEY`;
    const raw = readEnvVar(envPath, envVar);

    return {
      id: p.id,
      label: catalogEntry?.label ?? p.id,
      envVar,
      apiKeyMasked: raw ? maskSecret(raw) : null,
      apiKeySet: raw !== null && raw.length > 0,
      requiresKey: catalogEntry?.requiresKey ?? true,
      baseUrl: p.baseUrl ?? PROVIDER_BASE_URLS[p.id] ?? null,
      source: "auth" as const,
    };
  });

  // Read botTokenMasked from .env (synchronous — buildInstanceConfig is sync)
  const varName = config.telegram.botTokenEnvVar;
  const telegramRaw = readEnvVar(envPath, varName);
  const botTokenMasked = telegramRaw ? maskSecret(telegramRaw) : null;

  // Map model aliases from RuntimeConfig format to UI format
  const models = (config.models ?? []).map((m) => ({
    id: m.id,
    provider: m.provider,
    model: m.model,
  }));

  return {
    general: {
      displayName: instance.display_name ?? "",
      defaultModel: config.defaultModel,
      port: instance.port,
    },
    providers,
    agentDefaults: {
      compaction: {
        mode: config.compaction.auto ? "auto" : "manual",
        threshold: config.compaction.threshold ?? 0.85,
        reservedTokens: config.compaction.reservedTokens ?? 8000,
      },
      subagents: {
        maxSpawnDepth: config.subagents.maxSpawnDepth ?? 3,
        maxChildrenPerSession: config.subagents.maxChildrenPerSession ?? 5,
        retentionHours: config.subagents.retentionHours ?? 72,
      },
      heartbeat: {},
      defaultInternalModel: config.defaultInternalModel ?? "",
      models,
    },
    agents,
    channels: {
      telegram: {
        enabled: config.telegram.enabled,
        botTokenMasked,
        dmPolicy: config.telegram.dmPolicy ?? "pairing",
        groupPolicy: config.telegram.groupPolicy ?? "allowlist",
      },
    },
    plugins: {
      mem0: null,
    },
    gateway: {
      port: instance.port,
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: Build stub InstanceConfig when runtime.json doesn't exist
// ---------------------------------------------------------------------------

export function buildInstanceConfigStub(instance: {
  display_name?: string | null;
  default_model?: string | null;
  port: number;
}): InstanceConfig {
  return {
    general: {
      displayName: instance.display_name ?? "",
      defaultModel: instance.default_model ?? "anthropic/claude-sonnet-4-5",
      port: instance.port,
    },
    providers: [],
    agentDefaults: {
      compaction: { mode: "auto", threshold: 0.85, reservedTokens: 8000 },
      subagents: { maxSpawnDepth: 3, maxChildrenPerSession: 5, retentionHours: 72 },
      heartbeat: {},
      defaultInternalModel: "",
      models: [],
    },
    agents: [],
    channels: { telegram: null },
    plugins: { mem0: null },
    gateway: { port: instance.port },
  };
}
