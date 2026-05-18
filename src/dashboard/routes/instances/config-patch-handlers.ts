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

/** Add new providers to RuntimeConfig (mutates in place). */
function addProviders(
  config: RuntimeConfig,
  entries: NonNullable<NonNullable<RuntimeConfigPatch["providers"]>["add"]>,
): void {
  for (const entry of entries) {
    if (config.providers.some((p) => p.id === entry.id)) continue;
    const envVar = PROVIDER_ENV_VARS[entry.id] ?? `${entry.id.toUpperCase()}_API_KEY`;
    config.providers.push({
      id: entry.id,
      ...(entry.baseUrl !== undefined ? { baseUrl: entry.baseUrl } : {}),
      authProfiles: [
        { id: `${entry.id}-default`, providerId: entry.id, apiKeyEnvVar: envVar, priority: 0 },
      ],
    });
  }
}

/** Update existing providers in RuntimeConfig (mutates in place). */
function updateProviders(
  config: RuntimeConfig,
  entries: NonNullable<NonNullable<RuntimeConfigPatch["providers"]>["update"]>,
): void {
  for (const entry of entries) {
    if (entry.baseUrl === undefined) continue;
    const provider = config.providers.find((p) => p.id === entry.id);
    if (!provider) continue;
    if (entry.baseUrl === null) {
      delete (provider as Record<string, unknown>).baseUrl;
    } else {
      provider.baseUrl = entry.baseUrl;
    }
  }
}

/** Add, update, or remove providers in the RuntimeConfig (mutates in place). */
export function applyProviderChanges(
  config: RuntimeConfig,
  providers: NonNullable<RuntimeConfigPatch["providers"]>,
): void {
  if (providers.add) addProviders(config, providers.add);
  if (providers.update) updateProviders(config, providers.update);
  if (providers.remove) {
    config.providers = config.providers.filter((p) => !providers.remove!.includes(p.id));
  }
}

// ---------------------------------------------------------------------------
// Agent defaults (compaction, subagents, heartbeat, models)
// ---------------------------------------------------------------------------

/** Apply compaction defaults from patch (mutates in place). */
function applyCompactionDefaults(
  config: RuntimeConfig,
  compaction: NonNullable<NonNullable<RuntimeConfigPatch["agentDefaults"]>["compaction"]>,
): void {
  if (compaction.mode !== undefined) config.compaction.auto = compaction.mode === "auto";
  if (compaction.threshold !== undefined) config.compaction.threshold = compaction.threshold;
  if (compaction.reservedTokens !== undefined)
    config.compaction.reservedTokens = compaction.reservedTokens;
}

/** Apply subagent defaults from patch (mutates in place). */
function applySubagentDefaults(
  config: RuntimeConfig,
  subagents: NonNullable<NonNullable<RuntimeConfigPatch["agentDefaults"]>["subagents"]>,
): void {
  if (subagents.maxSpawnDepth !== undefined)
    config.subagents.maxSpawnDepth = subagents.maxSpawnDepth;
  if (subagents.maxChildrenPerSession !== undefined)
    config.subagents.maxChildrenPerSession = subagents.maxChildrenPerSession;
  if (subagents.retentionHours !== undefined)
    config.subagents.retentionHours = subagents.retentionHours;
}

