/**
 * ui/src/services/router.ts
 *
 * Hash-based routing for the claw-pilot dashboard.
 * Extracted from app.ts to keep the root component focused on rendering.
 */

import type { SidebarSection } from "../types.js";

export type Route =
  | { view: "home" }
  | { view: "cluster" }
  | { view: "agents-builder"; slug: string }
  | { view: "blueprints" }
  | { view: "blueprint-builder"; blueprintId: number }
  | { view: "agent-templates" }
  | { view: "agent-template-detail"; templateId: string }
  | { view: "instance-settings"; slug: string; initialSection?: SidebarSection }
  | { view: "pilot"; slug: string }
  | { view: "costs"; slug: string }
  | { view: "activity"; slug: string }
  | { view: "memory"; slug: string }
  | { view: "heartbeat"; slug: string }
  | { view: "session-logs"; slug: string }
  | { view: "tasks"; slug: string }
  | { view: "flows"; slug: string }
  | { view: "flow-run"; slug: string; runId: number }
  | { view: "instance-dashboard"; slug: string }
  | { view: "flow-sessions"; slug: string; flowId: number }
  | { view: "profile" };

/** Convert a Route to a hash string (without the leading #). */
export function routeToHash(route: Route): string {
  switch (route.view) {
    case "home":
      return "/home";
    case "cluster":
      return "/instances";
    case "agents-builder":
      return `/instances/${route.slug}/builder`;
    case "instance-settings":
      return `/instances/${route.slug}/settings`;
    case "pilot":
      return `/instances/${route.slug}/pilot`;
    case "costs":
      return `/instances/${route.slug}/costs`;
    case "activity":
      return `/instances/${route.slug}/activity`;
    case "memory":
      return `/instances/${route.slug}/memory`;
    case "heartbeat":
      return `/instances/${route.slug}/heartbeat`;
    case "session-logs":
      return `/instances/${route.slug}/session-logs`;
    case "tasks":
      return `/instances/${route.slug}/tasks`;
    case "flows":
      return `/instances/${route.slug}/flows`;
    case "flow-run":
      return `/instances/${route.slug}/flows/runs/${route.runId}`;
    case "instance-dashboard":
      return `/instances/${route.slug}/dashboard`;
    case "flow-sessions":
      return `/instances/${route.slug}/flows/${route.flowId}/sessions`;
    case "blueprints":
      return "/blueprints";
    case "blueprint-builder":
      return `/blueprints/${route.blueprintId}/builder`;
    case "agent-templates":
      return "/agent-templates";
    case "agent-template-detail":
      return `/agent-templates/${route.templateId}`;
    case "profile":
      return "/profile";
  }
}

/** Parse a hash string into a Route (returns cluster view for unknown hashes). */
export function hashToRoute(hash: string): Route {
  // Strip leading # and /
  const path = hash.replace(/^#?\/?/, "");
  if (!path || path === "/") return { view: "home" };

  // /home
  if (path === "home") return { view: "home" };

  // /instances (cluster view)
  if (path === "instances") return { view: "cluster" };

  // /instances/:slug/dashboard
  const dashboardMatch = path.match(/^instances\/([a-z][a-z0-9-]*)\/dashboard$/);
  if (dashboardMatch) return { view: "instance-dashboard", slug: dashboardMatch[1]! };

  // /instances/:slug/builder
  const builderMatch = path.match(/^instances\/([a-z][a-z0-9-]*)\/builder$/);
  if (builderMatch) return { view: "agents-builder", slug: builderMatch[1]! };

  // /instances/:slug/settings
  const settingsMatch = path.match(/^instances\/([a-z][a-z0-9-]*)\/settings$/);
  if (settingsMatch) return { view: "instance-settings", slug: settingsMatch[1]! };

  // /instances/:slug/pilot
  const pilotMatch = path.match(/^instances\/([a-z][a-z0-9-]*)\/pilot$/);
  if (pilotMatch) return { view: "pilot", slug: pilotMatch[1]! };

  // /instances/:slug/costs
  const costsMatch = path.match(/^instances\/([a-z][a-z0-9-]*)\/costs$/);
  if (costsMatch) return { view: "costs", slug: costsMatch[1]! };

  // /instances/:slug/activity
  const activityMatch = path.match(/^instances\/([a-z][a-z0-9-]*)\/activity$/);
  if (activityMatch) return { view: "activity", slug: activityMatch[1]! };

  // /instances/:slug/memory
  const memoryMatch = path.match(/^instances\/([a-z][a-z0-9-]*)\/memory$/);
  if (memoryMatch) return { view: "memory", slug: memoryMatch[1]! };

  // /instances/:slug/heartbeat
  const heartbeatMatch = path.match(/^instances\/([a-z][a-z0-9-]*)\/heartbeat$/);
  if (heartbeatMatch) return { view: "heartbeat", slug: heartbeatMatch[1]! };

  // /instances/:slug/session-logs
  const sessionLogsMatch = path.match(/^instances\/([a-z][a-z0-9-]*)\/session-logs$/);
  if (sessionLogsMatch) return { view: "session-logs", slug: sessionLogsMatch[1]! };

  // /instances/:slug/tasks
  const tasksMatch = path.match(/^instances\/([a-z][a-z0-9-]*)\/tasks$/);
  if (tasksMatch) return { view: "tasks", slug: tasksMatch[1]! };

  // /instances/:slug/flows/:flowId/sessions
  const flowSessionsMatch = path.match(/^instances\/([a-z][a-z0-9-]*)\/flows\/(\d+)\/sessions$/);
  if (flowSessionsMatch)
    return {
      view: "flow-sessions",
      slug: flowSessionsMatch[1]!,
      flowId: Number(flowSessionsMatch[2]),
    };

  // /instances/:slug/flows/runs/:runId
  const flowRunMatch = path.match(/^instances\/([a-z][a-z0-9-]*)\/flows\/runs\/(\d+)$/);
  if (flowRunMatch)
    return { view: "flow-run", slug: flowRunMatch[1]!, runId: Number(flowRunMatch[2]) };

  // /instances/:slug/flows
  const flowsMatch = path.match(/^instances\/([a-z][a-z0-9-]*)\/flows$/);
  if (flowsMatch) return { view: "flows", slug: flowsMatch[1]! };

  // /blueprints/:id/builder
  const bpBuilderMatch = path.match(/^blueprints\/(\d+)\/builder$/);
  if (bpBuilderMatch) return { view: "blueprint-builder", blueprintId: Number(bpBuilderMatch[1]) };

  // /blueprints
  if (path === "blueprints") return { view: "blueprints" };

  // /agent-templates/:id
  const atDetailMatch = path.match(/^agent-templates\/([a-zA-Z0-9_-]+)$/);
  if (atDetailMatch) return { view: "agent-template-detail", templateId: atDetailMatch[1]! };

  // /agent-templates
  if (path === "agent-templates") return { view: "agent-templates" };

  // /profile
  if (path === "profile") return { view: "profile" };

  return { view: "home" };
}
