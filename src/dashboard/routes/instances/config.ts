// src/dashboard/routes/instances/config.ts
// Routes: GET/PATCH config, providers
import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { instanceGuard } from "../../../lib/guards.js";
import { logger } from "../../../lib/logger.js";
import { PROVIDER_CATALOG } from "../../../lib/provider-catalog.js";
import type { ProviderInfo } from "../../../lib/provider-catalog.js";
import { PROVIDER_ENV_VARS, PROVIDER_BASE_URLS } from "../../../lib/providers.js";
import { getRuntimeStateDir } from "../../../lib/platform.js";
import { readEnvVar, writeEnvVar, removeEnvVar, maskSecret } from "../../../lib/dotenv.js";
import {
  runtimeConfigExists,
  loadRuntimeConfig,
  saveRuntimeConfig,
  createDefaultRuntimeConfig,
  type RuntimeConfig,
} from "../../../runtime/index.js";
import { z } from "zod";

// ProviderEntry — matches ui/src/types.ts
interface ProviderEntry {
  id: string;
  label: string;
  envVar: string;
  apiKeyMasked: string | null;
  apiKeySet: boolean;
  requiresKey: boolean;
  baseUrl: string | null;
  source: "models" | "auth";
}

// InstanceConfig type — matches ui/src/types.ts
interface InstanceConfig {
  general: {
    displayName: string;
    defaultModel: string;
    port: number;
  };
  providers: ProviderEntry[];
  agentDefaults: {
    compaction: { mode: string; threshold: number; reservedTokens: number };
    subagents: { maxSpawnDepth: number; maxChildrenPerSession: number; retentionHours: number };
    heartbeat: { every?: string; model?: string };
    defaultInternalModel: string;
    models: Array<{ id: string; provider: string; model: string }>;
  };
  agents: Array<{
    id: string;
    name: string;
    model: string | null;
    toolProfile: string;
    maxSteps: number;
    temperature: number | null;
    thinking: { enabled: boolean; budgetTokens: number } | null;
    timeoutMs: number;
    chunkTimeoutMs: number;
    promptMode: string;
    allowSubAgents: boolean;
    instructionUrls: string[];
    bootstrapFiles: string[];
    expertIn: string[];
    heartbeat: {
      every?: string;
      model?: string;
      ackMaxChars?: number;
      prompt?: string;
      activeHours?: { start: string; end: string; tz?: string };
    } | null;
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
  };
}

// ---------------------------------------------------------------------------
// Config patch schema for runtime instances
// ---------------------------------------------------------------------------

const RuntimeConfigPatchSchema = z.object({
  general: z
    .object({
      displayName: z.string().optional(),
      defaultModel: z.string().optional(),
    })
    .optional(),
  providers: z
    .object({
      add: z
        .array(
          z.object({
            id: z.string().min(1),
            apiKey: z.string().optional(),
            baseUrl: z.string().url().optional(),
          }),
        )
        .optional(),
      update: z
        .array(
          z.object({
            id: z.string().min(1),
            apiKey: z.string().optional(),
            baseUrl: z.string().url().nullish(),
          }),
        )
        .optional(),
      remove: z.array(z.string().min(1)).optional(),
    })
    .optional(),
  channels: z
    .object({
      telegram: z
        .object({
          enabled: z.boolean().optional(),
          botTokenEnvVar: z.string().optional(),
          pollingIntervalMs: z.number().int().min(0).optional(),
          allowedUserIds: z.array(z.number().int()).optional(),
          dmPolicy: z.enum(["pairing", "open", "allowlist", "disabled"]).optional(),
          groupPolicy: z.enum(["open", "allowlist", "disabled"]).optional(),
        })
        .optional(),
    })
    .optional(),
  // agentDefaults: top-level runtime.json fields (compaction, subagents, models)
  agentDefaults: z
    .object({
      compaction: z
        .object({
          mode: z.enum(["auto", "manual"]).optional(),
          threshold: z.number().min(0.1).max(0.99).optional(),
          reservedTokens: z.number().int().min(0).optional(),
        })
        .optional(),
      subagents: z
        .object({
          maxSpawnDepth: z.number().int().min(0).max(20).optional(),
          maxChildrenPerSession: z.number().int().min(1).max(50).optional(),
          retentionHours: z.number().int().min(0).optional(),
        })
        .optional(),
      heartbeat: z
        .object({
          every: z.string().optional(),
          model: z.string().optional(),
        })
        .optional(),
      defaultInternalModel: z.string().optional(),
      models: z
        .array(
          z.object({
            id: z.string().min(1),
            provider: z.string().min(1),
            model: z.string().min(1),
          }),
        )
        .optional(),
    })
    .optional(),
  // agents: per-agent config patches applied to runtime.json
  agents: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().optional(),
        model: z.string().nullable().optional(),
        toolProfile: z.enum(["minimal", "messaging", "coding", "full"]).optional(),
        maxSteps: z.number().int().min(1).max(200).optional(),
        temperature: z.number().min(0).max(2).nullable().optional(),
        promptMode: z.enum(["full", "minimal"]).optional(),
        thinking: z
          .object({
            enabled: z.boolean(),
            budgetTokens: z.number().int().min(1000).optional(),
          })
          .nullable()
          .optional(),
        allowSubAgents: z.boolean().optional(),
        timeoutMs: z.number().int().min(0).optional(),
        chunkTimeoutMs: z.number().int().min(0).optional(),
        instructionUrls: z.array(z.string().url()).optional(),
        bootstrapFiles: z.array(z.string()).optional(),
        expertIn: z.array(z.string()).optional(),
        heartbeat: z
          .object({
            every: z.string().optional(),
            model: z.string().optional(),
            ackMaxChars: z.number().int().min(0).optional(),
            prompt: z.string().optional(),
            activeHours: z
              .object({
                start: z.string(),
                end: z.string(),
                tz: z.string().optional(),
              })
              .optional(),
          })
          .nullable()
          .optional(),
      }),
    )
    .optional(),
});

