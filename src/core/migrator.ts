// src/core/migrator.ts
//
// Converts an openclaw.json config to a claw-runtime runtime.json config.
// Returns a MigrationResult with the converted config and a report of
// fields that could not be mapped (lost/ignored).

import type { OpenClawConfig } from "./openclaw-config.schema.js";
import type {
  RuntimeConfig,
  RuntimeAgentConfig,
  RuntimeProviderConfig,
} from "../runtime/config/index.js";
import { RuntimeConfigSchema } from "../runtime/config/index.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MigrationWarning {
  field: string;
  reason: string;
}

export interface MigrationReport {
  /** Warnings about fields that could not be mapped */
  warnings: MigrationWarning[];
  /** Env var entries to append to <stateDir>/.env */
  envEntries: Array<{ key: string; value: string }>;
  /** Number of agents converted */
  agentCount: number;
  /** Number of providers converted */
  providerCount: number;
}

export interface MigrationResult {
  config: RuntimeConfig;
  report: MigrationReport;
}

// ---------------------------------------------------------------------------
// Model normalization
// ---------------------------------------------------------------------------

/**
 * Normalize an OpenClaw model ref (string | { primary: string } | null | undefined)
 * to a "provider/model" string, or null if not resolvable.
 */
function normalizeModelRef(ref: string | { primary: string } | null | undefined): string | null {
  if (!ref) return null;
  if (typeof ref === "string") return ref;
  if (typeof ref === "object" && "primary" in ref) return ref.primary;
  return null;
}

// ---------------------------------------------------------------------------
// Provider extraction
// ---------------------------------------------------------------------------

/**
 * Convert openclaw.json models.providers to RuntimeProviderConfig[].
 * API keys are moved to .env entries; the env var name is derived from the provider ID.
 */
function extractProviders(openclawConfig: OpenClawConfig): {
  providers: RuntimeProviderConfig[];
  envEntries: Array<{ key: string; value: string }>;
} {
  const rawProviders = openclawConfig.models?.providers ?? {};
  const providers: RuntimeProviderConfig[] = [];
  const envEntries: Array<{ key: string; value: string }> = [];

  for (const [providerId, entry] of Object.entries(rawProviders)) {
    const envVarName = `${providerId.toUpperCase()}_API_KEY`;

    const authProfiles = [];
    if (entry.apiKey) {
      authProfiles.push({
        id: `${providerId}-default`,
        providerId,
        apiKeyEnvVar: envVarName,
        priority: 0,
      });
      envEntries.push({ key: envVarName, value: entry.apiKey });
    }

    const provider: RuntimeProviderConfig = {
      id: providerId,
      authProfiles,
      ...(entry.baseUrl !== undefined ? { baseUrl: entry.baseUrl } : {}),
    };

    providers.push(provider);
  }

  return { providers, envEntries };
}

// ---------------------------------------------------------------------------
// Agent extraction
// ---------------------------------------------------------------------------

/**
 * Convert openclaw.json agents to RuntimeAgentConfig[].
 * Falls back to defaults.model when an agent has no explicit model.
 */
function extractAgents(
  openclawConfig: OpenClawConfig,
  defaultModel: string,
): { agents: RuntimeAgentConfig[]; warnings: MigrationWarning[] } {
  const agentList = openclawConfig.agents?.list ?? [];
  const warnings: MigrationWarning[] = [];
  const agents: RuntimeAgentConfig[] = [];

  // Track which OpenClaw-only fields we've warned about (once per field)
  const warnedFields = new Set<string>();

  const warnOnce = (field: string, reason: string) => {
    if (!warnedFields.has(field)) {
      warnedFields.add(field);
      warnings.push({ field, reason });
    }
  };

  for (const agent of agentList) {
    const modelRef = normalizeModelRef(agent.model) ?? defaultModel;

    // Warn about unmappable fields
    const agentAny = agent as Record<string, unknown>;
    if (agentAny["workspace"])
      warnOnce("agents[].workspace", "No workspace mapping in claw-runtime");
    if (agentAny["identity"])
      warnOnce("agents[].identity", "Identity (name/emoji/avatar) not in RuntimeAgentConfig");
    if (agentAny["sandbox"])
      warnOnce("agents[].sandbox", "Sandbox config not in RuntimeAgentConfig");
    if (agentAny["params"]) warnOnce("agents[].params", "Params not in RuntimeAgentConfig");
    if (agentAny["tools"]) warnOnce("agents[].tools", "Tools profile not directly mappable");
    if (agentAny["runtime"])
      warnOnce("agents[].runtime", "Runtime config not in RuntimeAgentConfig");
    if (agentAny["skills"]) warnOnce("agents[].skills", "Skills not in RuntimeAgentConfig");
    if (agentAny["heartbeat"])
      warnOnce("agents[].heartbeat", "Heartbeat not in RuntimeAgentConfig");
    if (agentAny["subagents"])
      warnOnce("agents[].subagents", "Subagents config not in RuntimeAgentConfig");

    agents.push({
      id: agent.id,
      name: agent.name ?? agent.id,
      model: modelRef,
      permissions: [],
      maxSteps: 20,
      allowSubAgents: true,
      toolProfile: "coding",
      isDefault: false,
    });
  }

  // Mark first agent as default if none is explicitly set
  if (agents.length > 0 && !agents.some((a) => a.isDefault)) {
    agents[0]!.isDefault = true;
  }

  return { agents, warnings };
}

