/**
 * runtime/middleware/pipeline.ts
 *
 * Executes the middleware chain around the prompt loop.
 *
 * Flow:
 *   1. Run all pre() middlewares in order
 *   2. If not aborted, call the prompt loop
 *   3. Run all post() middlewares in reverse order
 *
 * Errors in individual middlewares are caught and logged (non-fatal).
 * An abort() in pre phase skips the prompt loop and remaining pre middlewares,
 * but still runs all post middlewares (for cleanup).
 */

import type { MiddlewareContext } from "./types.js";
import type { PromptLoopResult } from "../session/prompt-loop.js";
import { getMiddlewares } from "./registry.js";
import { logger } from "../../lib/logger.js";

// ---------------------------------------------------------------------------
// Pipeline execution
// ---------------------------------------------------------------------------

export interface PipelineInput {
  /** Initial middleware context (message, session, agent, etc.) */
  ctx: Omit<MiddlewareContext, "metadata" | "abort" | "result">;
  /** The prompt loop function to call between pre and post phases */
  runLoop: () => Promise<PromptLoopResult>;
}

export interface PipelineOutput {
  /** The prompt loop result (undefined if aborted before loop) */
  result: PromptLoopResult | undefined;
  /** Whether the pipeline was aborted by a middleware */
  aborted: boolean;
  /** Abort reason if aborted */
  abortReason?: string;
}

/**
 * Execute the middleware pipeline around a prompt loop call.
 *
 * Performance target: < 5ms overhead for an empty middleware chain.
 */
export async function runMiddlewarePipeline(input: PipelineInput): Promise<PipelineOutput> {
  const middlewares = getMiddlewares();

  // Fast path: no middlewares registered → skip pipeline overhead
  if (middlewares.length === 0) {
    const result = await input.runLoop();
    return { result, aborted: false };
  }

  // Build full context with abort support
  let aborted = false;
  let abortReason: string | undefined;

  const ctx: MiddlewareContext = {
    ...input.ctx,
    metadata: new Map(),
    abort(reason: string) {
      aborted = true;
      abortReason = reason;
    },
  };

  // Phase 1: Pre-middlewares (in order)
  for (const mw of middlewares) {
    if (aborted) break;
    if (!mw.pre) continue;
    try {
      await mw.pre(ctx);
    } catch (err) {
      logger.warn(`Middleware "${mw.name}" pre() threw: ${err}`);
    }
  }

  // Phase 2: Run the prompt loop (unless aborted)
  let result: PromptLoopResult | undefined;
  if (!aborted) {
    result = await input.runLoop();
    ctx.result = result;
  }

  // Phase 3: Post-middlewares (in reverse order)
  for (let i = middlewares.length - 1; i >= 0; i--) {
    const mw = middlewares[i]!;
    if (!mw.post) continue;
    try {
      await mw.post(ctx);
    } catch (err) {
      logger.warn(`Middleware "${mw.name}" post() threw: ${err}`);
    }
  }

  return {
    result,
    aborted,
    ...(abortReason !== undefined ? { abortReason } : {}),
  };
}
