/**
 * runtime/session/system-prompt-dirty.ts
 *
 * In-memory dirty flag + base prompt cache for the system prompt.
 *
 * The system prompt is expensive to build (file I/O, SQL, memory scan).
 * Most turns change nothing — the prompt is identical to the previous one.
 * This module tracks which sessions need a rebuild via dirty flags set by
 * producers (compaction, file writes, profile updates).
 *
 * The base prompt cache stores the prompt WITHOUT skills and extraSystemPrompt,
 * which are recalculated on every turn (skills depend on user text, extra is
 * per-call subagent context).
 *
 * All state is in-memory — lost on daemon restart, which is correct since the
 * cache is also lost and all prompts rebuild naturally.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Reasons that invalidate the cached system prompt. */
export type DirtyReason = "compaction" | "workspace" | "memory" | "profile" | "system-state";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Per-session dirty flags. */
const _dirty = new Map<string, Set<DirtyReason>>();

/** Global generation counter — bumped by markAllDirty(). */
let _globalGeneration = 0;

/** Last generation each session was cleared at. */
const _sessionGeneration = new Map<string, number>();

/** Base prompt cache (prompt without skills and extraSystemPrompt). */
const _basePromptCache = new Map<string, string>();

// ---------------------------------------------------------------------------
// Producers — mark dirty
// ---------------------------------------------------------------------------

/** Mark a specific session as dirty for the given reason. */
export function markDirty(sessionId: string, reason: DirtyReason): void {
  const set = _dirty.get(sessionId) ?? new Set();
  set.add(reason);
  _dirty.set(sessionId, set);
}

/** Mark ALL sessions as dirty (global change — e.g. user profile update). */
export function markAllDirty(reason: DirtyReason): void {
  _globalGeneration++;
  // Also mark already-tracked sessions explicitly
  for (const [id] of _dirty) {
    markDirty(id, reason);
  }
}

// ---------------------------------------------------------------------------
// Consumer — check dirty
// ---------------------------------------------------------------------------

/** Check whether a session needs a system prompt rebuild. */
export function isDirty(sessionId: string): boolean {
  // Global change not yet seen by this session
  // Default to current generation so unknown sessions are NOT dirty
  const sessionGen = _sessionGeneration.get(sessionId) ?? _globalGeneration;
  if (sessionGen < _globalGeneration) return true;
  // Per-session flags
  const set = _dirty.get(sessionId);
  return set !== undefined && set.size > 0;
}

/** Clear dirty state after a successful rebuild. */
export function clearDirty(sessionId: string): void {
  _dirty.delete(sessionId);
  _sessionGeneration.set(sessionId, _globalGeneration);
}

// ---------------------------------------------------------------------------
// Base prompt cache
// ---------------------------------------------------------------------------

/** Get the cached base prompt (without skills / extraSystemPrompt). */
export function getCachedBasePrompt(sessionId: string): string | undefined {
  return _basePromptCache.get(sessionId);
}

/** Store the base prompt after a full rebuild. */
export function cacheBasePrompt(sessionId: string, basePrompt: string): void {
  _basePromptCache.set(sessionId, basePrompt);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/** Remove all dirty state and cached prompt for a session (on session delete). */
export function clearSessionDirtyState(sessionId: string): void {
  _dirty.delete(sessionId);
  _sessionGeneration.delete(sessionId);
  _basePromptCache.delete(sessionId);
}

// ---------------------------------------------------------------------------
// Test helpers (exported for unit tests only)
// ---------------------------------------------------------------------------

/** @internal Reset all module state — for tests only. */
export function _resetForTests(): void {
  _dirty.clear();
  _globalGeneration = 0;
  _sessionGeneration.clear();
  _basePromptCache.clear();
}
