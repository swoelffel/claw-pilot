// src/dashboard/routes/instances/agents/skills.ts
// GET /api/instances/:slug/skills — list available skills for a claw-runtime instance
import type { Hono } from "hono";
import type { RouteDeps } from "../../../route-deps.js";
import { instanceGuard } from "../../../../lib/guards.js";
import { getRuntimeStateDir } from "../../../../lib/platform.js";
import { loadConfigDbFirst } from "../../_config-helpers.js";

export interface SkillInfo {
  name: string;
  description: string;
  emoji?: string;
  source: string;
  eligible: boolean;
  disabled: boolean;
}

export interface SkillsListResponse {
  available: boolean;
  skills: SkillInfo[];
}

export function registerAgentSkillsRoutes(app: Hono, deps: RouteDeps): void {
  const { registry } = deps;

  app.get("/api/instances/:slug/skills", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    // claw-runtime: skills are not yet supported at the runtime level.
    // Return an empty list for now — the UI will show "no skills available".
    const fallback: SkillsListResponse = { available: false, skills: [] };

    const stateDir = getRuntimeStateDir(slug);
    const config = loadConfigDbFirst(registry, slug, stateDir);
    if (!config) {
      return c.json(fallback);
    }

    // Future: extract skill info from runtime config if/when claw-runtime supports skills
    return c.json(fallback);
  });
}
