/**
 * runtime/middleware/registry.ts
 *
 * Global middleware registry. Middlewares are registered at runtime startup
 * and executed in order for every inbound message.
 */

import type { Middleware } from "./types.js";

// ---------------------------------------------------------------------------
// Module-level registry
// ---------------------------------------------------------------------------

const _middlewares: Middleware[] = [];
let _sorted = true;

/**
 * Register a middleware. Can be called at any time (startup or dynamically).
 * Middlewares are sorted by `order` before execution.
 */
export function registerMiddleware(mw: Middleware): void {
  _middlewares.push(mw);
  _sorted = false;
}

/**
 * Returns all registered middlewares, sorted by order (ascending).
 * Returns a shallow copy — mutations do not affect the registry.
 */
export function getMiddlewares(): Middleware[] {
  if (!_sorted) {
    _middlewares.sort((a, b) => a.order - b.order);
    _sorted = true;
  }
  return [..._middlewares];
}

/**
 * Clear all registered middlewares (useful for testing).
 */
export function clearMiddlewares(): void {
  _middlewares.length = 0;
  _sorted = true;
}
