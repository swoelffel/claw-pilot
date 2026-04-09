// src/dashboard/routes/instances/whatsapp.ts
// Routes: GET pairing, POST pairing/approve, DELETE pairing/:code, GET baileys-status
import * as fs from "node:fs";
import * as path from "node:path";
import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { instanceGuard } from "../../../lib/guards.js";
import { getRuntimeStateDir } from "../../../lib/platform.js";
import {
  runtimeConfigExists,
  loadRuntimeConfig,
  saveRuntimeConfig,
} from "../../../runtime/index.js";
import { listPairingCodes, deletePairingCode } from "../../../runtime/channel/pairing.js";
import { logger } from "../../../lib/logger.js";

export function registerWhatsAppRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, db } = deps;

  // GET /api/instances/:slug/whatsapp/pairing
  app.get("/api/instances/:slug/whatsapp/pairing", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const codes = listPairingCodes(db, slug).filter((p) => p.channel === "whatsapp");

    const pending = codes.map((p) => {
      const phone = p.peerId?.replace("whatsapp:", "") ?? "";
      return {
        id: phone,
        code: p.code,
        createdAt: p.createdAt.toISOString(),
        lastSeenAt: p.createdAt.toISOString(),
        meta: { name: p.meta?.name, phoneNumber: phone },
      };
    });

    const stateDir = getRuntimeStateDir(slug);
    let approved: string[] = [];
    if (runtimeConfigExists(stateDir)) {
      try {
        const config = loadRuntimeConfig(stateDir);
        approved = config.whatsapp.allowedPhoneNumbers;
      } catch {
        /* ignore */
      }
    }

    return c.json({ pending, approved });
  });

  // POST /api/instances/:slug/whatsapp/pairing/approve
  app.post("/api/instances/:slug/whatsapp/pairing/approve", async (c) => {
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

    const codes = listPairingCodes(db, slug).filter((p) => p.channel === "whatsapp");
    const record = codes.find((p) => p.code === code);

    if (!record) {
      return apiError(c, 404, "CODE_NOT_FOUND", "Pairing code not found or expired");
    }

    const peerId = record.peerId;
    if (!peerId?.startsWith("whatsapp:")) {
      return apiError(c, 400, "INVALID_PEER", "Invalid peer ID in pairing record");
    }
    const phoneNumber = peerId.replace("whatsapp:", "");

    const stateDir = getRuntimeStateDir(slug);
    try {
      if (!runtimeConfigExists(stateDir)) {
        return apiError(c, 400, "NO_CONFIG", "Runtime config not found — configure WhatsApp first");
      }

      const config = loadRuntimeConfig(stateDir);

      if (!config.whatsapp.allowedPhoneNumbers.includes(phoneNumber)) {
        config.whatsapp.allowedPhoneNumbers = [...config.whatsapp.allowedPhoneNumbers, phoneNumber];
        saveRuntimeConfig(stateDir, config);
      }

      deletePairingCode(db, code);

      logger.info(`[whatsapp] approved pairing for slug=${slug} phoneNumber=${phoneNumber}`);
      return c.json({ ok: true, phoneNumber });
    } catch (err) {
      logger.error(
        `[whatsapp] approve error for slug=${slug}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return apiError(c, 500, "APPROVE_FAILED", "Failed to approve pairing");
    }
  });

  // DELETE /api/instances/:slug/whatsapp/pairing/:code
  app.delete("/api/instances/:slug/whatsapp/pairing/:code", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const code = c.req.param("code").toUpperCase().replace(/-/g, "");
    deletePairingCode(db, code);
    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // Baileys status (polled by UI when mode === "baileys")
  // -------------------------------------------------------------------------

  // GET /api/instances/:slug/whatsapp/baileys-status
  app.get("/api/instances/:slug/whatsapp/baileys-status", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const stateDir = getRuntimeStateDir(slug);
    const statusPath = path.join(stateDir, "whatsapp-session", "status.json");

    try {
      const raw = fs.readFileSync(statusPath, "utf8");
      const status = JSON.parse(raw) as {
        connected: boolean;
        qrCode: string | null;
        phoneNumber: string | null;
      };
      return c.json(status);
    } catch {
      return c.json({ connected: false, qrCode: null, phoneNumber: null });
    }
  });
}
