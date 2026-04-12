// src/dashboard/routes/instances/tasks.ts
// Orchestrator: registers all task-related routes.
import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { registerTaskCrudRoutes } from "./tasks-crud.js";
import { registerTaskActionRoutes } from "./tasks-actions.js";

export function registerTaskRoutes(app: Hono, deps: RouteDeps): void {
  registerTaskCrudRoutes(app, deps);
  registerTaskActionRoutes(app, deps);
}
