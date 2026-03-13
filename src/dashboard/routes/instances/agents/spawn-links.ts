// src/dashboard/routes/instances/agents/spawn-links.ts
// PATCH /api/instances/:slug/agents/:agentId/spawn-links
import type { Hono } from "hono";
import type { RouteDeps } from "../../../route-deps.js";
import { apiError } from "../../../route-deps.js";
import { instanceGuard } from "../../../../lib/guards.js";
import { AgentSync } from "../../../../core/agent-sync.js";

export function registerAgentSpawnLinkRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, conn, lifecycle } = deps;

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
      // ── claw-runtime: links are DB-only, runtime.json has no spawn concept ──
      if (instance!.instance_type === "claw-runtime") {
        // Validate that source agent exists in DB
        const sourceAgent = registry.getAgentByAgentId(instance!.id, agentId);
        if (!sourceAgent) {
          return apiError(c, 404, "AGENT_NOT_FOUND", `Agent '${agentId}' not found`);
        }

        // Validate that all target agents exist in DB
        for (const targetId of body.targets) {
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
      }

      // ── openclaw: write allowAgents into openclaw.json then sync ────────────
      const configRaw = await conn.readFile(instance!.config_path);
      const config = JSON.parse(configRaw) as Record<string, unknown>;
      const agentsConf = config["agents"] as Record<string, unknown> | undefined;

      const agentsList = (agentsConf?.["list"] ?? []) as Array<Record<string, unknown>>;
      const listEntry = agentsList.find((a) => a["id"] === agentId);

      if (listEntry) {
        let subagents = listEntry["subagents"] as Record<string, unknown> | undefined;
        if (!subagents) {
          subagents = {};
          listEntry["subagents"] = subagents;
        }
        subagents["allowAgents"] = body.targets;
      } else if (agentId === "main") {
        // Ensure agents and agents.defaults exist before writing spawn links
        if (!config["agents"]) {
          config["agents"] = {};
        }
        const agentsConfMut = config["agents"] as Record<string, unknown>;
        if (!agentsConfMut["defaults"]) {
          agentsConfMut["defaults"] = {};
        }
        const defaults = agentsConfMut["defaults"] as Record<string, unknown>;
        let subagents = defaults["subagents"] as Record<string, unknown> | undefined;
        if (!subagents) {
          subagents = {};
          defaults["subagents"] = subagents;
        }
        subagents["allowAgents"] = body.targets;
      } else {
        return apiError(c, 404, "AGENT_NOT_FOUND", `Agent '${agentId}' not found in config`);
      }

      await conn.writeFile(instance!.config_path, JSON.stringify(config, null, 2));

      const agentSync = new AgentSync(conn, registry);
      const result = await agentSync.sync(instance!);

      // Restart daemon fire-and-forget
      lifecycle.restart(slug).catch(() => {
        /* best-effort restart */
      });

      return c.json({
        ok: true,
        links: result.links.map((l) => ({
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
