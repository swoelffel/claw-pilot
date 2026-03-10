// src/dashboard/routes/teams.ts
import type { Hono } from "hono";
import type { RouteDeps } from "../route-deps.js";
import { apiError } from "../route-deps.js";
import { exportInstanceTeam, exportBlueprintTeam, serializeTeamYaml } from "../../core/team-export.js";
import { parseAndValidateTeam, importInstanceTeam, importBlueprintTeam } from "../../core/team-import.js";
import { logger } from "../../lib/logger.js";

export function registerTeamRoutes(app: Hono, deps: RouteDeps) {
  const { registry, conn, xdgRuntimeDir } = deps;

  // GET /api/instances/:slug/team/export — export instance team as YAML
  app.get("/api/instances/:slug/team/export", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    if (!instance) return apiError(c, 404, "NOT_FOUND", "Not found");

    try {
      const team = await exportInstanceTeam(conn, registry, instance);
      const yaml = serializeTeamYaml(team);
      return new Response(yaml, {
        status: 200,
        headers: {
          "Content-Type": "text/yaml; charset=utf-8",
          "Content-Disposition": `attachment; filename="${slug}-team.yaml"`,
        },
      });
    } catch (err) {
      return apiError(c, 500, "EXPORT_FAILED", err instanceof Error ? err.message : "Export failed");
    }
  });

  // POST /api/instances/:slug/team/import — import team YAML into instance
  app.post("/api/instances/:slug/team/import", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    if (!instance) return apiError(c, 404, "NOT_FOUND", "Not found");

    const dryRun = c.req.query("dry_run") === "true";

    let yamlContent: string;
    try {
      yamlContent = await c.req.text();
    } catch {
      return apiError(c, 400, "INVALID_BODY", "Could not read request body");
    }

    logger.info(`[team-import] instance=${slug} dry_run=${dryRun} size=${yamlContent.length}B`);

    const parsed = parseAndValidateTeam(yamlContent);
    if (!parsed.success) {
      const err = parsed.error;
      if (err.error === "yaml_parse_error") {
        logger.error(`[team-import] YAML parse error for instance=${slug}: ${err.message ?? ""}`);
        return c.json({ ok: false, error: "YAML_PARSE_ERROR", message: err.message ?? "Invalid YAML" }, 400);
      }
      // validation_failed — log each Zod issue
      const details = err.details ?? [];
      logger.error(`[team-import] Validation failed for instance=${slug} — ${details.length} issue(s):`);
      for (const d of details) {
        logger.error(`  [team-import]   path="${d.path || "(root)"}" — ${d.message}`);
      }
      const humanMessage = details.length > 0
        ? details.map((d) => `${d.path ? `[${d.path}] ` : ""}${d.message}`).join(" | ")
        : "Invalid team file format";
      return c.json({ ok: false, error: "VALIDATION_FAILED", message: humanMessage, details }, 400);
    }

    logger.info(`[team-import] Validated OK — ${parsed.data.agents.length} agents, ${parsed.data.links.length} links`);

    try {
      const result = await importInstanceTeam(
        registry.getDb(),
        registry,
        conn,
        instance,
        parsed.data,
        xdgRuntimeDir,
        dryRun,
      );
      logger.info(`[team-import] ${dryRun ? "Dry-run" : "Import"} complete for instance=${slug}`);
      return c.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Import failed";
      logger.error(`[team-import] Import error for instance=${slug}: ${msg}`);
      if (err instanceof Error && err.stack) logger.error(err.stack);
      return apiError(c, 500, "IMPORT_FAILED", msg);
    }
  });

  // GET /api/blueprints/:id/team/export — export blueprint team as YAML
  app.get("/api/blueprints/:id/team/export", (c) => {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) return apiError(c, 400, "FIELD_INVALID", "Invalid id");

    try {
      const team = exportBlueprintTeam(registry, id);
      const yaml = serializeTeamYaml(team);
      const blueprint = registry.getBlueprint(id);
      const filename = blueprint ? `${blueprint.name.toLowerCase().replace(/\s+/g, "-")}-team.yaml` : `blueprint-${id}-team.yaml`;
      return new Response(yaml, {
        status: 200,
        headers: {
          "Content-Type": "text/yaml; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    } catch (err) {
      return apiError(c, 500, "EXPORT_FAILED", err instanceof Error ? err.message : "Export failed");
    }
  });

  // POST /api/blueprints/:id/team/import — import team YAML into blueprint
  app.post("/api/blueprints/:id/team/import", async (c) => {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) return apiError(c, 400, "FIELD_INVALID", "Invalid id");

    const blueprint = registry.getBlueprint(id);
    if (!blueprint) return apiError(c, 404, "NOT_FOUND", "Not found");

    const dryRun = c.req.query("dry_run") === "true";

    let yamlContent: string;
    try {
      yamlContent = await c.req.text();
    } catch {
      return apiError(c, 400, "INVALID_BODY", "Could not read request body");
    }

    logger.info(`[team-import] blueprint=${id} dry_run=${dryRun} size=${yamlContent.length}B`);

    const parsed = parseAndValidateTeam(yamlContent);
    if (!parsed.success) {
      const err = parsed.error;
      if (err.error === "yaml_parse_error") {
        logger.error(`[team-import] YAML parse error for blueprint=${id}: ${err.message ?? ""}`);
        return c.json({ ok: false, error: "YAML_PARSE_ERROR", message: err.message ?? "Invalid YAML" }, 400);
      }
      const details = err.details ?? [];
      logger.error(`[team-import] Validation failed for blueprint=${id} — ${details.length} issue(s):`);
      for (const d of details) {
        logger.error(`  [team-import]   path="${d.path || "(root)"}" — ${d.message}`);
      }
      const humanMessage = details.length > 0
        ? details.map((d) => `${d.path ? `[${d.path}] ` : ""}${d.message}`).join(" | ")
        : "Invalid team file format";
      return c.json({ ok: false, error: "VALIDATION_FAILED", message: humanMessage, details }, 400);
    }

    logger.info(`[team-import] Validated OK — ${parsed.data.agents.length} agents, ${parsed.data.links.length} links`);

    try {
      const result = await importBlueprintTeam(
        registry.getDb(),
        registry,
        id,
        parsed.data,
        dryRun,
      );
      logger.info(`[team-import] ${dryRun ? "Dry-run" : "Import"} complete for blueprint=${id}`);
      return c.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Import failed";
      logger.error(`[team-import] Import error for blueprint=${id}: ${msg}`);
      if (err instanceof Error && err.stack) logger.error(err.stack);
      return apiError(c, 500, "IMPORT_FAILED", msg);
    }
  });
}
