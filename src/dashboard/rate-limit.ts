// src/dashboard/rate-limit.ts
//
// Simple in-memory sliding-window rate limiter for the dashboard API.
// No external dependencies — uses a Map of request timestamps per IP.

import type { Context, Next } from "hono";

interface RateLimitOptions {
  /** Maximum number of requests allowed within the window. */
  maxRequests: number;
  /** Time window in milliseconds. */
  windowMs: number;
}

interface BucketEntry {
  timestamps: number[];
}

/**
 * Creates a Hono middleware that rate-limits requests per client IP.
 * Uses a sliding window algorithm with periodic cleanup.
 */
export function createRateLimiter(options: RateLimitOptions) {
  const { maxRequests, windowMs } = options;
  const buckets = new Map<string, BucketEntry>();

  // Periodic cleanup to prevent memory leaks (every 60s)
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of buckets) {
      entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);
      if (entry.timestamps.length === 0) buckets.delete(ip);
    }
  }, 60_000);
  // Allow the process to exit even if the interval is still running
  if (cleanupInterval.unref) cleanupInterval.unref();

  return async (c: Context, next: Next) => {
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      "127.0.0.1";

    const now = Date.now();
    let entry = buckets.get(ip);
    if (!entry) {
      entry = { timestamps: [] };
      buckets.set(ip, entry);
    }

    // Remove expired timestamps
    entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

    if (entry.timestamps.length >= maxRequests) {
      const retryAfter = Math.ceil((entry.timestamps[0]! + windowMs - now) / 1000);
      c.header("Retry-After", String(retryAfter));
      return c.json(
        { error: "Too many requests", code: "RATE_LIMITED" },
        429 as unknown as undefined,
      );
    }

    entry.timestamps.push(now);
    await next();
  };
}