// ---------------------------------------------------------------------------
// Telegram extraction
// ---------------------------------------------------------------------------

function extractTelegram(openclawConfig: OpenClawConfig): {
  telegram: RuntimeConfig["telegram"];
  envEntries: Array<{ key: string; value: string }>;
  warnings: MigrationWarning[];
} {
  const tg = openclawConfig.channels?.telegram;
  const warnings: MigrationWarning[] = [];
  const envEntries: Array<{ key: string; value: string }> = [];

  if (!tg) {
    return {
      telegram: {
        enabled: false,
        botTokenEnvVar: "TELEGRAM_BOT_TOKEN",
        pollingIntervalMs: 1000,
        allowedUserIds: [],
      },
      envEntries,
      warnings,
    };
  }

  const tgAny = tg as Record<string, unknown>;
  if (tgAny["dmPolicy"])
    warnings.push({ field: "channels.telegram.dmPolicy", reason: "Not in RuntimeTelegramConfig" });
  if (tgAny["groupPolicy"])
    warnings.push({
      field: "channels.telegram.groupPolicy",
      reason: "Not in RuntimeTelegramConfig",
    });
  if (tgAny["streamMode"])
    warnings.push({
      field: "channels.telegram.streamMode",
      reason: "Not in RuntimeTelegramConfig",
    });

  if (tg.botToken) {
    envEntries.push({ key: "TELEGRAM_BOT_TOKEN", value: tg.botToken });
  }

  return {
    telegram: {
      enabled: tg.enabled ?? false,
      botTokenEnvVar: "TELEGRAM_BOT_TOKEN",
      pollingIntervalMs: 1000,
      allowedUserIds: [],
    },
    envEntries,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Top-level warnings for unmappable root fields
// ---------------------------------------------------------------------------

function collectRootWarnings(openclawConfig: OpenClawConfig): MigrationWarning[] {
  const warnings: MigrationWarning[] = [];

  if (openclawConfig.auth?.profiles && Object.keys(openclawConfig.auth.profiles).length > 0) {
    warnings.push({
      field: "auth.profiles",
      reason: "Auth profiles system is different in claw-runtime",
    });
  }
  if (openclawConfig.tools?.profile) {
    warnings.push({ field: "tools.profile", reason: "No direct mapping for tools.profile" });
  }
  if (openclawConfig.plugins && Object.keys(openclawConfig.plugins).length > 0) {
    warnings.push({ field: "plugins", reason: "Plugins not supported in claw-runtime" });
  }
  if (openclawConfig.agents?.defaults?.subagents) {
    warnings.push({
      field: "agents.defaults.subagents",
      reason: "Subagents config not in RuntimeConfig",
    });
  }
  if (openclawConfig.agents?.defaults?.compaction) {
    warnings.push({
      field: "agents.defaults.compaction",
      reason: "Compaction defaults not mapped (claw-runtime has its own compaction config)",
    });
  }
  if (openclawConfig.agents?.defaults?.heartbeat) {
    warnings.push({ field: "agents.defaults.heartbeat", reason: "Heartbeat not in RuntimeConfig" });
  }
  if (openclawConfig.agents?.defaults?.contextPruning) {
    warnings.push({
      field: "agents.defaults.contextPruning",
      reason: "Context pruning not in RuntimeConfig",
    });
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Convert an OpenClaw config to a claw-runtime RuntimeConfig.
 * Returns the converted config and a migration report.
 */
export function buildRuntimeConfig(openclawConfig: OpenClawConfig): MigrationResult {
  // 1. Determine default model
  const defaultModelRef = normalizeModelRef(openclawConfig.agents?.defaults?.model);
  const defaultModel = defaultModelRef ?? "anthropic/claude-sonnet-4-5";

  // 2. Extract providers
  const { providers, envEntries: providerEnvEntries } = extractProviders(openclawConfig);

  // 3. Extract agents
  const { agents, warnings: agentWarnings } = extractAgents(openclawConfig, defaultModel);

  // 4. Extract telegram
  const {
    telegram,
    envEntries: telegramEnvEntries,
    warnings: telegramWarnings,
  } = extractTelegram(openclawConfig);

  // 5. Collect root-level warnings
  const rootWarnings = collectRootWarnings(openclawConfig);

  // 6. Assemble all warnings and env entries
  const allWarnings = [...rootWarnings, ...agentWarnings, ...telegramWarnings];
  const allEnvEntries = [...providerEnvEntries, ...telegramEnvEntries];

  // 7. Build and validate the RuntimeConfig
  const raw = {
    version: 1 as const,
    defaultModel,
    providers,
    agents,
    telegram,
  };

  const config = RuntimeConfigSchema.parse(raw);

  return {
    config,
    report: {
      warnings: allWarnings,
      envEntries: allEnvEntries,
      agentCount: agents.length,
      providerCount: providers.length,
    },
  };
}
