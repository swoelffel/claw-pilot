/**
 * runtime/session/system-prompt-cache.ts
 *
 * In-memory cache for the last built system prompt per session.
 * Used by the dashboard context endpoint to expose the real system prompt
 * without rebuilding it on every request.
 *
 * Cache is instance-scoped (Map<sessionId, string>) and is intentionally
 * ephemeral — it is lost on process restart, which is acceptable since the
 * system prompt is also rebuilt on the next LLM call.
 */

import type { SessionId } from "../types.js";

/** Stored entry with timestamp for freshness tracking */
interface CachedPrompt {
  systemPrompt: string;
  builtAt: string; // ISO 8601
}

const _cache = new Map<SessionId, CachedPrompt>();

/** Store (or overwrite) the last built system prompt for a session. */
export function cacheSystemPrompt(sessionId: SessionId, systemPrompt: string): void {
  _cache.set(sessionId, { systemPrompt, builtAt: new Date().toISOString() });
}

/** Retrieve the cached system prompt entry for a session, or undefined if not yet cached. */
export function getCachedSystemPrompt(sessionId: SessionId): CachedPrompt | undefined {
  return _cache.get(sessionId);
}

/** Remove the cached entry for a session (called on session cleanup). */
export function clearCachedSystemPrompt(sessionId: SessionId): void {
  _cache.delete(sessionId);
}
