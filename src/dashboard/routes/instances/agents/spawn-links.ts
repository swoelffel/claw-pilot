// src/dashboard/routes/instances/agents/spawn-links.ts
// PATCH /api/instances/:slug/agents/:agentId/spawn-links
import type { Hono } from "hono";
import type { RouteDeps } from "../../../route-deps.js";
import { apiError } from "../../../route-deps.js";
import { instanceGuard } from "../../../../lib/guards.js";
import { AgentSync } from "../../../../core/agent-sync.js";

export function registerAgentSpawnLinkRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, conn, lifecycle } = deps;

  // PATCH /api/instances/:slug/agents/:agentId/spawn-links — update spawn targets in openclaw.json
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
        const defaults = agentsConf?.["defaults"] as Record<string, unknown> | undefined;
        if (defaults) {
          let subagents = defaults["subagents"] as Record<string, unknown> | undefined;
          if (!subagents) {
            subagents = {};
            defaults["subagents"] = subagents;
          }
          subagents["allowAgents"] = body.targets;
        }
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
