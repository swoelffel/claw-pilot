// src/dashboard/routes/teams.ts
import type { Hono } from "hono";
import type { RouteDeps } from "../route-deps.js";
import { apiError } from "../route-deps.js";
import { instanceGuard } from "../../lib/guards.js";
import { permission } from "../middleware/permission.js";
import { ACTIONS } from "../middleware/permission-actions.js";
import {
  exportInstanceTeam,
  exportBlueprintTeam,
  serializeTeamYaml,
} from "../../core/team-export.js";
import {
  parseAndValidateTeam,
  importInstanceTeam,
  importBlueprintTeam,
} from "../../core/team-import.js";
import { logger } from "../../lib/logger.js";
import { rebuildSearchIndex } from "../../core/repositories/search-repository.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HonoContext = any;

/** Log team validation errors and return an API error response. Returns null if parsed successfully. */
function handleTeamValidationError(
  c: HonoContext,
  parsed: ReturnType<typeof parseAndValidateTeam>,
  entityLabel: string,
): ReturnType<typeof apiError> | null {
  if (parsed.success) return null;
  const err = parsed.error;
  if (err.error === "yaml_parse_error") {
    logger.error(`[team-import] YAML parse error for ${entityLabel}: ${err.message ?? ""}`);
    return c.json(
      { ok: false, error: "YAML_PARSE_ERROR", message: err.message ?? "Invalid YAML" },
      400,
    ) as ReturnType<typeof apiError>;
  }
  const details = err.details ?? [];
  logger.error(`[team-import] Validation failed for ${entityLabel} — ${details.length} issue(s):`);
  for (const d of details) {
    logger.error(`  [team-import]   path="${d.path || "(root)"}" — ${d.message}`);
  }
  const humanMessage =
    details.length > 0
      ? details.map((d) => `${d.path ? `[${d.path}] ` : ""}${d.message}`).join(" | ")
      : "Invalid team file format";
  return apiError(c, 400, "VALIDATION_FAILED", humanMessage);
}

