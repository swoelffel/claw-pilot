/**
 * runtime/session/system-prompt-cache.ts
 *
 * In-memory cache + DB persistence for built system prompts.
 *
 * The in-memory cache serves the dashboard context endpoint during normal
 * operation (populated by the prompt-loop on each build).
 *
 * The DB table `rt_system_prompts` stores historical snapshots, deduplicated
 * by content hash. A new row is inserted only when the prompt content changes
 * (e.g. after compaction, workspace file edits, config changes). This gives
 * the Session Logs viewer access to the exact system prompt the LLM saw,
 * even after process restarts or for archived sessions.
 */

import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { SessionId } from "../types.js";

/** Stored entry with timestamp for freshness tracking */
export interface CachedPrompt {
  systemPrompt: string;
  builtAt: string; // ISO 8601
}

const _cache = new Map<SessionId, CachedPrompt>();

// --- In-memory cache (ephemeral) ---

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

// --- DB persistence (durable snapshots) ---

function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 16);
}

/**
 * Persist a system prompt snapshot to DB if the content has changed since the
 * last snapshot for this session. Uses a SHA-256 prefix hash for deduplication.
 *
 * Safe to call on every prompt-loop iteration — it is a no-op when the prompt
 * has not changed.
 */
export function persistSystemPromptSnapshot(
  db: Database.Database,
  sessionId: SessionId,
  systemPrompt: string,
): void {
  const hash = hashPrompt(systemPrompt);

  try {
    // Check if latest snapshot already has the same hash
    const latest = db
      .prepare(
        `SELECT prompt_hash FROM rt_system_prompts
         WHERE session_id = ? ORDER BY built_at DESC LIMIT 1`,
      )
      .get(sessionId) as { prompt_hash: string } | undefined;

    if (latest?.prompt_hash === hash) return; // No change — skip

    db.prepare(
      `INSERT INTO rt_system_prompts (session_id, prompt_hash, system_prompt, built_at)
       VALUES (?, ?, ?, datetime('now'))`,
    ).run(sessionId, hash, systemPrompt);
  } catch {
    // Non-critical — older DB schemas may not have the table yet
  }
}

/**
 * Retrieve the latest persisted system prompt snapshot for a session.
 * Used as fallback when the in-memory cache is empty (process restart, archived session).
 */
export function getPersistedSystemPrompt(
  db: Database.Database,
  sessionId: SessionId,
): CachedPrompt | undefined {
  try {
    const row = db
      .prepare(
        `SELECT system_prompt, built_at FROM rt_system_prompts
         WHERE session_id = ? ORDER BY built_at DESC LIMIT 1`,
      )
      .get(sessionId) as { system_prompt: string; built_at: string } | undefined;

    if (!row) return undefined;
    return { systemPrompt: row.system_prompt, builtAt: row.built_at };
  } catch {
    return undefined; // Table may not exist on older schemas
  }
}
