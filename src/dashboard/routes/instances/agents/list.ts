// src/dashboard/routes/instances/agents/list.ts
// GET /api/instances/:slug/agents
import type { Hono } from "hono";
import type { RouteDeps } from "../../../route-deps.js";
import { instanceGuard } from "../../../../lib/guards.js";
import { buildAgentPayload } from "../../_helpers.js";

export function registerAgentListRoutes(app: Hono, deps: RouteDeps): void {
  const { registry } = deps;

  app.get("/api/instances/:slug/agents", (c) => {
    const slug = c.req.param("slug");
    const agents = registry.listAgents(slug);
    return c.json(agents);
  });

  // GET /api/instances/:slug/agents/builder — full builder payload
  app.get("/api/instances/:slug/agents/builder", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;
    const inst = instance!;

    const agents = registry.listAgents(inst.slug);
    const links = registry.listAgentLinks(inst.id);

    // Enrich with archetype from runtime config (avoids extra API call from frontend)
    const archetypeMap = new Map<string, string>();
    const config = registry.getRuntimeConfig(inst.slug);
    if (config) {
      for (const a of config.agents) {
        if (a.archetype) archetypeMap.set(a.id, a.archetype);
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
      })),
      links: links.map((l) => ({
        source_agent_id: l.source_agent_id,
        target_agent_id: l.target_agent_id,
        link_type: l.link_type,
      })),
    });
  });
}
