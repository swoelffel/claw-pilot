// src/dashboard/instance-list-filters.ts
//
// Extension-Point: instance-list-filter
// Downstream editions can narrow the GET /api/instances payload without
// importing edition-specific code from Community route modules.

import type { AuthenticatedUser } from "./middleware/permission.js";
import type { RouteDeps } from "./route-deps.js";

export type InstanceListItem = { slug: string } & Record<string, unknown>;

export interface InstanceListFilterContext {
  db: RouteDeps["db"];
  user?: AuthenticatedUser;
}

export type InstanceListFilter = (
  instances: InstanceListItem[],
  context: InstanceListFilterContext,
) => InstanceListItem[] | Promise<InstanceListItem[]>;

const filters: InstanceListFilter[] = [];

export function registerInstanceListFilter(filter: InstanceListFilter): void {
  if (!filters.includes(filter)) {
    filters.push(filter);
  }
}

export function getInstanceListFilters(): readonly InstanceListFilter[] {
  return filters.slice();
}

export async function applyInstanceListFilters(
  instances: InstanceListItem[],
  context: InstanceListFilterContext,
): Promise<InstanceListItem[]> {
  let current = instances;
  for (const filter of filters) {
    current = await filter(current, context);
  }
  return current;
}

export function clearInstanceListFilters(): void {
  filters.length = 0;
}
