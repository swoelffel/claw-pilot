// src/dashboard/routes/instances/agents/update.ts
// PATCH /api/instances/:slug/agents/:agentId/position
// PATCH /api/instances/:slug/agents/:agentId/meta
import type { Hono } from "hono";
import type { RouteDeps } from "../../../route-deps.js";
import { apiError } from "../../../route-deps.js";
import { instanceGuard } from "../../../../lib/guards.js";
import { z } from "zod";

const AgentMetaPatchSchema = z
  .object({
    role: z.string().max(200).nullable().optional(),
    tags: z.string().max(500).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
    skills: z.array(z.string()).nullable().optional(), // NULL = accès à toutes les skills
  })
  .strict();

export function registerAgentUpdateRoutes(app: Hono, deps: RouteDeps): void {
  const { registry } = deps;

  // PATCH /api/instances/:slug/agents/:agentId/position — persist canvas position
  app.patch("/api/instances/:slug/agents/:agentId/position", async (c) => {
    const slug = c.req.param("slug");
    const agentId = c.req.param("agentId");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    let body: { x: number; y: number };
    try {
      body = (await c.req.json()) as { x: number; y: number };
      if (typeof body.x !== "number" || typeof body.y !== "number") {
        return apiError(c, 400, "FIELD_INVALID", "x and y must be numbers");
      }
    } catch {
      return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
    }

    const agent = registry.getAgentByAgentId(instance!.id, agentId);
    if (!agent) return apiError(c, 404, "AGENT_NOT_FOUND", "Agent not found");

    registry.updateAgentPosition(agent.id, body.x, body.y);
    return c.json({ ok: true });
  });

  // PATCH /api/instances/:slug/agents/:agentId/meta — update SQLite-side agent fields
  app.patch("/api/instances/:slug/agents/:agentId/meta", async (c) => {
    const slug = c.req.param("slug");
    const agentId = c.req.param("agentId");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
    }

    const parsed = AgentMetaPatchSchema.safeParse(raw);
    if (!parsed.success) {
      return apiError(c, 400, "FIELD_INVALID", parsed.error.issues[0]?.message ?? "Invalid fields");
    }

    const agent = registry.getAgentByAgentId(instance!.id, agentId);
    if (!agent) return apiError(c, 404, "AGENT_NOT_FOUND", "Agent not found");

    registry.updateAgentMeta(agent.id, parsed.data);
    return c.json({ ok: true });
  });
}
