// src/core/team-export.ts
// Export an agent team from an instance or blueprint as a TeamFile object.

import { stringify } from "yaml";
import type { ServerConnection } from "../server/connection.js";
import type { Registry, InstanceRecord, AgentRecord, BlueprintAgentRecord } from "./registry.js";
import { AgentSync } from "./agent-sync.js";
import {
  EXPORTABLE_FILES,
  TEAM_FORMAT_VERSION,
  type TeamFile,
  type TeamAgent,
  type TeamLink,
} from "./team-schema.js";

// ---------------------------------------------------------------------------
// Config extraction helpers
// ---------------------------------------------------------------------------

/** Fields stripped from config_json because they are top-level in the YAML agent. */
const STRIP_FROM_CONFIG = new Set(["id", "name", "isDefault"]);

/**
 * Extract config from an agent's config_json column (source of truth, v20+).
 * Strips fields that are already top-level in the YAML agent schema.
 */
function extractConfigFromJson(configJson: string | null): Record<string, unknown> | undefined {
  if (!configJson) return undefined;
  try {
    const parsed = JSON.parse(configJson) as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    let hasKey = false;
    for (const [key, value] of Object.entries(parsed)) {
      if (!STRIP_FROM_CONFIG.has(key) && value !== undefined) {
        result[key] = value;
        hasKey = true;
      }
    }
    return hasKey ? result : undefined;
  } catch {
    // intentionally ignored — invalid JSON in config_json
    return undefined;
  }
}

/** Legacy fallback: extract config from runtime.json agents[] for pre-v20 agents. */
const LEGACY_CONFIG_KEYS = [
  "model",
  "toolProfile",
  "permissions",
  "subagents",
  "tools",
  "params",
  "archetype",
  "heartbeat",
  "humanDelay",
  "identity",
  "sandbox",
  "groupChat",
] as const;

function extractAgentConfigLegacy(
  runtimeConfig: Record<string, unknown>,
  agentId: string,
  isDefault: boolean,
): Record<string, unknown> | undefined {
  const agents = (runtimeConfig["agents"] ?? []) as Array<Record<string, unknown>>;
  const entry = agents.find((a) => a["id"] === agentId);
  if (!entry) {
    if (isDefault && runtimeConfig["defaultModel"]) {
      return { model: runtimeConfig["defaultModel"] };
    }
    return undefined;
  }
  const result: Record<string, unknown> = {};
  let hasKey = false;
  for (const key of LEGACY_CONFIG_KEYS) {
    if (key in entry && entry[key] !== undefined) {
      result[key] = entry[key];
      hasKey = true;
    }
  }
  return hasKey ? result : undefined;
}

// ---------------------------------------------------------------------------
// Build TeamAgent from DB records
// ---------------------------------------------------------------------------

function buildTeamAgent(
  agent: AgentRecord | BlueprintAgentRecord,
  files: Array<{ filename: string; content: string | null }>,
  config?: Record<string, unknown>,
): TeamAgent {
  // Parse tags from JSON string
  let tags: string[] | null = null;
  if (agent.tags) {
    try {
      tags = JSON.parse(agent.tags) as string[];
    } catch {
      // intentionally ignored — tags stored as invalid JSON, treat as empty
      tags = null;
    }
  }

  const teamAgent: TeamAgent = {
    id: agent.agent_id,
    name: agent.name,
    is_default: agent.is_default === 1,
    config: config ?? undefined,
    meta: {
      role: agent.role ?? null,
      tags,
      notes: agent.notes ?? null,
      position:
        agent.position_x != null && agent.position_y != null
          ? { x: agent.position_x, y: agent.position_y }
          : null,
    },
  };

  // Only include files that are exportable and have content
  const exportableFiles: Record<string, string> = {};
  for (const file of files) {
    if ((EXPORTABLE_FILES as readonly string[]).includes(file.filename) && file.content) {
      exportableFiles[file.filename] = file.content;
    }
  }
  if (Object.keys(exportableFiles).length > 0) {
    teamAgent.files = exportableFiles;
  }

  return teamAgent;
}

// ---------------------------------------------------------------------------
// Export from instance
// ---------------------------------------------------------------------------

