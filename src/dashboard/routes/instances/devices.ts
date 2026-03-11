// src/dashboard/routes/instances/devices.ts
// Routes: devices list/approve/revoke, telegram pairing list/approve
import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { instanceGuard } from "../../../lib/guards.js";
import { DeviceManager } from "../../../core/device-manager.js";
import { TelegramPairingManager } from "../../../core/telegram-pairing-manager.js";

export function registerDeviceRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, conn } = deps;

  // GET /api/instances/:slug/devices — list pending + paired devices
  app.get("/api/instances/:slug/devices", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;
    const dm = new DeviceManager(conn);
    const devices = await dm.list(instance!.state_dir);
    return c.json(devices);
  });

  // POST /api/instances/:slug/devices/approve — approve a pending device
  app.post("/api/instances/:slug/devices/approve", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;
    let body: { requestId?: string };
    try {
      body = await c.req.json();
    } catch {
      return apiError(c, 400, "INVALID_JSON", "Invalid JSON");
    }
    if (!body.requestId) return apiError(c, 400, "FIELD_REQUIRED", "requestId is required");
    const dm = new DeviceManager(conn);
    try {
      await dm.approve(instance!.state_dir, body.requestId);
      return c.json({ ok: true });
    } catch (err) {
      return apiError(
        c,
        500,
        "APPROVE_FAILED",
        err instanceof Error ? err.message : "Approve failed",
      );
    }
  });

  // DELETE /api/instances/:slug/devices/:deviceId — revoke a paired device
  app.delete("/api/instances/:slug/devices/:deviceId", async (c) => {
    const slug = c.req.param("slug");
    const deviceId = c.req.param("deviceId");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;
    const dm = new DeviceManager(conn);
    try {
      await dm.revoke(instance!.state_dir, deviceId);
      return c.json({ ok: true });
    } catch (err) {
      return apiError(
        c,
        500,
        "REVOKE_FAILED",
        err instanceof Error ? err.message : "Revoke failed",
      );
    }
  });

  // GET /api/instances/:slug/telegram/pairing — list pending + approved DM pairing
  app.get("/api/instances/:slug/telegram/pairing", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;
    const tm = new TelegramPairingManager(conn);
    const pairing = await tm.list(instance!.state_dir);
    return c.json(pairing);
  });

  // POST /api/instances/:slug/telegram/pairing/approve — approve a pending DM pairing code
  app.post("/api/instances/:slug/telegram/pairing/approve", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;
    let body: { code?: string };
    try {
      body = await c.req.json();
    } catch {
      return apiError(c, 400, "INVALID_JSON", "Invalid JSON");
    }
    if (!body.code) return apiError(c, 400, "FIELD_REQUIRED", "code is required");
    const tm = new TelegramPairingManager(conn);
    try {
      await tm.approve(instance!.state_dir, body.code);
      return c.json({ ok: true });
    } catch (err) {
      return apiError(
        c,
        500,
        "APPROVE_FAILED",
        err instanceof Error ? err.message : "Approve failed",
      );
    }
  });
}
