// src/runtime/triggers/webhook-verifier.ts
//
// Pure helpers for inbound-webhook verification (TRIGGER-001).
//
// Three responsibilities:
//   1. HMAC-SHA256 signature verification (header `sha256=<hex>`)
//   2. IP allowlist matching (exact + IPv4/IPv6 CIDR)
//   3. Stable SHA-256 hash of a request body for replay detection
//
// All functions are pure and side-effect free; they read no environment
// state and emit no audit events. Callers wrap them with logging and
// audit emission as needed.

import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { logger } from "../../lib/logger.js";

// ---------------------------------------------------------------------------
// HMAC verification
// ---------------------------------------------------------------------------

/**
 * Verify an `X-ClawPilot-Signature: sha256=<hex>` header against the raw
 * request body, using a constant-time comparison.
 *
 * Returns false (never throws) for malformed headers, length mismatches, or
 * any other unexpected input — callers do not need to wrap this in try/catch.
 */
export function verifyHmacSignature(secret: string, body: string, header: string): boolean {
  if (!secret || !header) return false;
  const prefix = "sha256=";
  if (!header.startsWith(prefix)) return false;
  const provided = header.slice(prefix.length).trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(provided)) return false;

  const expected = createHmac("sha256", secret).update(body, "utf8").digest("hex");
  if (provided.length !== expected.length) return false;

  try {
    return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
  } catch (err) {
    logger.debug("hmac_compare_failed", { error: String(err) });
    return false;
  }
}

// ---------------------------------------------------------------------------
// IP allowlist
// ---------------------------------------------------------------------------

/**
 * Match `ip` against an allowlist of exact addresses or CIDR ranges.
 * A null/empty allowlist allows all IPs (caller-controlled policy).
 */
export function isIpAllowed(ip: string, allowlist: string[] | null): boolean {
  if (!allowlist || allowlist.length === 0) return true;
  if (!ip) return false;
  for (const entry of allowlist) {
    if (matchesEntry(ip, entry)) return true;
  }
  return false;
}

function matchesEntry(ip: string, entry: string): boolean {
  if (!entry.includes("/")) return ip === entry;
  const [base, bitsStr] = entry.split("/");
  if (!base || !bitsStr) return false;
  const bits = Number(bitsStr);
  if (!Number.isFinite(bits) || bits < 0) return false;

  const ipBytes = ipToBytes(ip);
  const baseBytes = ipToBytes(base);
  if (!ipBytes || !baseBytes) return false;
  if (ipBytes.length !== baseBytes.length) return false;
  if (bits > ipBytes.length * 8) return false;

  return bytesMatchPrefix(ipBytes, baseBytes, bits);
}

function bytesMatchPrefix(a: Uint8Array, b: Uint8Array, bits: number): boolean {
  let remaining = bits;
  for (let i = 0; i < a.length && remaining > 0; i++) {
    const take = Math.min(8, remaining);
    const mask = take === 8 ? 0xff : (0xff << (8 - take)) & 0xff;
    if ((a[i]! & mask) !== (b[i]! & mask)) return false;
    remaining -= take;
  }
  return true;
}

function ipToBytes(ip: string): Uint8Array | null {
  if (ip.includes(".")) return ipv4ToBytes(ip);
  if (ip.includes(":")) return ipv6ToBytes(ip);
  return null;
}

function ipv4ToBytes(ip: string): Uint8Array | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const out = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const n = Number(parts[i]);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    out[i] = n;
  }
  return out;
}

function ipv6ToBytes(ip: string): Uint8Array | null {
  // Expand `::` and parse each 16-bit group.
  const doubleColon = ip.indexOf("::");
  let head: string[];
  let tail: string[];
  if (doubleColon === -1) {
    head = ip.split(":");
    tail = [];
  } else {
    const before = ip.slice(0, doubleColon);
    const after = ip.slice(doubleColon + 2);
    head = before === "" ? [] : before.split(":");
    tail = after === "" ? [] : after.split(":");
  }
  const total = head.length + tail.length;
  if (total > 8) return null;
  const fill = 8 - total;
  const filler = Array.from({ length: fill }, () => "0");
  const groups = [...head, ...filler, ...tail];
  if (groups.length !== 8) return null;

  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const g = groups[i]!;
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    out[i * 2] = (n >> 8) & 0xff;
    out[i * 2 + 1] = n & 0xff;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Body hashing
// ---------------------------------------------------------------------------

/** Stable SHA-256 hex digest of a request body — used for replay detection. */
export function hashPayload(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}
