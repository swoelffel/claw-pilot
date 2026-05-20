// src/dashboard/routes/instances/agents.ts
// Orchestrator: registers all agent-related routes.
import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { registerAgentListRoutes } from "./agents/list.js";
import { registerAgentSyncRoutes } from "./agents/sync.js";
import { registerAgentCreateRoutes } from "./agents/create.js";
import { registerAgentDeleteRoutes } from "./agents/delete.js";
import { registerAgentUpdateRoutes } from "./agents/update.js";
import { registerAgentFileRoutes } from "./agents/files.js";
import { registerAgentSpawnLinkRoutes } from "./agents/spawn-links.js";
import { registerAgentKickoffRoutes } from "./agents/kickoff.js";
import { registerAgentPermissionsRoutes } from "./agents/permissions.js";

export function registerAgentRoutes(app: Hono, deps: RouteDeps): void {
  // Registration order matters for Hono — specific paths before parameterized ones
  // Legacy filesystem-based skills routes removed in SKILLS-002 — superseded by registerInstanceSkillsRoutes in server.ts.
  registerAgentSyncRoutes(app, deps); // POST .../agents/sync
  registerAgentListRoutes(app, deps); // GET  .../agents, GET .../agents/builder
  registerAgentUpdateRoutes(app, deps); // PATCH .../agents/:id/position, .../agents/:id/meta
  registerAgentSpawnLinkRoutes(app, deps); // PATCH .../agents/:id/spawn-links
  registerAgentFileRoutes(app, deps); // GET/PUT .../agents/:id/files/:filename
  registerAgentKickoffRoutes(app, deps); // POST .../agents/:id/kickoff
  registerAgentPermissionsRoutes(app, deps); // GET/PATCH .../agents/:id/permissions
  registerAgentCreateRoutes(app, deps); // POST .../agents
  registerAgentDeleteRoutes(app, deps); // DELETE .../agents/:id
}
