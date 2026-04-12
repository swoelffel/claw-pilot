// src/dashboard/routes/system-instance.ts
//
// Routes for the system instance (cp-system) — status check and provisioning.

import type { Hono } from "hono";
import { z } from "zod";
import type { RouteDeps } from "../route-deps.js";
import { apiError } from "../route-deps.js";
import { SystemInstanceService, SYSTEM_INSTANCE_SLUG } from "../../core/system-instance.js";
import { isRuntimeRunning } from "../../lib/platform.js";
import { NamedKeyRepository } from "../../core/repositories/named-key-repository.js";
import { logger } from "../../lib/logger.js";

const EnsureBodySchema = z.object({
  namedKeyId: z.number().int().positive(),
});

export function registerSystemInstanceRoutes(
  app: Hono,
  deps: RouteDeps,
  dashboardToken: string,
  dashboardPort: number,
): void {
  const { registry, conn, lifecycle, db } = deps;

  /**
   * GET /api/system/status
   * Returns the system instance provisioning and running status.
   */
  app.get("/api/system/status", (c) => {
    const instance = registry.getSystemInstance();
    if (!instance) {
      return c.json({ provisioned: false, running: false, slug: null });
    }
    const running = isRuntimeRunning(instance.state_dir);
    return c.json({ provisioned: true, running, slug: instance.slug });
  });

  /**
   * POST /api/system/ensure
   * Idempotent: provision if absent, start if stopped.
   * Body: { namedKeyId: number }
   */
  app.post("/api/system/ensure", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = EnsureBodySchema.safeParse(body);
    if (!parsed.success) {
      return apiError(c, 400, "INVALID_BODY", parsed.error.message);
    }

    const { namedKeyId } = parsed.data;

    // Verify the named key exists
    const namedKeyRepo = new NamedKeyRepository(db);
    const key = namedKeyRepo.getById(namedKeyId);
    if (!key) {
      return apiError(c, 404, "KEY_NOT_FOUND", `Named API key ${namedKeyId} not found`);
    }

    try {
      // 1. Ensure provisioned
      const instance = await SystemInstanceService.ensureProvisioned(
        registry,
        conn,
        db,
        namedKeyId,
        dashboardPort,
        dashboardToken,
      );

      // 2. Ensure running
      if (!isRuntimeRunning(instance.state_dir)) {
        await lifecycle.start(SYSTEM_INSTANCE_SLUG);
        return c.json({ slug: instance.slug, status: "starting" });
      }

      return c.json({ slug: instance.slug, status: "running" });
    } catch (err) {
      logger.error("[system-instance] ensure failed", { error: String(err) });
      return apiError(
        c,
        500,
        "SYSTEM_PROVISION_FAILED",
        err instanceof Error ? err.message : "Failed to provision system instance",
      );
    }
  });

  /**
   * POST /api/system/query
   * Execute a read-only SQL query against the registry database.
   * Only SELECT statements are allowed. The encrypted_api_key column is masked.
   */
  const QueryBodySchema = z.object({
    sql: z.string().min(1),
    limit: z.number().int().min(1).max(500).optional(),
  });

  // Patterns that indicate a non-SELECT (write) statement
  const WRITE_PATTERNS =
    /^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH|DETACH|REINDEX|VACUUM|PRAGMA)/i;

  app.post("/api/system/query", (c) => {
    const body = c.req.json().catch(() => null);
    return body.then((raw) => {
      const parsed = QueryBodySchema.safeParse(raw);
      if (!parsed.success) {
        return apiError(c, 400, "INVALID_BODY", parsed.error.message);
      }

      const { sql, limit: maxRows } = parsed.data;

      // Security: only allow SELECT statements
      if (WRITE_PATTERNS.test(sql)) {
        return apiError(c, 403, "READ_ONLY", "Only SELECT statements are allowed");
      }

      try {
        // Add LIMIT if not already present
        const limitedSql = /\bLIMIT\b/i.test(sql) ? sql : `${sql} LIMIT ${maxRows ?? 100}`;
        const rows = db.prepare(limitedSql).all() as Record<string, unknown>[];

        // Mask encrypted_api_key column if present in results
        const masked = rows.map((row) => {
          if ("encrypted_api_key" in row) {
            return { ...row, encrypted_api_key: "***MASKED***" };
          }
          return row;
        });

        return c.json({ rows: masked, count: masked.length });
      } catch (err) {
        return apiError(
          c,
          400,
          "QUERY_ERROR",
          err instanceof Error ? err.message : "Query execution failed",
        );
      }
    });
  });

  /**
   * GET /api/system/ready
   * Quick check if the system instance exists, is running, and ready for chat.
   */
  app.get("/api/system/ready", (c) => {
    const instance = registry.getSystemInstance();
    if (!instance) return c.json({ ready: false, reason: "not_provisioned" });
    if (!isRuntimeRunning(instance.state_dir)) {
      return c.json({ ready: false, reason: "not_running" });
    }
    return c.json({ ready: true, slug: instance.slug });
  });
}
