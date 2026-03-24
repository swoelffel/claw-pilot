/**
 * runtime/middleware/types.ts
 *
 * Middleware chain types for the message processing pipeline.
 *
 * Middlewares run between session resolution and the prompt loop:
 *   - pre(): enriches the inbound message before runPromptLoop
 *   - post(): enriches the result after runPromptLoop
 *
 * Middlewares MUST NOT:
 *   - Wrap or intercept the LLM streaming call
 *   - Modify the plugin hook registry
 *   - Block for more than 50ms (use async + fire-and-forget for heavy work)
 */

import type Database from "better-sqlite3";
import type { InboundMessage, InstanceSlug, SessionId } from "../types.js";
import type { RuntimeAgentConfig } from "../config/index.js";
import type { PromptLoopResult } from "../session/prompt-loop.js";

// ---------------------------------------------------------------------------
// MiddlewareContext
// ---------------------------------------------------------------------------

export interface MiddlewareContext {
  /** SQLite database handle */
  readonly db: Database.Database;
  /** Instance slug */
  readonly instanceSlug: InstanceSlug;
  /** Session ID (resolved before middleware runs) */
  readonly sessionId: SessionId;
  /** Agent configuration */
  readonly agentConfig: RuntimeAgentConfig;
  /** Inbound message — mutable in pre phase */
  message: InboundMessage;
  /** Prompt loop result — available only in post phase */
  result?: PromptLoopResult;
  /** Shared metadata map — persists across all middlewares in a single request */
  readonly metadata: Map<string, unknown>;
  /** Abort the pipeline — skips remaining middlewares and prompt loop */
  abort(reason: string): void;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export interface Middleware {
  /** Unique middleware name (for logging and debugging) */
  readonly name: string;
  /** Execution order — lower values run first. Built-in range: 0–99 */
  readonly order: number;
  /** Runs before the prompt loop. Can modify ctx.message or call ctx.abort(). */
  pre?: (ctx: MiddlewareContext) => Promise<void>;
  /** Runs after the prompt loop. Can read ctx.result and enrich metadata. */
  post?: (ctx: MiddlewareContext) => Promise<void>;
}
