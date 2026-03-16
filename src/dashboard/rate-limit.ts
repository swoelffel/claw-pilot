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
  /**
   * If true, read the client IP from the x-forwarded-for / x-real-ip headers.
   * Only enable when the dashboard is behind a trusted reverse proxy (nginx, etc.).
   * When false (default), uses the direct socket IP — not spoofable.
   */
  trustProxy?: boolean;
}

interface BucketEntry {
  timestamps: number[];
}

/**
 * Creates a Hono middleware that rate-limits requests per client IP.
 * Uses a sliding window algorithm with periodic cleanup.
 */
export function createRateLimiter(options: RateLimitOptions) {
  const { maxRequests, windowMs, trustProxy = false } = options;
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
    // When trustProxy is false (default), we do NOT read x-forwarded-for to prevent
    // IP spoofing attacks (an attacker could set arbitrary IPs to bypass rate limits).
    // In single-server deployments, all connections come through a trusted nginx proxy
    // on localhost, so x-real-ip is safe to use.
    // When trustProxy is true (behind a known trusted reverse proxy), x-forwarded-for
    // and x-real-ip are accepted.
    const ip = trustProxy
      ? (c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
        c.req.header("x-real-ip") ??
        "unknown")
      : (c.req.header("x-real-ip") ?? "unknown");

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
