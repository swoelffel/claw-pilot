/**
 * runtime/session/__tests__/usage-tracker.test.ts
 *
 * Unit tests for normalizeTokenUsage().
 * Pure function — no mocks needed.
 */

import { describe, it, expect } from "vitest";
import type { LanguageModelUsage } from "ai";
import { normalizeTokenUsage } from "../usage-tracker.js";

/** Helper to build a full LanguageModelUsage object from partial values. */
function usage(partial: Partial<LanguageModelUsage> = {}): LanguageModelUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    inputTokenDetails: {
      noCacheTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
    outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    ...partial,
  };
}

describe("normalizeTokenUsage", () => {
  it("preserves the inclusive input total and standard cache details", () => {
    expect(
      normalizeTokenUsage(
        usage({
          inputTokens: 330,
          outputTokens: 50,
          inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 200, cacheWriteTokens: 30 },
        }),
      ),
    ).toEqual({ input: 330, output: 50, cacheRead: 200, cacheWrite: 30 });
  });

  it("uses standard cache details for every provider", () => {
    expect(
      normalizeTokenUsage(
        usage({
          inputTokens: 500,
          outputTokens: 200,
          inputTokenDetails: { noCacheTokens: 400, cacheReadTokens: 100, cacheWriteTokens: 0 },
        }),
      ),
    ).toEqual({ input: 500, output: 200, cacheRead: 100, cacheWrite: 0 });
  });

  it("defaults missing cache details without altering the input total", () => {
    expect(normalizeTokenUsage(usage({ inputTokens: 100, outputTokens: 50 }))).toEqual({
      input: 100,
      output: 50,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });

  it("defaults unknown usage to zero", () => {
    expect(normalizeTokenUsage(usage({ inputTokens: undefined, outputTokens: undefined }))).toEqual(
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    );
  });
});
