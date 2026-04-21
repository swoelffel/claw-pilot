// src/core/audit/canonical.ts
//
// Canonical JSON stringify + SHA-256 hashing for `agent.tool_call` args.
//
// Canonical form = JSON with keys sorted lexicographically at every level.
// This guarantees two structurally-identical argument objects produce the
// same hash regardless of property insertion order, which matters for SIEM
// deduplication and audit-trail stability across model re-runs.

import { createHash } from "node:crypto";

/**
 * Deterministic JSON stringify with lexicographically-sorted keys at every
 * level. `undefined` values and functions are dropped (standard JSON.stringify
 * behavior). Cycles are not supported — callers must pass serializable input.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => sortKeys(item));
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = sortKeys(obj[key]);
  }
  return out;
}

/**
 * SHA-256 (hex) of the canonical JSON form of `args`. Used as the stable
 * identifier in `agent.tool_call` envelopes.
 */
export function hashArgs(args: unknown): string {
  return createHash("sha256").update(canonicalize(args)).digest("hex");
}
