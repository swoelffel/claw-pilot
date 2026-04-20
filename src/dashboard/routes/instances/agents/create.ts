// src/dashboard/routes/instances/agents/create.ts
// POST /api/instances/:slug/agents
// POST /api/instances/:slug/agents/from-template
import { z } from "zod";
import type { Hono } from "hono";
import type { RouteDeps } from "../../../route-deps.js";
import { apiError } from "../../../route-deps.js";
import { getInstanceContext } from "../../_instance-middleware.js";
import { AgentProvisioner } from "../../../../core/agent-provisioner.js";
import type { CreateAgentData } from "../../../../core/agent-provisioner.js";
import { upsertSearchEntry } from "../../../../core/repositories/search-repository.js";
import { buildAgentPayload } from "../../_helpers.js";
import { logger } from "../../../../lib/logger.js";
import { constants } from "../../../../lib/constants.js";

const RESERVED_AGENT_SLUGS = new Set<string>(constants.RESERVED_AGENT_SLUGS);

/** Returns an error code + message when the agent slug is invalid, else null. */
function validateAgentSlug(slug: string | undefined): { message: string } | null {
  if (!slug) return null;
  if (!/^[a-z][a-z0-9-]*$/.test(slug) || slug.length < 2 || slug.length > 30) {
    return {
      message: "Invalid agentSlug: must be 2-30 lowercase alphanumeric chars with hyphens",
    };
  }
  if (RESERVED_AGENT_SLUGS.has(slug)) {
    return {
      message: `The slug "${slug}" is reserved for the instance shared workspace.`,
    };
  }
  return null;
}

const FromTemplateSchema = z.object({
  blueprintId: z.string().min(1),
  agentSlug: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/)
    .min(2)
    .max(30)
    .refine((s) => !RESERVED_AGENT_SLUGS.has(s), {
      message: "This agent slug is reserved (conflicts with the instance shared workspace).",
    }),
  name: z.string().min(1).max(100).optional(),
  provider: z.string().min(1),
  model: z.string().min(1),
});

export function registerAgentCreateRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, conn, lifecycle } = deps;

  app.post("/api/instances/:slug/agents", async (c) => {
    const { instance, slug } = getInstanceContext(c);

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
      const slugError = validateAgentSlug(body.agentSlug);
      if (slugError) {
        return apiError(c, 400, "INVALID_AGENT_ID", slugError.message);
      }
    } catch (err) {
      logger.warn("[route:agents-create] JSON parse failed", { error: String(err) });
      return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
    }

    try {
      const provisioner = new AgentProvisioner(conn, registry);
      await provisioner.createAgent(instance, body);
    } catch (err: unknown) {
      return apiError(
        c,
        500,
        "AGENT_CREATE_FAILED",
        err instanceof Error ? err.message : "Agent create failed",
      );
    }

    upsertSearchEntry(deps.db, {
      entityType: "agent",
      entityId: `${slug}:${body.agentSlug}`,
      title: body.name || body.agentSlug,
      subtitle: slug,
      routeHash: `/instances/${slug}/builder`,
    });

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
    const { instance, slug } = getInstanceContext(c);

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
      await provisioner.createAgent(instance, agentData);
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
    const agentRecord = registry.getAgentByAgentId(instance.id, agentSlug);
    if (agentRecord && blueprintFiles.length > 0) {
      const provisioner = new AgentProvisioner(conn, registry);
      for (const bpFile of blueprintFiles) {
        if (bpFile.content) {
          try {
            await provisioner.updateAgentFile(instance, agentSlug, bpFile.filename, bpFile.content);
          } catch (err) {
            logger.debug("[route:agents-create] template file copy failed", { error: String(err) });
            // Non-editable file or write failure — skip silently
          }
        }
      }
    }

    upsertSearchEntry(deps.db, {
      entityType: "agent",
      entityId: `${slug}:${agentSlug}`,
      title: agentData.name || agentSlug,
      subtitle: slug,
      routeHash: `/instances/${slug}/builder`,
    });

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
