// src/dashboard/routes/instances/agents/sync.ts
// POST /api/instances/:slug/agents/sync
import type { Hono } from "hono";
import type { RouteDeps } from "../../../route-deps.js";
import { apiError } from "../../../route-deps.js";
import { instanceGuard } from "../../../../lib/guards.js";
import { AgentSync } from "../../../../core/agent-sync.js";

export function registerAgentSyncRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, conn } = deps;

  app.post("/api/instances/:slug/agents/sync", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    // claw-runtime: agents are DB-only, no config file to sync from.
    // AgentSync reads openclaw.json format (agents.list[]) — calling it on a
    // claw-runtime instance would wipe all agents from the DB.
    if (instance!.instance_type === "claw-runtime") {
      const agents = registry.listAgents(slug);
      const links = registry.listAgentLinks(instance!.id);
      return c.json({
        synced: true,
        agents: agents.map((a) => ({ agent_id: a.agent_id, name: a.name })),
        links,
        changes: {
          agentsAdded: [],
          agentsRemoved: [],
          agentsUpdated: [],
          filesChanged: 0,
          linksChanged: 0,
        },
      });
    }

    try {
      const agentSync = new AgentSync(conn, registry);
      const result = await agentSync.sync(instance!);
      return c.json({ synced: true, ...result });
    } catch (err) {
      return apiError(c, 500, "SYNC_FAILED", err instanceof Error ? err.message : "Sync failed");
    }
  });
}
