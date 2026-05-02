// src/runtime/triggers/jsonpath-mapper.ts
//
// Apply a trigger's `input_mapping` array — a list of
// `{ from: <JSONPath>, to: <flowVar> }` entries — to a webhook/cron payload,
// producing the variable bag injected into the flow templating context as
// `trigger.mapped`.
//
// Uses `jsonpath-plus` (no `eval`, CSP-safe). Each entry's `from` resolves
// to the *first* match; missing paths default to `null` so templates can
// safely reference them without throwing.

import { JSONPath } from "jsonpath-plus";
import { logger } from "../../lib/logger.js";

export interface InputMappingEntry {
  from: string;
  to: string;
}

/**
 * Apply `mapping` to `payload`. A null/empty mapping returns `{}`.
 *
 * Each entry produces one key in the result. The value is the first JSONPath
 * match — when no match is found (or the path errors), the key is set to
 * `null`. Errors are logged at warn level; the mapper never throws.
 */
export function applyInputMapping(
  payload: unknown,
  mapping: InputMappingEntry[] | null,
): Record<string, unknown> {
  if (!mapping || mapping.length === 0) return {};
  const out: Record<string, unknown> = {};
  for (const entry of mapping) {
    if (!entry || typeof entry.from !== "string" || typeof entry.to !== "string") continue;
    out[entry.to] = resolveFirst(payload, entry.from);
  }
  return out;
}

function resolveFirst(payload: unknown, path: string): unknown {
  try {
    const matches = JSONPath({ path, json: payload as object, wrap: true }) as unknown[];
    if (!Array.isArray(matches) || matches.length === 0) return null;
    const first = matches[0];
    return first === undefined ? null : first;
  } catch (err) {
    logger.warn("trigger_jsonpath_failed", {
      event: "trigger_jsonpath_failed",
      path,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
