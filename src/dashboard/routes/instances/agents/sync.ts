// src/dashboard/routes/instances/agents/sync.ts
// POST /api/instances/:slug/agents/sync
import { createHash } from "node:crypto";
import type { Hono } from "hono";
import type { RouteDeps } from "../../../route-deps.js";
import { apiError } from "../../../route-deps.js";
import { instanceGuard } from "../../../../lib/guards.js";
import { constants } from "../../../../lib/constants.js";

export function registerAgentSyncRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, conn } = deps;

  app.post("/api/instances/:slug/agents/sync", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    try {
      // claw-runtime: agents are DB-only, no config file to sync from.
      // We sync workspace files from disk -> DB.
      const agents = registry.listAgents(slug);
      const links = registry.listAgentLinks(instance!.id);
      let filesChanged = 0;

      for (const agent of agents) {
        const wp = agent.workspace_path;
        if (!wp) continue;

        const dbFiles = new Map(registry.listAgentFiles(agent.id).map((f) => [f.filename, f]));

        for (const filename of constants.DISCOVERABLE_FILES) {
          let content: string;
          try {
            content = await conn.readFile(`${wp}/${filename}`);
          } catch {
            // File absent — remove from DB if cached
            if (dbFiles.has(filename)) {
              registry.deleteAgentFile(agent.id, filename);
              filesChanged++;
            }
            dbFiles.delete(filename);
            continue;
          }

          const contentHash = createHash("sha256").update(content, "utf8").digest("hex");
          const dbFile = dbFiles.get(filename);

          if (!dbFile || dbFile.content_hash !== contentHash) {
            registry.upsertAgentFile(agent.id, { filename, content, contentHash });
            filesChanged++;
          }
          dbFiles.delete(filename);
        }

        // Remove DB files no longer on disk
        for (const [filename] of dbFiles) {
          registry.deleteAgentFile(agent.id, filename);
          filesChanged++;
        }
      }

      return c.json({
        synced: true,
        agents: agents.map((a) => ({ agent_id: a.agent_id, name: a.name })),
        links,
        changes: {
          agentsAdded: [],
          agentsRemoved: [],
          agentsUpdated: [],
          filesChanged,
          linksChanged: 0,
        },
      });
    } catch (err) {
      return apiError(c, 500, "SYNC_FAILED", err instanceof Error ? err.message : "Sync failed");
    }
  });
}