/** Handle GET /api/instances/:slug/team/export. */
async function handleExportInstanceTeam(c: HonoContext, deps: RouteDeps): Promise<Response> {
  const { registry, conn } = deps;
  const slug = c.req.param("slug");
  const instance = registry.getInstance(slug);
  const guard = instanceGuard(c, instance);
  if (guard) return guard;
  try {
    const team = await exportInstanceTeam(conn, registry, instance!);
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
}

/** Handle POST /api/instances/:slug/team/import. */
async function handleImportInstanceTeam(c: HonoContext, deps: RouteDeps): Promise<Response> {
  const { registry, conn, xdgRuntimeDir } = deps;
  const slug = c.req.param("slug");
  const instance = registry.getInstance(slug);
  const guard = instanceGuard(c, instance);
  if (guard) return guard;
  const inst = instance!;
  const dryRun = c.req.query("dry_run") === "true";
  let yamlContent: string;
  try {
    yamlContent = await c.req.text();
  } catch (err) {
    logger.warn("[route:teams] request body read failed for instance import", {
      error: String(err),
    });
    return apiError(c, 400, "INVALID_BODY", "Could not read request body");
  }
  logger.info(`[team-import] instance=${slug} dry_run=${dryRun} size=${yamlContent.length}B`);
  const parsed = parseAndValidateTeam(yamlContent);
  const validationError = handleTeamValidationError(c, parsed, `instance=${slug}`);
  if (validationError) return validationError;
  if (!parsed.success) return apiError(c, 400, "VALIDATION_FAILED", "Validation failed");
  logger.info(
    `[team-import] Validated OK — ${parsed.data.agents.length} agents, ${parsed.data.links.length} links`,
  );
  try {
    const result = await importInstanceTeam(
      registry.getDb(),
      registry,
      conn,
      inst,
      parsed.data,
      xdgRuntimeDir,
      dryRun,
    );
    logger.info(`[team-import] ${dryRun ? "Dry-run" : "Import"} complete for instance=${slug}`);
    rebuildSearchIndex(deps.db);
    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Import failed";
    logger.error(`[team-import] Import error for instance=${slug}: ${msg}`);
    if (err instanceof Error && err.stack) logger.error(err.stack);
    return apiError(c, 500, "IMPORT_FAILED", msg);
  }
}

/** Handle GET /api/blueprints/:id/team/export. */
function handleExportBlueprintTeam(c: HonoContext, deps: RouteDeps): Response {
  const { registry } = deps;
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return apiError(c, 400, "FIELD_INVALID", "Invalid id");
  const blueprint = registry.getBlueprint(id);
  if (!blueprint) return apiError(c, 404, "NOT_FOUND", "Not found");
  try {
    const team = exportBlueprintTeam(registry, id);
    const yaml = serializeTeamYaml(team);
    const filename = `${blueprint.name.toLowerCase().replace(/\s+/g, "-")}-team.yaml`;
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
}

/** Handle POST /api/blueprints/:id/team/import. */
async function handleImportBlueprintTeam(c: HonoContext, deps: RouteDeps): Promise<Response> {
  const { registry } = deps;
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return apiError(c, 400, "FIELD_INVALID", "Invalid id");
  const blueprint = registry.getBlueprint(id);
  if (!blueprint) return apiError(c, 404, "NOT_FOUND", "Not found");
  const dryRun = c.req.query("dry_run") === "true";
  let yamlContent: string;
  try {
    yamlContent = await c.req.text();
  } catch (err) {
    logger.warn("[route:teams] request body read failed for blueprint import", {
      error: String(err),
    });
    return apiError(c, 400, "INVALID_BODY", "Could not read request body");
  }
  logger.info(`[team-import] blueprint=${id} dry_run=${dryRun} size=${yamlContent.length}B`);
  const parsed = parseAndValidateTeam(yamlContent);
  const validationError = handleTeamValidationError(c, parsed, `blueprint=${id}`);
  if (validationError) return validationError;
  if (!parsed.success) return apiError(c, 400, "VALIDATION_FAILED", "Validation failed");
  logger.info(
    `[team-import] Validated OK — ${parsed.data.agents.length} agents, ${parsed.data.links.length} links`,
  );
  try {
    const result = await importBlueprintTeam(registry.getDb(), registry, id, parsed.data, dryRun);
    logger.info(`[team-import] ${dryRun ? "Dry-run" : "Import"} complete for blueprint=${id}`);
    rebuildSearchIndex(deps.db);
    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Import failed";
    logger.error(`[team-import] Import error for blueprint=${id}: ${msg}`);
    if (err instanceof Error && err.stack) logger.error(err.stack);
    return apiError(c, 500, "IMPORT_FAILED", msg);
  }
}

export function registerTeamRoutes(app: Hono, deps: RouteDeps) {
  app.get(
    "/api/instances/:slug/team/export",
    permission({
      action: ACTIONS.TEAM_EXPORT,
      resource: { kind: "team", id: (c) => c.req.param("slug") },
    }),
    async (c) => handleExportInstanceTeam(c, deps),
  );
  app.post(
    "/api/instances/:slug/team/import",
    permission({
      action: ACTIONS.TEAM_IMPORT,
      resource: { kind: "team", id: (c) => c.req.param("slug") },
    }),
    async (c) => handleImportInstanceTeam(c, deps),
  );
  app.get(
    "/api/blueprints/:id/team/export",
    permission({
      action: ACTIONS.TEAM_EXPORT,
      resource: { kind: "team", id: (c) => c.req.param("id") },
    }),
    (c) => handleExportBlueprintTeam(c, deps),
  );
  app.post(
    "/api/blueprints/:id/team/import",
    permission({
      action: ACTIONS.TEAM_IMPORT,
      resource: { kind: "team", id: (c) => c.req.param("id") },
    }),
    async (c) => handleImportBlueprintTeam(c, deps),
  );
}
