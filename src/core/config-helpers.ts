// src/core/config-helpers.ts
//
// Internal utilities for reading/writing .env files and merging config objects.
// Not exported from the public API — used only by config-reader.ts and config-writer.ts.

// ---------------------------------------------------------------------------
// Env file helpers
// ---------------------------------------------------------------------------

/** Parse a .env file into a key-value map */
export function parseEnv(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx);
    const value = trimmed.slice(eqIdx + 1);
    map.set(key, value);
  }
  return map;
}

/** Serialize a key-value map back to .env format */
export function serializeEnv(map: Map<string, string>): string {
  const lines: string[] = [];
  for (const [key, value] of map) {
    lines.push(`${key}=${value}`);
  }
  return lines.join("\n") + "\n";
}

/** Mask a secret value: show first 8 chars + *** + last 4 chars */
export function maskSecret(value: string | undefined): string | null {
  if (!value || value.length === 0) return null;
  if (value.length <= 12) return "****";
  return value.slice(0, 8) + "***" + value.slice(-4);
}

// ---------------------------------------------------------------------------
// Deep merge utility
// ---------------------------------------------------------------------------

/**
 * Deep-merge source into target. Arrays are replaced (not merged element-by-element).
 * Only modifies fields present in source; absent fields in target are preserved.
 */
export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = target[key];
    if (
      srcVal !== null &&
      typeof srcVal === "object" &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === "object" &&
      !Array.isArray(tgtVal)
    ) {
      target[key] = deepMerge(tgtVal as Record<string, unknown>, srcVal as Record<string, unknown>);
    } else {
      target[key] = srcVal;
    }
  }
  return target;
}
