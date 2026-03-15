// src/dashboard/routes/instances/devices.ts
// Routes: devices list/revoke, pairing codes management
import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { instanceGuard } from "../../../lib/guards.js";
import { DeviceManager } from "../../../core/device-manager.js";

export function registerDeviceRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, db } = deps;

  // GET /api/instances/:slug/devices — list pairing codes
  app.get("/api/instances/:slug/devices", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const dm = new DeviceManager(db);
    const codes = dm.list(slug);
    return c.json({ codes });
  });

  // DELETE /api/instances/:slug/devices/:code — revoke a pairing code
  app.delete("/api/instances/:slug/devices/:code", async (c) => {
    const slug = c.req.param("slug");
    const code = c.req.param("code");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const dm = new DeviceManager(db);
    const revoked = dm.revoke(slug, code);
    if (!revoked) {
      return apiError(c, 404, "CODE_NOT_FOUND", `Pairing code "${code}" not found`);
    }
    return c.json({ ok: true });
  });
}
