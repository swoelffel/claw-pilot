// src/dashboard/routes/_instance-middleware.ts
//
// Hono middleware that resolves the instance from :slug param.
// Applied to all /api/instances/:slug/* routes — eliminates the
// repeated instanceGuard pattern across 23 route files.

import type { Context, Next } from "hono";
import type { Registry } from "../../core/registry.js";
import { apiError } from "../route-deps.js";

/**
 * Creates a middleware that resolves an instance by slug and stores it on the context.
 * Returns 404 if the instance is not found.
 *
 * Route handlers access the resolved instance via:
 *   const { instance, slug } = getInstanceContext(c);
 */
export function instanceMiddleware(registry: Registry) {
  return async (c: Context, next: Next) => {
    const slug = c.req.param("slug");
    if (!slug) return next(); // No :slug param — skip (e.g. /api/instances list route)

    // Skip non-slug path segments (e.g. /api/instances/discover/*)
    if (slug === "discover") return next();

    const instance = registry.getInstance(slug);
    if (!instance) {
      return apiError(c, 404, "NOT_FOUND", "Not found");
    }
    c.set("instance", instance);
    c.set("slug", slug);
    await next();
  };
}

/**
 * Extract the resolved instance and slug from the Hono context.
 * Must be called inside a route protected by instanceMiddleware.
 */
export function getInstanceContext(c: Context): {
  instance: NonNullable<ReturnType<Registry["getInstance"]>>;
  slug: string;
} {
  return {
    instance: c.get("instance") as NonNullable<ReturnType<Registry["getInstance"]>>,
    slug: c.get("slug") as string,
  };
}
