// src/dashboard/routes/instances/permissions.ts
// Routes: GET /api/instances/:slug/runtime/permissions
//         DELETE /api/instances/:slug/runtime/permissions/:id
//         POST /api/instances/:slug/runtime/permission/reply
//
// Expose les règles de permissions persistées (rt_permissions) et permet
// de répondre aux demandes de permission en attente via le bus.

import type { Hono } from "hono";
import { z } from "zod";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { getInstanceContext } from "../_instance-middleware.js";
import { publishRuntimeEvent } from "../_internal-api-client.js";
import { logger } from "../../../lib/logger.js";

// ---------------------------------------------------------------------------
// Zod schema — body de POST /reply
// ---------------------------------------------------------------------------

const ReplyBodySchema = z.object({
  permissionId: z.string().min(1),
  decision: z.enum(["allow", "deny"]),
  persist: z.boolean(),
  comment: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Types DB
// ---------------------------------------------------------------------------

interface RtPermissionRow {
  id: string;
  instance_slug: string;
  scope: string;
  permission: string;
  pattern: string;
  action: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerPermissionRoutes(app: Hono, deps: RouteDeps): void {
  const { db } = deps;

  // -------------------------------------------------------------------------
  // GET /api/instances/:slug/runtime/permissions
  // Liste les règles persistées dans rt_permissions pour cette instance.
  // -------------------------------------------------------------------------
  app.get("/api/instances/:slug/runtime/permissions", (c) => {
    const { slug } = getInstanceContext(c);

    let rules: RtPermissionRow[] = [];
    try {
      rules = db
        .prepare(
          `SELECT id, instance_slug, scope, permission, pattern, action, created_at
           FROM rt_permissions
           WHERE instance_slug = ?
           ORDER BY created_at DESC`,
        )
        .all(slug) as RtPermissionRow[];
    } catch (err) {
      logger.debug("[route:permissions] permissions query failed", { error: String(err) });
      // Table may not exist on older DBs — return empty list gracefully
      rules = [];
    }

    return c.json({ rules });
  });

  // -------------------------------------------------------------------------
  // DELETE /api/instances/:slug/runtime/permissions/:id
  // Supprime une règle persistée par son id.
  // -------------------------------------------------------------------------
  app.delete("/api/instances/:slug/runtime/permissions/:id", (c) => {
    const { slug } = getInstanceContext(c);
    const id = c.req.param("id");

    let deleted = false;
    try {
      const result = db
        .prepare(`DELETE FROM rt_permissions WHERE id = ? AND instance_slug = ?`)
        .run(id, slug);
      deleted = result.changes > 0;
    } catch (err) {
      logger.warn("[route:permissions] delete permission rule failed", { error: String(err) });
      return apiError(c, 500, "DB_ERROR", "Failed to delete permission rule");
    }

    if (!deleted) {
      return apiError(c, 404, "NOT_FOUND", `Permission rule "${id}" not found`);
    }

    return c.json({ ok: true, id });
  });

  // -------------------------------------------------------------------------
  // POST /api/instances/:slug/runtime/permission/reply
  // Répond à une demande permission.asked en publiant sur le bus.
  // Body: { permissionId, decision, persist, comment? }
  // -------------------------------------------------------------------------
  app.post("/api/instances/:slug/runtime/permission/reply", async (c) => {
    const { slug } = getInstanceContext(c);

    // Parse + validation du body
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch (err) {
      logger.warn("[route:permissions] JSON parse failed on reply", { error: String(err) });
      return apiError(c, 400, "INVALID_JSON", "Request body must be valid JSON");
    }

    const parsed = ReplyBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return apiError(
        c,
        400,
        "VALIDATION_ERROR",
        parsed.error.issues.map((i) => i.message).join(", "),
      );
    }

    const { permissionId, decision, persist, comment } = parsed.data;

    // Relay permission reply to the runtime daemon via HTTP.
    // sessionId is empty by convention — the engine matches by permission id.
    void publishRuntimeEvent(slug, "permission.replied", {
      id: permissionId,
      sessionId: "",
      action: decision,
      persist,
      ...(comment !== undefined ? { feedback: comment } : {}),
    });

    return c.json({ ok: true, permissionId, decision, persist });
  });
}
