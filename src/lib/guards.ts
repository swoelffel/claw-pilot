// src/lib/guards.ts
// Shared guard helpers for route handlers.

import type { Context } from "hono";
import { apiError } from "../dashboard/route-deps.js";

/**
 * Guard for instance existence in route handlers.
 *
 * Returns a 404 Response if the instance is missing, null otherwise.
 * After calling this guard, use `instance!` to access the narrowed value,
 * since TypeScript cannot infer the narrowing from the early-return pattern.
 *
 * Usage:
 *   const instance = registry.getInstance(slug);
 *   const guard = instanceGuard(c, instance); if (guard) return guard;
 *   instance!.slug  // safe — guard ensures instance is defined
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function instanceGuard(c: Context<any, any, any>, instance: unknown): Response | null {
  if (instance === undefined || instance === null) {
    return apiError(c, 404, "NOT_FOUND", "Not found") as unknown as Response;
  }
  return null;
}
