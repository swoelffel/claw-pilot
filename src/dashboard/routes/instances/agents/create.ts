// src/dashboard/routes/instances/agents/create.ts
// POST /api/instances/:slug/agents
import type { Hono } from "hono";
import type { RouteDeps } from "../../../route-deps.js";
import { apiError } from "../../../route-deps.js";
import { instanceGuard } from "../../../../lib/guards.js";
import { AgentProvisioner } from "../../../../core/agent-provisioner.js";
import type { CreateAgentData } from "../../../../core/agent-provisioner.js";
import { buildAgentPayload } from "../../_helpers.js";

export function registerAgentCreateRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, conn, lifecycle } = deps;

  app.post("/api/instances/:slug/agents", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    let body: CreateAgentData;
    try {
      body = (await c.req.json()) as CreateAgentData;
      if (!body.agentSlug || !body.name || !body.provider || !body.model) {
        return apiError(
          c,
          400,
          "FIELD_REQUIRED",
          "Missing required fields: agentSlug, name, provider, model",
        );
      }
      if (
        !/^[a-z][a-z0-9-]*$/.test(body.agentSlug) ||
        body.agentSlug.length < 2 ||
        body.agentSlug.length > 30
      ) {
        return apiError(
          c,
          400,
          "INVALID_AGENT_ID",
          "Invalid agentSlug: must be 2-30 lowercase alphanumeric chars with hyphens",
        );
      }
    } catch {
      return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
    }

    try {
      const provisioner = new AgentProvisioner(conn, registry);
      await provisioner.createAgent(instance!, body);
    } catch (err: unknown) {
      return apiError(
        c,
        500,
        "AGENT_CREATE_FAILED",
        err instanceof Error ? err.message : "Agent create failed",
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
      201,
    );
  });
}
