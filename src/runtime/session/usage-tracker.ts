/**
 * Token usage normalization across LLM providers.
 */

import type { LanguageModelUsage } from "ai";

/**
 * Normalize SDK usage for spending and reporting.
 * Input totals already include cache tokens; cache details are informational
 * subsets, never extra tokens to add to that total.
 */
export function normalizeTokenUsage(usage: LanguageModelUsage): {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
} {
  return {
    input: usage.inputTokens ?? 0,
    output: usage.outputTokens ?? 0,
    cacheRead: usage.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWrite: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
  };
}
