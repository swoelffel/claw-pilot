// src/runtime/flow/_sitrep-normalizer.ts
//
// Pre-processor for complete_step tool arguments.
// LLMs occasionally hallucinate the JSON structure — this module normalises
// common patterns before Zod validation so legitimate step completions
// don't cascade-fail over formatting mistakes.

const CODE_FENCE_RE = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/s;
const BACKTICK_RE = /^`([\s\S]*)`$/s;
const XML_WRAPPER_RE = /^<\w+>([\s\S]*)<\/\w+>$/s;

/**
 * Attempt to normalise raw complete_step tool args into the expected object shape.
 * Called inside a Zod z.preprocess() — receives whatever the SDK parsed from
 * the LLM tool call.
 *
 * Returns the (possibly-modified) value; if normalisation fails, returns the
 * original input so Zod can emit a clear error.
 */
export function normaliseSitrepArgs(raw: unknown): unknown {
  // Already an object — just normalise casing
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    return normaliseCasing(raw as Record<string, unknown>);
  }

  if (typeof raw !== "string") return raw;

  // Try stripping code fences / XML wrappers
  const inner = extractInner(raw);
  if (inner === null) return raw; // could not extract

  // Try parsing the extracted string as JSON
  try {
    const parsed = JSON.parse(inner) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      return normaliseCasing(parsed as Record<string, unknown>);
    }
  } catch (err) {
    // JSON.parse failed — return original so Zod reports the real error
    void err;
  }

  return raw;
}

function extractInner(s: string): string | null {
  const trimmed = s.trim();
  const fenceMatch = CODE_FENCE_RE.exec(trimmed);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();
  const backtickMatch = BACKTICK_RE.exec(trimmed);
  if (backtickMatch?.[1]) return backtickMatch[1].trim();
  const xmlMatch = XML_WRAPPER_RE.exec(trimmed);
  if (xmlMatch?.[1]) return xmlMatch[1].trim();
  return null;
}

function normaliseCasing(obj: Record<string, unknown>): Record<string, unknown> {
  const result = { ...obj };
  if (typeof result["outcome"] === "string") {
    result["outcome"] = result["outcome"].toLowerCase();
  }
  return result;
}
