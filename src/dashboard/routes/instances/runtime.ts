// src/dashboard/routes/instances/runtime.ts
// Orchestrator: registers all runtime-related routes.
import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { registerRuntimeStatusRoutes } from "./runtime-status.js";
import { registerRuntimeMessageRoutes } from "./runtime-messages.js";
import { registerRuntimeChatRoutes } from "./runtime-chat.js";
import { registerRuntimeToolRoutes } from "./runtime-tools.js";

export function registerRuntimeRoutes(app: Hono, deps: RouteDeps): void {
  registerRuntimeStatusRoutes(app, deps);
  registerRuntimeMessageRoutes(app, deps);
  registerRuntimeChatRoutes(app, deps);
  registerRuntimeToolRoutes(app, deps);
}
