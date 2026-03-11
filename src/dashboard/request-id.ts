// src/dashboard/request-id.ts
//
// Hono middleware that generates a unique request ID for each incoming request.
// The ID is attached as the X-Request-Id response header and stored in the
// Hono context variable "requestId" for use in route handlers and logs.

import { nanoid } from "nanoid";
import type { Context, Next } from "hono";

/** Length of the generated request ID (URL-safe, ~21 chars = 126 bits of entropy). */
const REQUEST_ID_LENGTH = 12;

/**
 * Middleware that generates a short nanoid per request and exposes it as:
 * - Response header: X-Request-Id
 * - Context variable: c.get("requestId")
 */
export function requestIdMiddleware() {
  return async (c: Context, next: Next) => {
    const id = nanoid(REQUEST_ID_LENGTH);
    c.set("requestId", id);
    await next();
    c.header("X-Request-Id", id);
  };
}
