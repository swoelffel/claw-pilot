/**
 * runtime/plugin/hooks.ts
 *
 * Hook runner — triggers registered plugin hooks in order.
 * Errors in individual hooks are caught and logged (non-fatal).
 */

import type {
  PluginHooks,
  AgentStartContext,
  AgentEndContext,
  ToolCallContext,
  ToolResultContext,
  MessageContext,
  SessionContext,
} from "./types.js";
import { logger } from "../../lib/logger.js";

// ---------------------------------------------------------------------------
// Hook registry (module-level, per instance)
// ---------------------------------------------------------------------------

const _hooks: PluginHooks[] = [];

/**
 * Register a plugin's hooks.
 * Called by the plugin loader after initializing each plugin.
 */
export function registerHooks(hooks: PluginHooks): void {
  _hooks.push(hooks);
}

/**
 * Clear all registered hooks (useful for testing).
 */
export function clearHooks(): void {
  _hooks.length = 0;
}

/**
 * Returns all currently registered plugin hooks.
 * Used by getTools() to collect plugin-declared tools and by buildToolSet()
 * to apply tool.definition transformations.
 */
export function getRegisteredHooks(): PluginHooks[] {
  return [..._hooks];
}

// ---------------------------------------------------------------------------
// Hook trigger functions
// ---------------------------------------------------------------------------

export async function triggerAgentBeforeStart(ctx: AgentStartContext): Promise<void> {
  await runHooks("agent.beforeStart", ctx);
}

export async function triggerAgentEnd(ctx: AgentEndContext): Promise<void> {
  await runHooks("agent.end", ctx);
}

export async function triggerToolBeforeCall(ctx: ToolCallContext): Promise<void> {
  await runHooks("tool.beforeCall", ctx);
}

export async function triggerToolAfterCall(ctx: ToolResultContext): Promise<void> {
  await runHooks("tool.afterCall", ctx);
}

export async function triggerMessageReceived(ctx: MessageContext): Promise<void> {
  await runHooks("message.received", ctx);
}

export async function triggerMessageSending(ctx: MessageContext): Promise<void> {
  await runHooks("message.sending", ctx);
}

export async function triggerSessionStart(ctx: SessionContext): Promise<void> {
  await runHooks("session.start", ctx);
}

export async function triggerSessionEnd(ctx: SessionContext): Promise<void> {
  await runHooks("session.end", ctx);
}

// ---------------------------------------------------------------------------
// Internal runner
// ---------------------------------------------------------------------------

/**
 * Keys of PluginHooks that are simple void-returning event hooks.
 * Excludes "tools" and "tool.definition" which have different signatures
 * and are invoked directly (not via runHooks).
 */
type VoidHookKey = Exclude<keyof PluginHooks, "tools" | "tool.definition">;

async function runHooks<K extends VoidHookKey>(
  hookName: K,
  ctx: Parameters<NonNullable<PluginHooks[K]>>[0],
): Promise<void> {
  for (const hooks of _hooks) {
    const fn = hooks[hookName] as
      | ((ctx: Parameters<NonNullable<PluginHooks[K]>>[0]) => Promise<void> | void)
      | undefined;
    if (!fn) continue;
    try {
      await fn(ctx);
    } catch (err) {
      logger.warn(`Plugin hook "${hookName}" threw an error: ${err}`);
    }
  }
}
