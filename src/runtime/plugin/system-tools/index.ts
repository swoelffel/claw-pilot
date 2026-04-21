// src/runtime/plugin/system-tools/index.ts
//
// Plugin that provides direct DB-backed system management tools to agents of
// the cp-system instance. Tool visibility is scoped per agent id so each
// subagent only sees the tools it actually needs — this keeps the system-pilot
// permanent session prompt small (cheaper + better cache hit rate) and
// enforces that mutations go through the generator agent (ops).

import type { Plugin } from "../types.js";
import type { Tool } from "../../tool/tool.js";
import { createSystemTools } from "./tools.js";

/** Read-only tools (list / get / health / cost summaries). Safe to hand to any agent. */
const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "cp_list_instances",
  "cp_get_instance",
  "cp_list_agents",
  "cp_list_blueprints",
  "cp_list_flows",
  "cp_list_named_keys",
  "cp_system_health",
  "cp_instance_costs",
]);

/** Direct SQL read over registry.db. Scoped to analyst only. */
const SQL_TOOLS: ReadonlySet<string> = new Set(["cp_query_db"]);

/**
 * Per-agent tool scoping for the consolidated 3-agent cp-system team.
 *
 * - `system-pilot`: read-only — must delegate mutations to `ops`. Keeps the
 *   permanent session prompt small and guarantees pilot cannot mutate state
 *   even if it "decides" that would be simpler.
 * - `ops`: all tools except `cp_query_db` — CRUD + lifecycle surface.
 * - `analyst`: read-only + `cp_query_db` — no write access.
 *
 * Any other agent id (e.g. orphaned admin-exec / config-exec / db-analyst /
 * architect rows left on existing instances, or a user-created custom agent
 * on cp-system) gets the full tool surface for backward compatibility.
 */
function filterToolsForAgent(allTools: Tool.Info[], agentId: string | undefined): Tool.Info[] {
  if (agentId === undefined) return allTools;

  if (agentId === "system-pilot") {
    return allTools.filter((t) => READ_ONLY_TOOLS.has(t.id));
  }

  if (agentId === "analyst") {
    return allTools.filter((t) => READ_ONLY_TOOLS.has(t.id) || SQL_TOOLS.has(t.id));
  }

  if (agentId === "ops") {
    return allTools.filter((t) => !SQL_TOOLS.has(t.id));
  }

  // Unknown / legacy agent id — grant full surface for backwards compatibility.
  return allTools;
}

/** System tools plugin -- provides cp_* tools, scoped per agent id. */
export const systemToolsPlugin: Plugin = (input) => {
  // Plugin tools require the DB handle (added in v0.73)
  if (!input.db) return {};
  // Build the full tool set once at init (closure), then filter per-call by agentId.
  const allTools = createSystemTools(input.db, input.instanceSlug);
  return {
    tools: (ctx) => filterToolsForAgent(allTools, ctx.agentId),
  };
};
