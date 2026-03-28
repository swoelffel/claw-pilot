/**
 * runtime/middleware/built-in/guardrail.ts
 *
 * Guardrail middleware — pluggable pre-tool authorization.
 *
 * Extends the static permission system with dynamic checks:
 * - Content moderation
 * - Cost gates (budget limits)
 * - Custom business rules
 *
 * Guardrail providers are registered globally and evaluated in order.
 * If any provider denies, the message is rejected with the reason.
 */

import type { Middleware, MiddlewareContext } from "../types.js";
import { getBus } from "../../bus/index.js";
import { GuardrailBlocked } from "../../bus/events.js";
import { logger } from "../../../lib/logger.js";

// ---------------------------------------------------------------------------
// GuardrailProvider interface
// ---------------------------------------------------------------------------

export interface GuardrailContext {
  /** The user's message text */
  text: string;
  /** Channel type (telegram, web, internal, etc.) */
  channelType: string;
  /** Agent ID */
  agentId: string;
  /** Session ID */
  sessionId: string;
  /** Instance slug */
  instanceSlug: string;
}

export type GuardrailResult = { allowed: true } | { allowed: false; reason: string };

export interface GuardrailProvider {
  /** Unique provider name (for logging) */
  name: string;
  /** Evaluate the message. Return allowed:false to block. */
  check(ctx: GuardrailContext): Promise<GuardrailResult>;
}

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

const _providers: GuardrailProvider[] = [];

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export const guardrailMiddleware: Middleware = {
  name: "guardrail",
  order: 10, // Early — block before anything else

  async pre(ctx: MiddlewareContext): Promise<void> {
    if (_providers.length === 0) return;

    const guardrailCtx: GuardrailContext = {
      text: ctx.message.text,
      channelType: ctx.message.channelType,
      agentId: ctx.agentConfig.id,
      sessionId: ctx.sessionId,
      instanceSlug: ctx.instanceSlug,
    };

    for (const provider of _providers) {
      try {
        const result = await provider.check(guardrailCtx);
        if (!result.allowed) {
          const bus = getBus(ctx.instanceSlug);
          bus.publish(GuardrailBlocked, {
            sessionId: ctx.sessionId,
            provider: provider.name,
            reason: result.reason,
          });
          logger.info("guardrail_blocked", {
            event: "guardrail_blocked",
            provider: provider.name,
            reason: result.reason,
            sessionId: ctx.sessionId,
          });
          ctx.abort(result.reason);
          return;
        }
      } catch (err) {
        // Guardrail errors are non-fatal — log and continue
        logger.warn(`Guardrail provider "${provider.name}" threw: ${err}`);
      }
    }
  },
};
