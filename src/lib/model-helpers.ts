// src/lib/model-helpers.ts

/**
 * Normalise a raw model value from instance config.
 * Accepts string, object (serialized to JSON), or null/undefined.
 */
export function normaliseModel(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (raw !== null && typeof raw === "object") return JSON.stringify(raw);
  return null;
}
