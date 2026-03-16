/**
 * runtime/session/usage-tracker.ts
 *
 * Token usage normalization across LLM providers.
 * Extracted from prompt-loop.ts to keep each module focused.
 */

/**
 * Normalize token usage across providers.
 *
 * In Vercel AI SDK v6, `usage.inputTokens` and `usage.outputTokens` are plain numbers.
 * Provider-specific metadata (cacheRead, cacheWrite) is available via `providerMetadata`.
 *
 * Anthropic excludes cached tokens from inputTokens, while OpenAI includes them.
 * This function produces a consistent "real input tokens" count for cost calculation.
 */
export function normalizeTokenUsage(
  usage: import("ai").LanguageModelUsage,
  providerMetadata: import("ai").ProviderMetadata | undefined,
  providerId: string,
): { input: number; output: number; cacheRead: number; cacheWrite: number } {
  const rawInput = usage.inputTokens ?? 0;
  const rawOutput = usage.outputTokens ?? 0;

  const anthropicMeta = providerMetadata?.["anthropic"] as
    | { cacheReadInputTokens?: number; cacheCreationInputTokens?: number }
    | undefined;
  const cacheRead = anthropicMeta?.cacheReadInputTokens ?? 0;
  const cacheWrite = anthropicMeta?.cacheCreationInputTokens ?? 0;

  if (providerId === "anthropic") {
    return {
      input: rawInput + cacheRead + cacheWrite,
      output: rawOutput,
      cacheRead,
      cacheWrite,
    };
  }

  return { input: rawInput, output: rawOutput, cacheRead, cacheWrite };
}
