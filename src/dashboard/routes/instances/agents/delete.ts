// src/dashboard/routes/instances/agents/delete.ts
// DELETE /api/instances/:slug/agents/:agentId
import type { Hono } from "hono";
import type { RouteDeps } from "../../../route-deps.js";
import { apiError } from "../../../route-deps.js";
import { permission } from "../../../middleware/permission.js";
import { ACTIONS } from "../../../middleware/permission-actions.js";
import { getInstanceContext } from "../../_instance-middleware.js";
import { AgentProvisioner } from "../../../../core/agent-provisioner.js";
import { InstanceNotFoundError } from "../../../../lib/errors.js";
import { buildAgentPayload } from "../../_helpers.js";
import { removeSearchEntry } from "../../../../core/repositories/search-repository.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HonoContext = any;

export function registerAgentDeleteRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, conn, lifecycle } = deps;
  const attr = (c: HonoContext) => ({ slug: c.req.param("slug") });
  const aid = (c: HonoContext) => c.req.param("agentId");

  app.delete(
    "/api/instances/:slug/agents/:agentId",
    permission({
      action: ACTIONS.AGENT_DELETE,
      resource: { kind: "agent", id: aid },
      attributes: attr,
    }),
    async (c) => {
      const { instance, slug } = getInstanceContext(c);
      const agentId = c.req.param("agentId");

      try {
        const provisioner = new AgentProvisioner(conn, registry);
        await provisioner.deleteAgent(instance, agentId);
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

      removeSearchEntry(deps.db, "agent", `${slug}:${agentId}`);

      // Restart daemon fire-and-forget
      lifecycle.restart(slug).catch(() => {
        /* best-effort restart */
      });

      const agents = registry.listAgents(instance.slug);
      const links = registry.listAgentLinks(instance.id);
      return c.json(
        {
          instance: {
            slug: instance.slug,
            display_name: instance.display_name,
            port: instance.port,
            state: instance.state,
            default_model: instance.default_model,
          },
          agents: agents.map((agent) =>
            buildAgentPayload(agent, registry.listAgentFiles(agent.id)),
          ),
          links: links.map((l) => ({
            source_agent_id: l.source_agent_id,
            target_agent_id: l.target_agent_id,
            link_type: l.link_type,
          })),
        },
        200,
      );
    },
  );
}
