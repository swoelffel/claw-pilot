/**
 * ui/src/services/router.ts
 *
 * Pure path ↔ route converters for the dashboard.
 *
 * Both functions are stateless and side-effect-free — they exist only to
 * translate between a discriminated `Route` union and a string pathname.
 * Stateful concerns (history.pushState, popstate listeners, current route
 * snapshot) live in `./navigation.ts`. Consumers should import from
 * `navigation.ts` for all navigation primitives.
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
  | { view: "profile" }
  | { view: "triggers"; slug: string }
  /**
   * Extension view registered through `extension-views.ts`. The `subPath`
   * is the segment after `/ext/<id>/`, with the leading slash stripped
   * (empty string for the bare prefix `/ext/<id>`).
   */
  | { view: "extension"; id: string; subPath: string };

/** Convert a Route to a pathname (always starts with a leading slash). */
export function routeToPath(route: Route): string {
  switch (route.view) {
    case "home":
      return "/";
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
    case "triggers":
      return `/instances/${route.slug}/triggers`;
    case "extension":
      return route.subPath === "" ? `/ext/${route.id}` : `/ext/${route.id}/${route.subPath}`;
  }
}

/**
 * Parse a pathname into a Route. Unknown paths fall back to `{ view: "home" }`.
 *
 * Accepts both absolute (`/blueprints`) and bare (`blueprints`) forms — any
 * leading slashes are stripped before matching.
 */
export function pathToRoute(pathname: string): Route {
  const path = pathname.replace(/^\/+/, "");
  if (!path) return { view: "home" };

  // Legacy "/home" path (pre-2026-05 hash router used /home for the home
  // screen; keep accepting it so old bookmarks keep working after the
  // hash → path migration handled in navigation.ts).
  if (path === "home") return { view: "home" };

  // Extension prefix `/ext/<id>(/<subPath>)?` — the actual extension lookup
  // and sub-path validation happen at render time in app.ts via
  // matchExtensionPath() so the parser stays pure.
  const extMatch = path.match(/^ext\/([a-z][a-z0-9-]*)(?:\/(.*))?$/);
  if (extMatch) return { view: "extension", id: extMatch[1]!, subPath: extMatch[2] ?? "" };

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

  // /instances/:slug/triggers (TRIGGER-001b)
  const triggersMatch = path.match(/^instances\/([a-z][a-z0-9-]*)\/triggers$/);
  if (triggersMatch) return { view: "triggers", slug: triggersMatch[1]! };

  // /instances/:slug/skills[/:id] — legacy paths from SKILLS-002 pre-relocate.
  // Redirect to instance settings (Skills section is now a sidebar entry).
  const skillsLegacyMatch = path.match(/^instances\/([a-z][a-z0-9-]*)\/skills(?:\/[^/]+)?$/);
  if (skillsLegacyMatch)
    return { view: "instance-settings", slug: skillsLegacyMatch[1]!, initialSection: "skills" };

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