/** Apply agentDefaults patch to RuntimeConfig (mutates in place). */
export function applyAgentDefaultChanges(
  config: RuntimeConfig,
  agentDefaults: NonNullable<RuntimeConfigPatch["agentDefaults"]>,
): void {
  const ad = agentDefaults;
  if (ad.compaction) applyCompactionDefaults(config, ad.compaction);
  if (ad.subagents) applySubagentDefaults(config, ad.subagents);
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgentConfig = RuntimeConfig["agents"][number];
type AgentPatch = NonNullable<RuntimeConfigPatch["agents"]>[number];

/** Apply core scalar fields (model, tools, steps, mode) from an agent patch (mutates in place). */
function applyAgentCoreFields(agent: AgentConfig, patch: AgentPatch): void {
  if (patch.name !== undefined) agent.name = patch.name;
  if (patch.model !== undefined && patch.model !== null) agent.model = patch.model;
  if (patch.toolProfile !== undefined) agent.toolProfile = patch.toolProfile;
  if (patch.customTools !== undefined) agent.customTools = patch.customTools;
  if (patch.maxSteps !== undefined) agent.maxSteps = patch.maxSteps;
  if (patch.temperature !== undefined) agent.temperature = patch.temperature ?? undefined;
  if (patch.promptMode !== undefined) agent.promptMode = patch.promptMode;
  if (patch.allowSubAgents !== undefined) agent.allowSubAgents = patch.allowSubAgents;
  if (patch.timeoutMs !== undefined) agent.timeoutMs = patch.timeoutMs;
  if (patch.chunkTimeoutMs !== undefined) agent.chunkTimeoutMs = patch.chunkTimeoutMs;
}

/** Apply content + skill fields from an agent patch (mutates in place). */
function applyAgentContentFields(agent: AgentConfig, patch: AgentPatch): void {
  if (patch.instructionUrls !== undefined) agent.instructionUrls = patch.instructionUrls;
  if (patch.bootstrapFiles !== undefined) agent.bootstrapFiles = patch.bootstrapFiles;
  if (patch.archetype !== undefined) agent.archetype = patch.archetype;
  if (patch.autoSelectSkills !== undefined) agent.autoSelectSkills = patch.autoSelectSkills;
  if (patch.autoSelectSkillsTopN !== undefined)
    agent.autoSelectSkillsTopN = patch.autoSelectSkillsTopN;
  if (patch.skills !== undefined) agent.skills = patch.skills ?? undefined;
  if (patch.skillUrls !== undefined) agent.skillUrls = patch.skillUrls;
}

/** Apply identity + security fields from an agent patch (mutates in place). */
function applyAgentIdentityFields(agent: AgentConfig, patch: AgentPatch): void {
  if (patch.agentToAgent !== undefined) agent.agentToAgent = patch.agentToAgent;
  if (patch.isDefault !== undefined) agent.isDefault = patch.isDefault;
  if (patch.persistence !== undefined) agent.persistence = patch.persistence;
  if (patch.systemPrompt !== undefined) agent.systemPrompt = patch.systemPrompt;
  if (patch.systemPromptFile !== undefined) agent.systemPromptFile = patch.systemPromptFile;
  if (patch.permissions !== undefined) agent.permissions = patch.permissions;
  if (patch.inheritWorkspace !== undefined) agent.inheritWorkspace = patch.inheritWorkspace;
}

/** Apply scalar fields from an agent patch onto the agent config (mutates in place). */
function applyAgentScalarFields(agent: AgentConfig, patch: AgentPatch): void {
  applyAgentCoreFields(agent, patch);
  applyAgentContentFields(agent, patch);
  applyAgentIdentityFields(agent, patch);
}

/** Apply complex nested fields (thinking, heartbeat) from an agent patch. */
function applyAgentNestedFields(agent: AgentConfig, patch: AgentPatch): void {
  if (patch.thinking !== undefined) {
    if (patch.thinking === null) {
      agent.thinking = undefined;
    } else {
      agent.thinking = {
        enabled: patch.thinking.enabled,
        ...(patch.thinking.budgetTokens !== undefined
          ? { budgetTokens: patch.thinking.budgetTokens }
          : {}),
      };
    }
  }
  if (patch.heartbeat !== undefined) {
    if (patch.heartbeat === null) {
      agent.heartbeat = undefined;
    } else {
      agent.heartbeat = patch.heartbeat as typeof agent.heartbeat;
    }
  }
}

/** Update named_key_id in the agents SQL table for a specific agent. */
function updateAgentNamedKeyId(
  db: Database.Database,
  slug: string,
  agentId: string,
  namedKeyId: unknown,
): void {
  db.prepare(
    `UPDATE agents SET named_key_id = ?
     WHERE agent_id = ? AND instance_id = (
       SELECT id FROM instances WHERE slug = ?
     )`,
  ).run(namedKeyId, agentId, slug);
}

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

    applyAgentScalarFields(agent, agentPatch);
    applyAgentNestedFields(agent, agentPatch);

    if (agentPatch.namedKeyId !== undefined) {
      updateAgentNamedKeyId(db, slug, agentPatch.id, agentPatch.namedKeyId);
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
