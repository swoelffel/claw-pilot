// src/dashboard/routes/instances/index.ts
// Orchestrator: registers all instance-related routes.
// Route registration order matters for Hono — /discover must come before /:slug.
import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { registerDiscoverRoutes } from "./discover.js";
import { registerLifecycleRoutes } from "./lifecycle.js";
import { registerConfigRoutes } from "./config.js";
import { registerAgentRoutes } from "./agents.js";
import { registerRuntimeRoutes } from "./runtime.js";
import { registerMcpRoutes } from "./mcp.js";
import { registerPermissionRoutes } from "./permissions.js";
import { registerTelegramRoutes } from "./telegram.js";

export function registerInstanceRoutes(app: Hono, deps: RouteDeps): void {
  // /discover must be registered before /:slug to avoid Hono route collision
  registerDiscoverRoutes(app, deps);
  registerLifecycleRoutes(app, deps);
  registerConfigRoutes(app, deps);
  registerAgentRoutes(app, deps);
  registerRuntimeRoutes(app, deps);
  registerMcpRoutes(app, deps);
  registerPermissionRoutes(app, deps);
  registerTelegramRoutes(app, deps);
}
