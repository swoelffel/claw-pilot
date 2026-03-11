// src/dashboard/routes/instances/agents/delete.ts
// DELETE /api/instances/:slug/agents/:agentId
import type { Hono } from "hono";
import type { RouteDeps } from "../../../route-deps.js";
import { apiError } from "../../../route-deps.js";
import { instanceGuard } from "../../../../lib/guards.js";
import { AgentProvisioner } from "../../../../core/agent-provisioner.js";
import { InstanceNotFoundError } from "../../../../lib/errors.js";
import { buildAgentPayload } from "../../_helpers.js";

export function registerAgentDeleteRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, conn, lifecycle } = deps;

  app.delete("/api/instances/:slug/agents/:agentId", async (c) => {
    const slug = c.req.param("slug");
    const agentId = c.req.param("agentId");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    try {
      const provisioner = new AgentProvisioner(conn, registry);
      await provisioner.deleteAgent(instance!, agentId);
    } catch (err: unknown) {
      if (err instanceof InstanceNotFoundError) {
        return apiError(c, 404, "AGENT_NOT_FOUND", err.message);
      }
      return apiError(
        c,
        500,
        "AGENT_DELETE_FAILED",
        err instanceof Error ? err.message : "Agent delete failed",
      );
    }

    // Restart daemon fire-and-forget
    lifecycle.restart(slug).catch(() => {
      /* best-effort restart */
    });

    const agents = registry.listAgents(instance!.slug);
    const links = registry.listAgentLinks(instance!.id);
    return c.json(
      {
        instance: {
          slug: instance!.slug,
          display_name: instance!.display_name,
          port: instance!.port,
          state: instance!.state,
          default_model: instance!.default_model,
        },
        agents: agents.map((agent) => buildAgentPayload(agent, registry.listAgentFiles(agent.id))),
        links: links.map((l) => ({
          source_agent_id: l.source_agent_id,
          target_agent_id: l.target_agent_id,
          link_type: l.link_type,
        })),
      },
      200,
    );
  });
}
