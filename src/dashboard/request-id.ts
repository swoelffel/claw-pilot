// src/dashboard/request-id.ts
//
// Hono middleware that generates a unique request ID for each incoming request.
// The ID is attached as the X-Request-Id response header and stored in the
// Hono context variable "requestId" for use in route handlers and logs.

import { nanoid } from "nanoid";
import { randomBytes } from "node:crypto";
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
    const inboundRequestId = c.req.header("x-request-id")?.trim();
    const id =
      inboundRequestId && inboundRequestId.length <= 200
        ? inboundRequestId
        : nanoid(REQUEST_ID_LENGTH);
    const traceparent = c.req.header("traceparent")?.trim();
    const traceparentMatch = traceparent?.match(
      /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i,
    );
    const legacyTraceId = c.req.header("x-trace-id")?.trim();
    const traceId =
      traceparentMatch?.[1]?.toLowerCase() ??
      (legacyTraceId && legacyTraceId.length <= 200
        ? legacyTraceId
        : randomBytes(16).toString("hex"));
    const flags = traceparentMatch?.[3]?.toLowerCase() ?? "01";
    const responseTraceparent = `00-${/^[0-9a-f]{32}$/.test(traceId) ? traceId : randomBytes(16).toString("hex")}-${randomBytes(8).toString("hex")}-${flags}`;
    c.set("requestId", id);
    c.set("traceId", traceId);
    await next();
    c.header("X-Request-Id", id);
    c.header("X-Trace-Id", traceId);
    c.header("traceparent", responseTraceparent);
  };
}
