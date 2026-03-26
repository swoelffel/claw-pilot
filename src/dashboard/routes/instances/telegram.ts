// src/dashboard/routes/instances/telegram.ts
// Routes: GET /telegram/pairing, POST /telegram/pairing/approve, DELETE /telegram/pairing/:code
import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { instanceGuard } from "../../../lib/guards.js";
import { getRuntimeStateDir } from "../../../lib/platform.js";
import { exportRuntimeJsonSnapshot } from "../../../runtime/index.js";
import { loadConfigDbFirst } from "../_config-helpers.js";
import { listPairingCodes, deletePairingCode } from "../../../runtime/channel/pairing.js";
import { logger } from "../../../lib/logger.js";

export function registerTelegramRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, db } = deps;

  // GET /api/instances/:slug/telegram/pairing
  // Returns pending pairing requests + approved user IDs
  app.get("/api/instances/:slug/telegram/pairing", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    // List active telegram pairing codes
    const codes = listPairingCodes(db, slug).filter((p) => p.channel === "telegram");

    const pending = codes.map((p) => ({
      id: p.peerId?.replace("telegram:", "") ?? "",
      code: p.code,
      createdAt: p.createdAt.toISOString(),
      lastSeenAt: p.createdAt.toISOString(),
      meta: {
        username: p.meta?.username,
        accountId: p.peerId?.replace("telegram:", ""),
      },
    }));

    // Get approved user IDs from config (DB-first)
    const stateDir = getRuntimeStateDir(slug);
    let approved: string[] = [];
    const config = loadConfigDbFirst(registry, slug, stateDir);
    if (config) {
      approved = config.telegram.allowedUserIds.map(String);
    }

    return c.json({ pending, approved });
  });

  // POST /api/instances/:slug/telegram/pairing/approve
  // Approves a pairing code: adds user ID to allowedUserIds, deletes the code
  app.post("/api/instances/:slug/telegram/pairing/approve", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    let code: string;
    try {
      const raw = (await c.req.json()) as { code?: unknown };
      if (typeof raw.code !== "string" || !raw.code.trim()) {
        return apiError(c, 400, "INVALID_BODY", "code must be a non-empty string");
      }
      code = raw.code.trim().toUpperCase().replace(/-/g, "");
    } catch {
      return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
    }

    // Find the pairing code among active telegram codes
    const codes = listPairingCodes(db, slug).filter((p) => p.channel === "telegram");
    const record = codes.find((p) => p.code === code);

    if (!record) {
      return apiError(c, 404, "CODE_NOT_FOUND", "Pairing code not found or expired");
    }

    // Extract user ID from peerId
    const peerId = record.peerId;
    if (!peerId?.startsWith("telegram:")) {
      return apiError(c, 400, "INVALID_PEER", "Invalid peer ID in pairing record");
    }
    const userId = parseInt(peerId.replace("telegram:", ""), 10);
    if (isNaN(userId)) {
      return apiError(c, 400, "INVALID_PEER", "Cannot parse user ID from peer ID");
    }

    // Add to allowedUserIds via DB-first config
    const stateDir = getRuntimeStateDir(slug);
    try {
      const currentConfig = loadConfigDbFirst(registry, slug, stateDir);
      if (!currentConfig) {
        return apiError(c, 400, "NO_CONFIG", "Runtime config not found — configure Telegram first");
      }

      if (!currentConfig.telegram.allowedUserIds.includes(userId)) {
        const updated = registry.patchRuntimeConfig(slug, (cfg) => ({
          ...cfg,
          telegram: {
            ...cfg.telegram,
            allowedUserIds: [...cfg.telegram.allowedUserIds, userId],
          },
        }));
        exportRuntimeJsonSnapshot(stateDir, updated);
      }

      // Delete the pairing code (consumed)
      deletePairingCode(db, code);

      logger.info(`[telegram] approved pairing for slug=${slug} userId=${userId}`);
      return c.json({ ok: true, userId });
    } catch (err) {
      logger.error(
        `[telegram] approve error for slug=${slug}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return apiError(c, 500, "APPROVE_FAILED", "Failed to approve pairing");
    }
  });

  // DELETE /api/instances/:slug/telegram/pairing/:code
  // Reject/delete a pending pairing request
  app.delete("/api/instances/:slug/telegram/pairing/:code", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const code = c.req.param("code").toUpperCase().replace(/-/g, "");
    deletePairingCode(db, code);
    return c.json({ ok: true });
  });
}
