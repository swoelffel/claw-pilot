/**
 * runtime/middleware/built-in/tool-error-recovery.ts
 *
 * Tool error recovery middleware — post-processing that classifies tool errors
 * and stores recovery hints in metadata for the next prompt loop turn.
 *
 * Error classification:
 * - rate-limit: provider throttling → hint to wait/retry
 * - timeout: operation took too long → hint to simplify
 * - parsing: invalid input/output → hint to reformulate
 * - unknown: unclassified → generic hint
 *
 * Recovery hints are stored in ctx.metadata under "toolErrorHints" key.
 * Future middlewares or prompt builders can read this to inject recovery instructions.
 */

import type { Middleware, MiddlewareContext } from "../types.js";
import { ToolErrorRecovered } from "../../bus/events.js";
import { getBus } from "../../bus/index.js";
import { logger } from "../../../lib/logger.js";

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

type ErrorType = "rate-limit" | "timeout" | "parsing" | "unknown";

function classifyError(errorMessage: string): ErrorType {
  const lower = errorMessage.toLowerCase();
  if (lower.includes("rate limit") || lower.includes("429") || lower.includes("throttl")) {
    return "rate-limit";
  }
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("deadline")) {
    return "timeout";
  }
  if (
    lower.includes("parse") ||
    lower.includes("invalid") ||
    lower.includes("schema") ||
    lower.includes("validation")
  ) {
    return "parsing";
  }
  return "unknown";
}

const RECOVERY_HINTS: Record<ErrorType, string> = {
  "rate-limit": "The previous tool call was rate-limited. Wait a moment before retrying.",
  timeout:
    "The previous tool call timed out. Try a simpler approach or break the task into smaller steps.",
  parsing:
    "The previous tool call failed due to invalid input. Check the arguments and try again with corrected values.",
  unknown: "The previous tool call failed. Try a different approach.",
};

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export const toolErrorRecoveryMiddleware: Middleware = {
  name: "tool-error-recovery",
  order: 90, // Late — runs after most other post middlewares

  async post(ctx: MiddlewareContext): Promise<void> {
    if (!ctx.result) return;

    // Check if the result text contains tool error indicators
    // This is a lightweight heuristic — tool errors are already persisted in rt_parts
    const text = ctx.result.text;
    if (!text.includes("error") && !text.includes("Error") && !text.includes("failed")) {
      return;
    }

    // Look for tool error patterns in the result
    const errorPatterns = [
      /tool '([^']+)' (?:failed|error|threw)/i,
      /error (?:in|from|calling) (?:tool )?'?([^':]+)'?/i,
    ];

    for (const pattern of errorPatterns) {
      const match = text.match(pattern);
      if (match) {
        const toolName = match[1] ?? "unknown";
        const errorType = classifyError(text);
        const hint = RECOVERY_HINTS[errorType];

        // Store hint in metadata for potential use by future middleware or prompt builder
        const existingHints = (ctx.metadata.get("toolErrorHints") as string[] | undefined) ?? [];
        existingHints.push(hint);
        ctx.metadata.set("toolErrorHints", existingHints);

        const bus = getBus(ctx.instanceSlug);
        bus.publish(ToolErrorRecovered, {
          sessionId: ctx.sessionId,
          toolName,
          errorType,
        });

        logger.debug("tool_error_recovery", {
          event: "tool_error_recovery",
          sessionId: ctx.sessionId,
          toolName,
          errorType,
        });

        break; // One hint per turn is enough
      }
    }
  },
};
