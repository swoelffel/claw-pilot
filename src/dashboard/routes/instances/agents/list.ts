// src/dashboard/routes/instances/agents/list.ts
// GET /api/instances/:slug/agents
import type { Hono } from "hono";
import type { RouteDeps } from "../../../route-deps.js";
import { permission } from "../../../middleware/permission.js";
import { ACTIONS } from "../../../middleware/permission-actions.js";
import { getInstanceContext } from "../../_instance-middleware.js";
import { buildAgentPayload } from "../../_helpers.js";
import { logger } from "../../../../lib/logger.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HonoContext = any;

export function registerAgentListRoutes(app: Hono, deps: RouteDeps): void {
  const { registry } = deps;
  const attr = (c: HonoContext) => ({ slug: c.req.param("slug") });

  app.get(
    "/api/instances/:slug/agents",
    permission({ action: ACTIONS.AGENT_LIST, resource: { kind: "agent" }, attributes: attr }),
    (c) => {
      const slug = c.req.param("slug");
      const agents = registry.listAgents(slug);
      return c.json(agents);
    },
  );

  // GET /api/instances/:slug/agents/builder — full builder payload
  app.get(
    "/api/instances/:slug/agents/builder",
    permission({
      action: ACTIONS.AGENT_BUILDER_READ,
      resource: { kind: "agent" },
      attributes: attr,
    }),
    (c) => {
      const { instance: inst } = getInstanceContext(c);

      const agents = registry.listAgents(inst.slug);
      const links = registry.listAgentLinks(inst.id);

      // Enrich with archetype + persistence from DB (raw JSON extraction — no Zod parse)
      const archetypeMap = new Map<string, string>();
      const persistenceMap = new Map<string, string>();
      const rawJson = registry.getRawRuntimeConfigJson(inst.slug);
      if (rawJson) {
        try {
          const parsed = JSON.parse(rawJson) as {
            agents?: Array<{ id: string; archetype?: string | null; persistence?: string | null }>;
          };
          for (const a of parsed.agents ?? []) {
            if (a.archetype) archetypeMap.set(a.id, a.archetype);
            if (a.persistence) persistenceMap.set(a.id, a.persistence);
          }
        } catch (err) {
          logger.debug("[route:agents-list] runtime config JSON parse failed", {
            error: String(err),
          });
          /* intentionally ignored — enrichment is best-effort */
        }
      }

      return c.json({
        instance: {
          slug: inst.slug,
          display_name: inst.display_name,
          port: inst.port,
          state: inst.state,
          default_model: inst.default_model,
        },
        agents: agents.map((agent) => ({
          ...buildAgentPayload(agent, registry.listAgentFiles(agent.id)),
          archetype: archetypeMap.get(agent.agent_id) ?? null,
          persistence: persistenceMap.get(agent.agent_id) ?? null,
        })),
        links: links.map((l) => ({
          source_agent_id: l.source_agent_id,
          target_agent_id: l.target_agent_id,
          link_type: l.link_type,
        })),
      });
    },
  );
}
