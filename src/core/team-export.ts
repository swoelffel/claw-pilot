// src/core/team-export.ts
// Export an agent team from an instance or blueprint as a TeamFile object.

import { stringify } from "yaml";
import type { ServerConnection } from "../server/connection.js";
import type { Registry, InstanceRecord, AgentRecord, AgentLinkRecord } from "./registry.js";
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

/** Fields we extract per-agent from openclaw.json. */
const AGENT_CONFIG_KEYS = [
  "model", "identity", "subagents", "heartbeat", "sandbox",
  "tools", "params", "skills", "humanDelay", "groupChat",
] as const;

function pick(
  obj: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> | undefined {
  const result: Record<string, unknown> = {};
  let hasKey = false;
  for (const key of keys) {
    if (key in obj && obj[key] !== undefined) {
      result[key] = obj[key];
      hasKey = true;
    }
  }
  return hasKey ? result : undefined;
}

/**
 * Extract per-agent config from the parsed openclaw.json.
 * For the default (main) agent, reads from agents.defaults.
 * For other agents, reads from agents.list[].
 */
function extractAgentConfig(
  openclawConfig: Record<string, unknown>,
  agentId: string,
  isDefault: boolean,
): Record<string, unknown> | undefined {
  const agents = openclawConfig["agents"] as
    | { defaults?: Record<string, unknown>; list?: Array<Record<string, unknown>> }
    | undefined;

  if (isDefault) {
    const d = agents?.defaults;
    if (!d) return undefined;
    return pick(d, AGENT_CONFIG_KEYS);
  }

  const entry = agents?.list?.find((a) => a["id"] === agentId);
  if (!entry) return undefined;
  return pick(entry, AGENT_CONFIG_KEYS);
}

// ---------------------------------------------------------------------------
// Build TeamAgent from DB records
// ---------------------------------------------------------------------------

function buildTeamAgent(
  agent: AgentRecord,
  files: Array<{ filename: string; content: string | null }>,
  config?: Record<string, unknown>,
): TeamAgent {
  // Parse tags from JSON string
  let tags: string[] | null = null;
  if (agent.tags) {
    try {
      tags = JSON.parse(agent.tags) as string[];
    } catch {
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
    if (
      (EXPORTABLE_FILES as readonly string[]).includes(file.filename) &&
      file.content
    ) {
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
  // 1. Force sync to ensure DB is up-to-date
  const agentSync = new AgentSync(conn, registry);
  await agentSync.sync(instance);

  // 2. Read openclaw.json for config extraction
  const configRaw = await conn.readFile(instance.config_path);
  const openclawConfig = JSON.parse(configRaw) as Record<string, unknown>;

  // 3. Load agents
  const agents = registry.listAgents(instance.slug);

  // 4. Build team agents
  const teamAgents: TeamAgent[] = [];
  for (const agent of agents) {
    const files = registry.listAgentFiles(agent.id);
    const config = extractAgentConfig(
      openclawConfig,
      agent.agent_id,
      agent.is_default === 1,
    );
    teamAgents.push(buildTeamAgent(agent, files, config));
  }

  // 5. Load links
  const links = registry.listAgentLinks(instance.id);
  const teamLinks: TeamLink[] = links.map((l) => ({
    source: l.source_agent_id,
    target: l.target_agent_id,
    type: l.link_type,
  }));

  // 6. Extract defaults and agent_to_agent from openclaw.json
  const agentsConf = openclawConfig["agents"] as
    | { defaults?: Record<string, unknown> }
    | undefined;
  const toolsConf = openclawConfig["tools"] as
    | { agentToAgent?: { enabled: boolean; allow: string[] } }
    | undefined;

  const defaults = agentsConf?.defaults
    ? pick(agentsConf.defaults, ["model", "subagents"])
    : undefined;

  const agentToAgent = toolsConf?.agentToAgent
    ? {
        enabled: toolsConf.agentToAgent.enabled,
        allow: toolsConf.agentToAgent.allow,
      }
    : undefined;

  // 7. Assemble TeamFile
  const teamFile: TeamFile = {
    version: TEAM_FORMAT_VERSION,
    exported_at: new Date().toISOString(),
    source: instance.slug,
    defaults: defaults as TeamFile["defaults"],
    agent_to_agent: agentToAgent,
    agents: teamAgents,
    links: teamLinks,
  };

  return teamFile;
}

// ---------------------------------------------------------------------------
// Export from blueprint
// ---------------------------------------------------------------------------

export function exportBlueprintTeam(
  registry: Registry,
  blueprintId: number,
): TeamFile {
  const blueprint = registry.getBlueprint(blueprintId);
  if (!blueprint) throw new Error(`Blueprint ${blueprintId} not found`);

  // 1. Load agents
  const agents = registry.listBlueprintAgents(blueprintId);

  // 2. Build team agents (no openclaw.json for blueprints)
  const teamAgents: TeamAgent[] = [];
  for (const agent of agents) {
    const files = registry.listAgentFiles(agent.id);
    // For blueprints, config comes from the model field only
    let config: Record<string, unknown> | undefined;
    if (agent.model) {
      try {
        const parsed = JSON.parse(agent.model);
        config = { model: parsed };
      } catch {
        config = { model: agent.model };
      }
    }
    teamAgents.push(
      buildTeamAgent(agent as unknown as AgentRecord, files, config),
    );
  }

  // 3. Load links
  const links = registry.listBlueprintLinks(blueprintId);
  const teamLinks: TeamLink[] = links.map((l) => ({
    source: l.source_agent_id,
    target: l.target_agent_id,
    type: l.link_type,
  }));

  // 4. Assemble TeamFile
  const teamFile: TeamFile = {
    version: TEAM_FORMAT_VERSION,
    exported_at: new Date().toISOString(),
    source: blueprint.name,
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
