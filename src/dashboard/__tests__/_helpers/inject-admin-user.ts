// src/dashboard/__tests__/_helpers/inject-admin-user.ts
//
// Test helper: inject a synthetic admin AuthenticatedUser on the Hono context.
// Used by bare test harnesses that skip the server-level auth middleware (which
// normally publishes the user via the enrichment added in server.ts). Keeps
// permission() middleware happy in unit tests without duplicating the object
// literal across 10+ files.

import type { MiddlewareHandler } from "hono";

export const TEST_ADMIN = {
  id: "test",
  username: "admin",
  role: "admin",
  source: "session",
} as const;

/** Hono middleware that publishes a synthetic admin user on `c.get("user")`. */
export function injectAdminUser(): MiddlewareHandler {
  return async (c, next) => {
    c.set("user", { ...TEST_ADMIN });
    await next();
  };
}
