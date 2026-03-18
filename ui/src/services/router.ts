/**
 * ui/src/services/router.ts
 *
 * Hash-based routing for the claw-pilot dashboard.
 * Extracted from app.ts to keep the root component focused on rendering.
 */

import type { SidebarSection } from "../types.js";

export type Route =
  | { view: "cluster" }
  | { view: "agents-builder"; slug: string }
  | { view: "blueprints" }
  | { view: "blueprint-builder"; blueprintId: number }
  | { view: "instance-settings"; slug: string; initialSection?: SidebarSection }
  | { view: "pilot"; slug: string };

/** Convert a Route to a hash string (without the leading #). */
export function routeToHash(route: Route): string {
  switch (route.view) {
    case "cluster":
      return "/";
    case "agents-builder":
      return `/instances/${route.slug}/builder`;
    case "instance-settings":
      return `/instances/${route.slug}/settings`;
    case "pilot":
      return `/instances/${route.slug}/pilot`;
    case "blueprints":
      return "/blueprints";
    case "blueprint-builder":
      return `/blueprints/${route.blueprintId}/builder`;
  }
}

/** Parse a hash string into a Route (returns cluster view for unknown hashes). */
export function hashToRoute(hash: string): Route {
  // Strip leading # and /
  const path = hash.replace(/^#?\/?/, "");
  if (!path || path === "/") return { view: "cluster" };

  // /instances/:slug/builder
  const builderMatch = path.match(/^instances\/([a-z][a-z0-9-]*)\/builder$/);
  if (builderMatch) return { view: "agents-builder", slug: builderMatch[1]! };

  // /instances/:slug/settings
  const settingsMatch = path.match(/^instances\/([a-z][a-z0-9-]*)\/settings$/);
  if (settingsMatch) return { view: "instance-settings", slug: settingsMatch[1]! };

  // /instances/:slug/pilot
  const pilotMatch = path.match(/^instances\/([a-z][a-z0-9-]*)\/pilot$/);
  if (pilotMatch) return { view: "pilot", slug: pilotMatch[1]! };

  // /blueprints/:id/builder
  const bpBuilderMatch = path.match(/^blueprints\/(\d+)\/builder$/);
  if (bpBuilderMatch) return { view: "blueprint-builder", blueprintId: Number(bpBuilderMatch[1]) };

  // /blueprints
  if (path === "blueprints") return { view: "blueprints" };

  return { view: "cluster" };
}
