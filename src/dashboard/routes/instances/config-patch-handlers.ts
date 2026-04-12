// src/dashboard/routes/instances/config-patch-handlers.ts
// Extracted helper functions for the PATCH /api/instances/:slug/config handler.
import type Database from "better-sqlite3";
import type { RuntimeConfig } from "../../../runtime/index.js";
import type { RuntimeConfigPatch } from "./config-schemas.js";
import { PROVIDER_ENV_VARS } from "../../../lib/providers.js";
import { writeEnvVar, removeEnvVar } from "../../../lib/dotenv.js";

// ---------------------------------------------------------------------------
// .env writes for provider API keys (add / update / remove)
// ---------------------------------------------------------------------------

/** Write, update, or remove provider API keys in the instance .env file. */
export async function applyProviderEnvWrites(
  envPath: string,
  patch: NonNullable<RuntimeConfigPatch["providers"]>,
): Promise<void> {
  if (patch.add) {
    for (const entry of patch.add) {
      if (entry.apiKey) {
        const envVar = PROVIDER_ENV_VARS[entry.id] ?? `${entry.id.toUpperCase()}_API_KEY`;
        await writeEnvVar(envPath, envVar, entry.apiKey);
      }
    }
  }
  if (patch.update) {
    for (const entry of patch.update) {
      if (entry.apiKey !== undefined) {
        const envVar = PROVIDER_ENV_VARS[entry.id] ?? `${entry.id.toUpperCase()}_API_KEY`;
        await writeEnvVar(envPath, envVar, entry.apiKey);
      }
    }
  }
  if (patch.remove) {
    for (const id of patch.remove) {
      const envVar = PROVIDER_ENV_VARS[id] ?? `${id.toUpperCase()}_API_KEY`;
      await removeEnvVar(envPath, envVar);
    }
  }
}

// ---------------------------------------------------------------------------
// Provider mutations on RuntimeConfig (add / update / remove)
// ---------------------------------------------------------------------------

/** Add, update, or remove providers in the RuntimeConfig (mutates in place). */
export function applyProviderChanges(
  config: RuntimeConfig,
  providers: NonNullable<RuntimeConfigPatch["providers"]>,
): void {
  // ADD
  if (providers.add) {
    for (const entry of providers.add) {
      if (config.providers.some((p) => p.id === entry.id)) continue;
      const envVar = PROVIDER_ENV_VARS[entry.id] ?? `${entry.id.toUpperCase()}_API_KEY`;
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
    }
  }
  // UPDATE
  if (providers.update) {
    for (const entry of providers.update) {
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
  // REMOVE
  if (providers.remove) {
    config.providers = config.providers.filter((p) => !providers.remove!.includes(p.id));
  }
}

// ---------------------------------------------------------------------------
// Agent defaults (compaction, subagents, heartbeat, models)
// ---------------------------------------------------------------------------

/** Apply agentDefaults patch to RuntimeConfig (mutates in place). */
export function applyAgentDefaultChanges(
  config: RuntimeConfig,
  agentDefaults: NonNullable<RuntimeConfigPatch["agentDefaults"]>,
): void {
  const ad = agentDefaults;
  if (ad.compaction) {
    if (ad.compaction.mode !== undefined) config.compaction.auto = ad.compaction.mode === "auto";
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
  if (ad.heartbeat?.model !== undefined) {
    config.defaultHeartbeatModel = ad.heartbeat.model || undefined;
  }
  if (ad.models !== undefined) {
    config.models = ad.models.map((m) => ({
      id: m.id,
      provider: m.provider,
      model: m.model,
    }));
  }
}

// ---------------------------------------------------------------------------
// Per-agent config mutations
// ---------------------------------------------------------------------------

/** Apply per-agent patches to RuntimeConfig (mutates in place).
 *  Also updates named_key_id in the agents SQL table when present. */
export function applyAgentPatches(
  config: RuntimeConfig,
  agents: NonNullable<RuntimeConfigPatch["agents"]>,
  db: Database.Database,
  slug: string,
): void {
  for (const agentPatch of agents) {
    const agent = config.agents.find((a) => a.id === agentPatch.id);
    if (!agent) continue;
    if (agentPatch.name !== undefined) agent.name = agentPatch.name;
    if (agentPatch.model !== undefined && agentPatch.model !== null) agent.model = agentPatch.model;
    if (agentPatch.toolProfile !== undefined) agent.toolProfile = agentPatch.toolProfile;
    if (agentPatch.customTools !== undefined) agent.customTools = agentPatch.customTools;
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
    if (agentPatch.allowSubAgents !== undefined) agent.allowSubAgents = agentPatch.allowSubAgents;
    if (agentPatch.timeoutMs !== undefined) agent.timeoutMs = agentPatch.timeoutMs;
    if (agentPatch.chunkTimeoutMs !== undefined) agent.chunkTimeoutMs = agentPatch.chunkTimeoutMs;
    if (agentPatch.instructionUrls !== undefined)
      agent.instructionUrls = agentPatch.instructionUrls;
    if (agentPatch.bootstrapFiles !== undefined) agent.bootstrapFiles = agentPatch.bootstrapFiles;
    if (agentPatch.archetype !== undefined) agent.archetype = agentPatch.archetype;
    if (agentPatch.autoSelectSkills !== undefined)
      agent.autoSelectSkills = agentPatch.autoSelectSkills;
    if (agentPatch.autoSelectSkillsTopN !== undefined)
      agent.autoSelectSkillsTopN = agentPatch.autoSelectSkillsTopN;
    if (agentPatch.skills !== undefined) agent.skills = agentPatch.skills ?? undefined;
    if (agentPatch.heartbeat !== undefined) {
      if (agentPatch.heartbeat === null) {
        agent.heartbeat = undefined;
      } else {
        agent.heartbeat = agentPatch.heartbeat as typeof agent.heartbeat;
      }
    }

    // named_key_id lives in the agents SQL table, not in runtime_config_json
    if (agentPatch.namedKeyId !== undefined) {
      db.prepare(
        `UPDATE agents SET named_key_id = ?
                     WHERE agent_id = ? AND instance_id = (
                       SELECT id FROM instances WHERE slug = ?
                     )`,
      ).run(agentPatch.namedKeyId, agentPatch.id, slug);
    }
  }
}

// ---------------------------------------------------------------------------
// Telegram channel settings
// ---------------------------------------------------------------------------

/** Apply telegram channel patch to RuntimeConfig (mutates in place). */
export function applyTelegramChanges(
  config: RuntimeConfig,
  telegram: NonNullable<NonNullable<RuntimeConfigPatch["channels"]>["telegram"]>,
): void {
  const tg = telegram;
  if (tg.enabled !== undefined) config.telegram.enabled = tg.enabled;
  if (tg.botTokenEnvVar !== undefined) config.telegram.botTokenEnvVar = tg.botTokenEnvVar;
  if (tg.pollingIntervalMs !== undefined) config.telegram.pollingIntervalMs = tg.pollingIntervalMs;
  if (tg.allowedUserIds !== undefined) config.telegram.allowedUserIds = tg.allowedUserIds;
  if (tg.dmPolicy !== undefined) config.telegram.dmPolicy = tg.dmPolicy;
  if (tg.groupPolicy !== undefined) config.telegram.groupPolicy = tg.groupPolicy;
}
