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
  it("Anthropic: adds cacheRead + cacheWrite to input", () => {
    const result = normalizeTokenUsage(
      usage({ inputTokens: 100, outputTokens: 50, totalTokens: 150 }),
      { anthropic: { cacheReadInputTokens: 200, cacheCreationInputTokens: 30 } },
      "anthropic",
    );
    expect(result).toEqual({ input: 330, output: 50, cacheRead: 200, cacheWrite: 30 });
  });

  it("Anthropic: without cache metadata uses zeros", () => {
    const result = normalizeTokenUsage(
      usage({ inputTokens: 100, outputTokens: 50, totalTokens: 150 }),
      { anthropic: {} },
      "anthropic",
    );
    expect(result).toEqual({ input: 100, output: 50, cacheRead: 0, cacheWrite: 0 });
  });

  it("Anthropic: undefined providerMetadata", () => {
    const result = normalizeTokenUsage(
      usage({ inputTokens: 100, outputTokens: 50, totalTokens: 150 }),
      undefined,
      "anthropic",
    );
    expect(result).toEqual({ input: 100, output: 50, cacheRead: 0, cacheWrite: 0 });
  });

  it("non-Anthropic: returns raw tokens without cache adjustment", () => {
    const result = normalizeTokenUsage(
      usage({ inputTokens: 500, outputTokens: 200, totalTokens: 700 }),
      undefined,
      "openai",
    );
    expect(result).toEqual({ input: 500, output: 200, cacheRead: 0, cacheWrite: 0 });
  });

  it("non-Anthropic: still extracts anthropic cache metadata if present", () => {
    const result = normalizeTokenUsage(
      usage({ inputTokens: 500, outputTokens: 200, totalTokens: 700 }),
      { anthropic: { cacheReadInputTokens: 100, cacheCreationInputTokens: 50 } },
      "openai",
    );
    // Non-anthropic does NOT add cache to input
    expect(result.input).toBe(500);
    expect(result.cacheRead).toBe(100);
    expect(result.cacheWrite).toBe(50);
  });

  it("handles zero token values", () => {
    const result = normalizeTokenUsage(
      usage({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
      undefined,
      "anthropic",
    );
    expect(result).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });

  it("handles missing inputTokens/outputTokens (defaults to 0)", () => {
    const result = normalizeTokenUsage({} as any, undefined, "openai");
    expect(result).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });

  it("handles Google provider", () => {
    const result = normalizeTokenUsage(
      usage({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 }),
      undefined,
      "google",
    );
    expect(result).toEqual({ input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 });
  });
});