export async function exportInstanceTeam(
  conn: ServerConnection,
  registry: Registry,
  instance: InstanceRecord,
): Promise<TeamFile> {
  // 1. Force sync to ensure DB (including config_json) is up-to-date
  const agentSync = new AgentSync(conn, registry);
  await agentSync.sync(instance);

  // 2. Read runtime.json as fallback for pre-v20 agents without config_json
  let runtimeConfig: Record<string, unknown> | undefined;
  try {
    const configRaw = await conn.readFile(instance.config_path);
    runtimeConfig = JSON.parse(configRaw) as Record<string, unknown>;
  } catch {
    // intentionally ignored — runtime.json may not exist for new instances
  }

  // 3. Load agents
  const agents = registry.listAgents(instance.slug);

  // 4. Build team agents — prefer config_json, fall back to runtime.json
  const teamAgents: TeamAgent[] = [];
  for (const agent of agents) {
    const files = registry.listAgentFiles(agent.id);
    const config =
      extractConfigFromJson(agent.config_json) ??
      (runtimeConfig
        ? extractAgentConfigLegacy(runtimeConfig, agent.agent_id, agent.is_default === 1)
        : undefined);
    teamAgents.push(buildTeamAgent(agent, files, config));
  }

  // 5. Load links
  const links = registry.listAgentLinks(instance.id);
  const teamLinks: TeamLink[] = links.map((l) => ({
    source: l.source_agent_id,
    target: l.target_agent_id,
    type: l.link_type,
  }));

  // 6. Extract defaults from runtime.json (or instance config)
  const defaults = runtimeConfig?.["defaultModel"]
    ? { model: runtimeConfig["defaultModel"] }
    : undefined;

  // 7. Assemble TeamFile
  const teamFile: TeamFile = {
    version: TEAM_FORMAT_VERSION,
    exported_at: new Date().toISOString(),
    source: instance.slug,
    defaults: defaults as TeamFile["defaults"],
    agents: teamAgents,
    links: teamLinks,
  };

  return teamFile;
}

// ---------------------------------------------------------------------------
// Export from blueprint
// ---------------------------------------------------------------------------

export function exportBlueprintTeam(registry: Registry, blueprintId: number): TeamFile {
  const blueprint = registry.getBlueprint(blueprintId);
  if (!blueprint) throw new Error(`Blueprint ${blueprintId} not found`);

  // 1. Load agents
  const agents = registry.listBlueprintAgents(blueprintId);

  // 2. Build team agents — prefer config_json, fall back to model field
  const teamAgents: TeamAgent[] = [];
  for (const agent of agents) {
    const files = registry.listAgentFiles(agent.id);
    let config = extractConfigFromJson(agent.config_json);
    if (!config && agent.model) {
      // Legacy fallback: blueprints before config_json only stored the model
      try {
        const parsed = JSON.parse(agent.model);
        config = { model: parsed };
      } catch {
        // intentionally ignored — model is a bare string, not JSON; use it as-is
        config = { model: agent.model };
      }
    }
    teamAgents.push(buildTeamAgent(agent, files, config));
  }

  // 3. Load links
  const links = registry.listBlueprintLinks(blueprintId);
  const teamLinks: TeamLink[] = links.map((l) => ({
    source: l.source_agent_id,
    target: l.target_agent_id,
    type: l.link_type,
  }));

  // 4. Extract defaults.model from the default agent's config
  const defaultAgent = agents.find((a) => a.is_default === 1);
  let defaultModel: string | unknown | undefined;
  if (defaultAgent) {
    const defaultConfig = extractConfigFromJson(defaultAgent.config_json);
    defaultModel = defaultConfig?.["model"];
    if (!defaultModel && defaultAgent.model) {
      try {
        defaultModel = JSON.parse(defaultAgent.model) as string;
      } catch {
        // intentionally ignored — model is a bare string
        defaultModel = defaultAgent.model;
      }
    }
  }
  const defaults = defaultModel ? ({ model: defaultModel } as TeamFile["defaults"]) : undefined;

  // 5. Assemble TeamFile
  const teamFile: TeamFile = {
    version: TEAM_FORMAT_VERSION,
    exported_at: new Date().toISOString(),
    source: blueprint.name,
    ...(defaults ? { defaults } : {}),
    agents: teamAgents,
    links: teamLinks,
  };

  return teamFile;
}

// ---------------------------------------------------------------------------
// YAML serialization
// ---------------------------------------------------------------------------

/** Serialize a TeamFile to YAML with literal blocks for MD content. */
export function serializeTeamYaml(team: TeamFile): string {
  // Clean up undefined values before serialization
  const clean = JSON.parse(JSON.stringify(team)) as Record<string, unknown>;

  return stringify(clean, {
    lineWidth: 0, // Don't wrap lines
    defaultStringType: "PLAIN",
    defaultKeyType: "PLAIN",
    blockQuote: "literal", // Use | for multiline strings
  });
}