type RuntimeConfigPatch = z.infer<typeof RuntimeConfigPatchSchema>;

// ---------------------------------------------------------------------------
// Helper: Build complete InstanceConfig from RuntimeConfig
// ---------------------------------------------------------------------------

function buildInstanceConfig(
  instance: { display_name?: string | null; default_model?: string | null; port: number },
  config: RuntimeConfig,
  stateDir: string,
): InstanceConfig {
  // Map runtime agents to UI format
  const agents = config.agents.map((a) => ({
    id: a.id,
    name: a.name,
    model: a.model ?? null,
    toolProfile: a.toolProfile ?? "coding",
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
    expertIn: a.expertIn ?? [],
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

function buildInstanceConfigStub(instance: {
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

export function registerConfigRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, lifecycle } = deps;

  // GET /api/instances/:slug/config — structured config for the settings UI
  app.get("/api/instances/:slug/config", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const stateDir = getRuntimeStateDir(slug);

    if (!runtimeConfigExists(stateDir)) {
      // Return a complete stub when runtime.json does not exist yet
      const stub = buildInstanceConfigStub({
        display_name: instance!.display_name,
        default_model: instance!.default_model,
        port: instance!.port,
      });
      return c.json(stub);
    }

    try {
      const config = loadRuntimeConfig(stateDir);
      const payload = buildInstanceConfig(
        {
          display_name: instance!.display_name,
          default_model: instance!.default_model,
          port: instance!.port,
        },
        config,
        stateDir,
      );
      return c.json(payload);
    } catch (err) {
      logger.error(
        `[config] GET /config error for slug=${slug}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return apiError(
        c,
        500,
        "CONFIG_READ_FAILED",
        err instanceof Error ? err.message : "Failed to read config",
      );
    }
  });

  // PATCH /api/instances/:slug/config — apply partial config changes
  app.patch("/api/instances/:slug/config", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    let patch: RuntimeConfigPatch;
    try {
      const raw = await c.req.json();
      const result = RuntimeConfigPatchSchema.safeParse(raw);
      if (!result.success) {
        return apiError(c, 400, "INVALID_BODY", "Invalid config patch");
      }
      patch = result.data;
    } catch {
      return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
    }

    let requiresRestart = false;

    // Update display name in DB
    if (patch.general?.displayName !== undefined) {
      registry.updateInstance(slug, { displayName: patch.general.displayName });
    }

    // Update default model in runtime.json + DB
    if (patch.general?.defaultModel !== undefined) {
      const stateDir = getRuntimeStateDir(slug);
      if (runtimeConfigExists(stateDir)) {
        try {
          const config = loadRuntimeConfig(stateDir);
          config.defaultModel = patch.general.defaultModel;
          saveRuntimeConfig(stateDir, config);
          // Keep DB in sync
          registry.updateInstance(slug, { defaultModel: patch.general.defaultModel });
          requiresRestart = true;
        } catch (err) {
          logger.error(
            `[config] PATCH /config error updating runtime.json for slug=${slug}: ${err instanceof Error ? err.message : String(err)}`,
          );
          return apiError(
            c,
            500,
            "CONFIG_PATCH_FAILED",
            err instanceof Error ? err.message : "Failed to update runtime.json",
          );
        }
      }
    }

    // Update providers in runtime.json and .env
    if (patch.providers) {
      const stateDir = getRuntimeStateDir(slug);
      const envPath = `${stateDir}/.env`;

      try {
        // Load or create config
        let config: RuntimeConfig;
        if (runtimeConfigExists(stateDir)) {
          config = loadRuntimeConfig(stateDir);
        } else {
          config = createDefaultRuntimeConfig(
            instance!.default_model != null ? { defaultModel: instance!.default_model } : {},
          );
        }

        // --- ADD ---
        if (patch.providers.add) {
          for (const entry of patch.providers.add) {
            // Skip if already present
            if (config.providers.some((p) => p.id === entry.id)) continue;

            const envVar = PROVIDER_ENV_VARS[entry.id] ?? `${entry.id.toUpperCase()}_API_KEY`;

            // Add to runtime.json providers[]
            config.providers.push({
              id: entry.id,
              ...(entry.baseUrl !== undefined ? { baseUrl: entry.baseUrl } : {}),
              authProfiles: [
                {
                  id: `${entry.id}-default`,
                  providerId: entry.id,
                  apiKeyEnvVar: envVar,
                  priority: 0,
                },
              ],
            });

            // Write API key to .env (if provided)
            if (entry.apiKey) {
              await writeEnvVar(envPath, envVar, entry.apiKey);
            }
          }
        }

        // --- UPDATE ---
        if (patch.providers.update) {
          for (const entry of patch.providers.update) {
            const envVar = PROVIDER_ENV_VARS[entry.id] ?? `${entry.id.toUpperCase()}_API_KEY`;

            // Update API key in .env
            if (entry.apiKey !== undefined) {
              await writeEnvVar(envPath, envVar, entry.apiKey);
            }

            // Update baseUrl in runtime.json
            if (entry.baseUrl !== undefined) {
              const provider = config.providers.find((p) => p.id === entry.id);
              if (provider) {
                if (entry.baseUrl === null) {
                  delete (provider as Record<string, unknown>).baseUrl;
                } else {
                  provider.baseUrl = entry.baseUrl;
                }
              }
            }
          }
        }

        // --- REMOVE ---
        if (patch.providers.remove) {
          for (const id of patch.providers.remove) {
            // Guard: block removal if provider is used by defaultModel
            if (config.defaultModel.startsWith(`${id}/`)) {
              return apiError(
                c,
                400,
                "PROVIDER_IN_USE",
                `Cannot remove provider "${id}" — used by default model "${config.defaultModel}"`,
              );
            }

            // Remove from runtime.json
            config.providers = config.providers.filter((p) => p.id !== id);

            // Remove API key from .env
            const envVar = PROVIDER_ENV_VARS[id] ?? `${id.toUpperCase()}_API_KEY`;
            await removeEnvVar(envPath, envVar);
          }
        }

        saveRuntimeConfig(stateDir, config);
        requiresRestart = true;
      } catch (err) {
        logger.error(
          `[config] PATCH providers error for slug=${slug}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return apiError(
          c,
          500,
          "CONFIG_PATCH_FAILED",
          err instanceof Error ? err.message : "Failed to update providers",
        );
      }
    }

    // Update agentDefaults (compaction, subagents, models, defaultInternalModel) in runtime.json
    if (patch.agentDefaults) {
      const stateDir = getRuntimeStateDir(slug);
      try {
        let config: RuntimeConfig;
        if (runtimeConfigExists(stateDir)) {
          config = loadRuntimeConfig(stateDir);
        } else {
          config = createDefaultRuntimeConfig(
            instance!.default_model != null ? { defaultModel: instance!.default_model } : {},
          );
        }
        const ad = patch.agentDefaults;
        if (ad.compaction) {
          if (ad.compaction.mode !== undefined)
            config.compaction.auto = ad.compaction.mode === "auto";
          if (ad.compaction.threshold !== undefined)
            config.compaction.threshold = ad.compaction.threshold;
          if (ad.compaction.reservedTokens !== undefined)
            config.compaction.reservedTokens = ad.compaction.reservedTokens;
        }
        if (ad.subagents) {
          if (ad.subagents.maxSpawnDepth !== undefined)
            config.subagents.maxSpawnDepth = ad.subagents.maxSpawnDepth;
          if (ad.subagents.maxChildrenPerSession !== undefined)
            config.subagents.maxChildrenPerSession = ad.subagents.maxChildrenPerSession;
          if (ad.subagents.retentionHours !== undefined)
            config.subagents.retentionHours = ad.subagents.retentionHours;
        }
        if (ad.defaultInternalModel !== undefined) {
          config.defaultInternalModel = ad.defaultInternalModel || undefined;
        }
        if (ad.models !== undefined) {
          config.models = ad.models.map((m) => ({
            id: m.id,
            provider: m.provider,
            model: m.model,
          }));
        }
        saveRuntimeConfig(stateDir, config);
        requiresRestart = true;
      } catch (err) {
        logger.error(
          `[config] PATCH agentDefaults error for slug=${slug}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return apiError(
          c,
          500,
          "CONFIG_PATCH_FAILED",
          err instanceof Error ? err.message : "Failed to update agentDefaults",
        );
      }
    }

    // Update per-agent config fields in runtime.json
    if (patch.agents && patch.agents.length > 0) {
      const stateDir = getRuntimeStateDir(slug);
      try {
        let config: RuntimeConfig;
        if (runtimeConfigExists(stateDir)) {
          config = loadRuntimeConfig(stateDir);
        } else {
          config = createDefaultRuntimeConfig(
            instance!.default_model != null ? { defaultModel: instance!.default_model } : {},
          );
        }
        for (const agentPatch of patch.agents) {
          const agent = config.agents.find((a) => a.id === agentPatch.id);
          if (!agent) continue;
          if (agentPatch.name !== undefined) agent.name = agentPatch.name;
          if (agentPatch.model !== undefined && agentPatch.model !== null)
            agent.model = agentPatch.model;
          if (agentPatch.toolProfile !== undefined) agent.toolProfile = agentPatch.toolProfile;
          if (agentPatch.maxSteps !== undefined) agent.maxSteps = agentPatch.maxSteps;
          if (agentPatch.temperature !== undefined)
            agent.temperature = agentPatch.temperature ?? undefined;
          if (agentPatch.promptMode !== undefined) agent.promptMode = agentPatch.promptMode;
          if (agentPatch.thinking !== undefined) {
            if (agentPatch.thinking === null) {
              agent.thinking = undefined;
            } else {
              agent.thinking = {
                enabled: agentPatch.thinking.enabled,
                ...(agentPatch.thinking.budgetTokens !== undefined
                  ? { budgetTokens: agentPatch.thinking.budgetTokens }
                  : {}),
              };
            }
          }
          if (agentPatch.allowSubAgents !== undefined)
            agent.allowSubAgents = agentPatch.allowSubAgents;
          if (agentPatch.timeoutMs !== undefined) agent.timeoutMs = agentPatch.timeoutMs;
          if (agentPatch.chunkTimeoutMs !== undefined)
            agent.chunkTimeoutMs = agentPatch.chunkTimeoutMs;
          if (agentPatch.instructionUrls !== undefined)
            agent.instructionUrls = agentPatch.instructionUrls;
          if (agentPatch.bootstrapFiles !== undefined)
            agent.bootstrapFiles = agentPatch.bootstrapFiles;
          if (agentPatch.expertIn !== undefined) agent.expertIn = agentPatch.expertIn;
          if (agentPatch.heartbeat !== undefined) {
            if (agentPatch.heartbeat === null) {
              agent.heartbeat = undefined;
            } else {
              // Cast to RuntimeAgentConfig heartbeat — runtime schema validates on load
              agent.heartbeat = agentPatch.heartbeat as typeof agent.heartbeat;
            }
          }
          // Sync full agent config to DB (config_json + indexed columns)
          try {
            const dbAgent = registry.getAgentByAgentId(instance!.id, agentPatch.id);
            if (dbAgent) {
              registry.upsertAgent(instance!.id, {
                agentId: dbAgent.agent_id,
                name: agent.name,
                model: agent.model,
                workspacePath: dbAgent.workspace_path,
                isDefault: agent.isDefault,
                position_x: dbAgent.position_x,
                position_y: dbAgent.position_y,
                configJson: JSON.stringify(agent),
              });
            }
          } catch {
            // Non-critical — runtime.json dual-write is the fallback
          }
        }
        saveRuntimeConfig(stateDir, config);
        requiresRestart = true;
      } catch (err) {
        logger.error(
          `[config] PATCH agents error for slug=${slug}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return apiError(
          c,
          500,
          "CONFIG_PATCH_FAILED",
          err instanceof Error ? err.message : "Failed to update agents config",
        );
      }
    }

    // Update telegram config in runtime.json
    if (patch.channels?.telegram !== undefined) {
      const stateDir = getRuntimeStateDir(slug);
      try {
        // Load or create runtime.json
        let config: RuntimeConfig;
        if (runtimeConfigExists(stateDir)) {
          config = loadRuntimeConfig(stateDir);
        } else {
          config = createDefaultRuntimeConfig(
            instance!.default_model !== null && instance!.default_model !== undefined
              ? { defaultModel: instance!.default_model }
              : {},
          );
        }
        const tg = patch.channels.telegram;
        if (tg.enabled !== undefined) config.telegram.enabled = tg.enabled;
        if (tg.botTokenEnvVar !== undefined) config.telegram.botTokenEnvVar = tg.botTokenEnvVar;
        if (tg.pollingIntervalMs !== undefined)
          config.telegram.pollingIntervalMs = tg.pollingIntervalMs;
        if (tg.allowedUserIds !== undefined) config.telegram.allowedUserIds = tg.allowedUserIds;
        if (tg.dmPolicy !== undefined) config.telegram.dmPolicy = tg.dmPolicy;
        if (tg.groupPolicy !== undefined) config.telegram.groupPolicy = tg.groupPolicy;
        saveRuntimeConfig(stateDir, config);
        requiresRestart = true;
      } catch (err) {
        logger.error(
          `[config] PATCH telegram error for slug=${slug}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return apiError(
          c,
          500,
          "CONFIG_PATCH_FAILED",
          err instanceof Error ? err.message : "Failed to update telegram config",
        );
      }
    }

    // Restart if needed and instance is running
    let autoRestarted = false;
    if (requiresRestart && instance!.state === "running") {
      try {
        await lifecycle.restart(slug);
        autoRestarted = true;
      } catch (err) {
        logger.warn(
          `[config] restart after config patch failed for ${slug}: ${err instanceof Error ? err.message : "unknown"}`,
        );
      }
    }

    logger.info(`[config] PATCH /config slug=${slug} patch=${JSON.stringify(patch)}`);
    // If the backend already restarted the instance, inform the UI so it doesn't show
    // a redundant "restart required" banner.
    return c.json({
      ok: true,
      requiresRestart: requiresRestart && !autoRestarted,
      hotReloaded: false,
      warnings: [],
    });
  });

  // PATCH /api/instances/:slug/config/telegram/token — write/remove bot token in .env
  app.patch("/api/instances/:slug/config/telegram/token", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    let token: string | null;
    try {
      const raw = (await c.req.json()) as { token?: unknown };
      if (raw.token !== undefined && raw.token !== null && typeof raw.token !== "string") {
        return apiError(c, 400, "INVALID_BODY", "token must be a string or null");
      }
      token = (raw.token as string | null | undefined) ?? null;
    } catch {
      return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
    }

    const stateDir = getRuntimeStateDir(slug);
    const envPath = `${stateDir}/.env`;

    try {
      // Get the botTokenEnvVar name from config (default: TELEGRAM_BOT_TOKEN)
      let varName = "TELEGRAM_BOT_TOKEN";
      if (runtimeConfigExists(stateDir)) {
        try {
          const config = loadRuntimeConfig(stateDir);
          varName = config.telegram.botTokenEnvVar;
        } catch {
          /* use default */
        }
      }

      // Write or remove token via helper
      if (token !== null) {
        await writeEnvVar(envPath, varName, token);
      } else {
        await removeEnvVar(envPath, varName);
      }

      logger.info(`[config] PATCH telegram/token slug=${slug} configured=${token !== null}`);
      return c.json({ configured: token !== null });
    } catch (err) {
      logger.error(
        `[config] PATCH telegram/token error for slug=${slug}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return apiError(c, 500, "TOKEN_WRITE_FAILED", "Failed to write token to .env");
    }
  });

  // GET /api/providers — list available providers with their model catalogs
  app.get("/api/providers", async (c) => {
    const providers: ProviderInfo[] = PROVIDER_CATALOG.map((p) => ({
      ...p,
      models: [...p.models],
    }));

    if (!providers.some((p) => p.isDefault)) {
      providers[0]!.isDefault = true;
    }

    return c.json({ canReuseCredentials: false, sourceInstance: null, providers });
  });
}
