// src/dashboard/routes/instances/agents/spawn-links.ts
// PATCH /api/instances/:slug/agents/:agentId/spawn-links
import type { Hono } from "hono";
import type { RouteDeps } from "../../../route-deps.js";
import { apiError } from "../../../route-deps.js";
import { instanceGuard } from "../../../../lib/guards.js";

export function registerAgentSpawnLinkRoutes(app: Hono, deps: RouteDeps): void {
  const { registry } = deps;

  // PATCH /api/instances/:slug/agents/:agentId/spawn-links — update spawn targets
  app.patch("/api/instances/:slug/agents/:agentId/spawn-links", async (c) => {
    const slug = c.req.param("slug");
    const agentId = c.req.param("agentId");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    let body: { targets: string[] };
    try {
      body = await c.req.json();
      if (
        !Array.isArray(body.targets) ||
        !body.targets.every((t: unknown) => typeof t === "string")
      ) {
        return apiError(c, 400, "FIELD_INVALID", "targets must be an array of strings");
      }
    } catch {
      return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
    }

    try {
      // claw-runtime: links are DB-only, runtime.json has no spawn concept
      // Validate that source agent exists in DB
      const sourceAgent = registry.getAgentByAgentId(instance!.id, agentId);
      if (!sourceAgent) {
        return apiError(c, 404, "AGENT_NOT_FOUND", `Agent '${agentId}' not found`);
      }

      // Validate that all target agents exist in DB (or are @archetype references)
      const validArchetypes = new Set([
        "planner",
        "generator",
        "evaluator",
        "orchestrator",
        "analyst",
        "communicator",
      ]);
      for (const targetId of body.targets) {
        if (targetId.startsWith("@")) {
          const archetype = targetId.slice(1);
          if (!validArchetypes.has(archetype)) {
            return apiError(
              c,
              400,
              "FIELD_INVALID",
              `Invalid archetype reference '${targetId}'. Valid archetypes: ${[...validArchetypes].join(", ")}`,
            );
          }
          continue;
        }
        const targetAgent = registry.getAgentByAgentId(instance!.id, targetId);
        if (!targetAgent) {
          return apiError(c, 404, "AGENT_NOT_FOUND", `Target agent '${targetId}' not found`);
        }
      }

      // Atomically replace spawn links for this source agent in DB
      const allLinks = registry.listAgentLinks(instance!.id);
      const otherLinks = allLinks
        .filter((l) => !(l.source_agent_id === agentId && l.link_type === "spawn"))
        .map((l) => ({
          sourceAgentId: l.source_agent_id,
          targetAgentId: l.target_agent_id,
          linkType: l.link_type as "a2a" | "spawn",
        }));
      const newLinks = body.targets.map((targetId) => ({
        sourceAgentId: agentId,
        targetAgentId: targetId,
        linkType: "spawn" as const,
      }));
      registry.replaceAgentLinks(instance!.id, [...otherLinks, ...newLinks]);

      const updatedLinks = registry.listAgentLinks(instance!.id);
      return c.json({
        ok: true,
        links: updatedLinks.map((l) => ({
          source_agent_id: l.source_agent_id,
          target_agent_id: l.target_agent_id,
          link_type: l.link_type,
        })),
      });
    } catch (err) {
      return apiError(
        c,
        500,
        "LINK_UPDATE_FAILED",
        err instanceof Error ? err.message : "Failed to update spawn links",
      );
    }
  });
}
