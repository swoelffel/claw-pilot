// src/dashboard/routes/instances/agents/create.ts
// POST /api/instances/:slug/agents
// POST /api/instances/:slug/agents/from-template
import { z } from "zod";
import type { Hono } from "hono";
import type { RouteDeps } from "../../../route-deps.js";
import { apiError } from "../../../route-deps.js";
import { instanceGuard } from "../../../../lib/guards.js";
import { AgentProvisioner } from "../../../../core/agent-provisioner.js";
import type { CreateAgentData } from "../../../../core/agent-provisioner.js";
import { buildAgentPayload } from "../../_helpers.js";

const FromTemplateSchema = z.object({
  blueprintId: z.string().min(1),
  agentSlug: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/)
    .min(2)
    .max(30),
  name: z.string().min(1).max(100).optional(),
  provider: z.string().min(1),
  model: z.string().min(1),
});

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

  // --- POST /api/instances/:slug/agents/from-template ---
  // Creates an agent in the instance using an agent blueprint as a template.
  // The blueprint's workspace files are copied to the new agent's workspace.
  app.post("/api/instances/:slug/agents/from-template", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const rawBody = await c.req.json().catch(() => null);
    const parsed = FromTemplateSchema.safeParse(rawBody);
    if (!parsed.success) {
      return apiError(c, 400, "INVALID_BODY", parsed.error.message);
    }
    const { blueprintId, agentSlug, name, provider, model } = parsed.data;

    // Verify blueprint exists
    const blueprint = registry.getAgentBlueprint(blueprintId);
    if (!blueprint) {
      return apiError(c, 404, "NOT_FOUND", `Agent blueprint not found: ${blueprintId}`);
    }

    // Create the agent via the standard provisioner
    const agentData: CreateAgentData = {
      agentSlug,
      name: name ?? blueprint.name,
      role: "",
      provider,
      model,
    };

    try {
      const provisioner = new AgentProvisioner(conn, registry);
      await provisioner.createAgent(instance!, agentData);
    } catch (err: unknown) {
      return apiError(
        c,
        500,
        "AGENT_CREATE_FAILED",
        err instanceof Error ? err.message : "Agent create failed",
      );
    }

    // Overwrite the agent's workspace files with the blueprint's files
    const blueprintFiles = registry.listAgentBlueprintFiles(blueprintId);
    const agentRecord = registry.getAgentByAgentId(instance!.id, agentSlug);
    if (agentRecord && blueprintFiles.length > 0) {
      const provisioner = new AgentProvisioner(conn, registry);
      for (const bpFile of blueprintFiles) {
        if (bpFile.content) {
          try {
            await provisioner.updateAgentFile(
              instance!,
              agentSlug,
              bpFile.filename,
              bpFile.content,
            );
          } catch {
            // Non-editable file or write failure — skip silently
          }
        }
      }
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
