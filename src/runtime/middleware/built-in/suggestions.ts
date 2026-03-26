/**
 * runtime/middleware/built-in/suggestions.ts
 *
 * Post-middleware that generates follow-up suggestions after a prompt loop run.
 * Uses a lightweight LLM call to propose 2-3 contextual next actions.
 *
 * Non-fatal: all errors are caught and logged — missing suggestions are acceptable.
 */

import { generateText } from "ai";
import type { Middleware, MiddlewareContext } from "../types.js";
import type { ModelAlias } from "../../config/index.js";
import { resolveModel } from "../../provider/provider.js";
import { createPart } from "../../session/part.js";
import { listMessages } from "../../session/message.js";
import { listParts } from "../../session/part.js";
import { getBus } from "../../bus/index.js";
import { SuggestionsGenerated } from "../../bus/events.js";
import { logger } from "../../../lib/logger.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_TEXT_LENGTH = 20;
const MAX_CONTEXT_MESSAGES = 6;
const MAX_TOKENS = 200;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface SuggestionMiddlewareOptions {
  /** Override model for suggestion generation (e.g. "anthropic/claude-haiku-3-5") */
  suggestionsModel?: string;
  /** Number of suggestions to generate */
  maxSuggestions: number;
  /** Named model aliases from runtime config */
  modelAliases?: ModelAlias[];
}

/**
 * Create a suggestion post-middleware.
 * Receives config at registration time (dependency injection pattern).
 */
export function createSuggestionMiddleware(opts: SuggestionMiddlewareOptions): Middleware {
  return {
    name: "suggestions",
    order: 90,

    async post(ctx: MiddlewareContext): Promise<void> {
      // Guard: skip if no result (aborted) or text too short
      if (!ctx.result || (ctx.result.text?.length ?? 0) < MIN_TEXT_LENGTH) return;

      try {
        await generateSuggestions(ctx, opts);
      } catch (err) {
        logger.warn(`Suggestion middleware failed (non-fatal): ${err}`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function generateSuggestions(
  ctx: MiddlewareContext,
  opts: SuggestionMiddlewareOptions,
): Promise<void> {
  const { db, instanceSlug, sessionId, agentConfig } = ctx;
  const messageId = ctx.result!.messageId;

  // 1. Build conversation summary for context
  const messages = listMessages(db, sessionId);
  const recent = messages.slice(-MAX_CONTEXT_MESSAGES);
  const conversationLines: string[] = [];
  for (const msg of recent) {
    const parts = listParts(db, msg.id);
    const text = parts
      .filter((p) => p.type === "text")
      .map((p) => p.content ?? "")
      .join("\n");
    if (text.trim()) {
      conversationLines.push(`[${msg.role}]: ${text.slice(0, 500)}`);
    }
  }
  const conversationSummary = conversationLines.join("\n");

  // 2. Resolve model
  const modelStr = opts.suggestionsModel ?? agentConfig.model;
  const resolved = resolveModelFromString(modelStr, opts.modelAliases);

  // 3. Generate suggestions
  const result = await generateText({
    model: resolved.languageModel,
    messages: [
      {
        role: "user",
        content:
          `${conversationSummary}\n\n---\n\n` +
          `Based on this conversation, suggest exactly ${opts.maxSuggestions} short follow-up actions ` +
          `the user might want to take next. Each suggestion should be 5-15 words, ` +
          `written as a direct request the user would say. ` +
          `Write suggestions in the SAME LANGUAGE as the conversation. ` +
          `Return ONLY a JSON array of strings, nothing else.\n` +
          `Example: ["Run the test suite", "Add error handling to the API"]`,
      },
    ],
    maxOutputTokens: MAX_TOKENS,
  });

  // 4. Parse response
  const suggestions = parseSuggestions(result.text, opts.maxSuggestions);
  if (suggestions.length === 0) return;

  // 5. Create suggestion part on the assistant message
  createPart(db, {
    messageId,
    type: "suggestion",
    content: JSON.stringify(suggestions),
    metadata: JSON.stringify({
      model: `${resolved.providerId}/${resolved.modelId}`,
      generatedAt: new Date().toISOString(),
    }),
  });

  // 6. Emit bus event for SSE
  const bus = getBus(instanceSlug);
  bus.publish(SuggestionsGenerated, { sessionId, messageId, suggestions });
}

function parseSuggestions(text: string, max: number): string[] {
  try {
    // Try to extract JSON array from response (may be wrapped in markdown code block)
    const cleaned = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    const parsed: unknown = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .slice(0, max);
  } catch {
    return [];
  }
}

function resolveModelFromString(
  modelStr: string,
  aliases?: ModelAlias[],
): { languageModel: import("ai").LanguageModel; providerId: string; modelId: string } {
  // Check named alias first
  if (aliases) {
    const alias = aliases.find((a) => a.id === modelStr);
    if (alias) return resolveModel(alias.provider, alias.model);
  }
  // Standard "provider/model" format
  const slashIdx = modelStr.indexOf("/");
  if (slashIdx === -1) {
    throw new Error(`Invalid model ref "${modelStr}": expected "provider/model" format`);
  }
  return resolveModel(modelStr.slice(0, slashIdx), modelStr.slice(slashIdx + 1));
}
