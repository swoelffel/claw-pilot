/**
 * runtime/session/workspace-cache.ts
 *
 * In-memory cache for workspace files read during system prompt construction.
 *
 * Problem: buildSystemPrompt() is called on every LLM turn. It reads SOUL.md,
 * AGENTS.md, IDENTITY.md, TOOLS.md, USER.md, HEARTBEAT.md, BOOTSTRAP.md, and
 * skill files via readFileSync on every call. For a busy agent (many messages),
 * this is O(N_files × N_messages) synchronous disk I/O — entirely wasted since
 * workspace files rarely change.
 *
 * Solution: cache file contents keyed by absolute path, with invalidation
 * triggered by file mtime change. TTL-based expiry ensures the cache does not
 * grow unboundedly for long-running instances.
 *
 * Cache entries are invalidated when:
 *   - The file mtime differs from the cached mtime (file was written)
 *   - The entry is older than CACHE_TTL_MS (safety net)
 *   - The file no longer exists (entry is removed)
 */

import { readFileSync, statSync } from "node:fs";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Cache entry lifetime in milliseconds (default: 30 seconds). */
const CACHE_TTL_MS = 30_000;

/** Maximum number of entries in the cache (prevents unbounded growth). */
const MAX_ENTRIES = 200;

// ---------------------------------------------------------------------------
// Cache internals
// ---------------------------------------------------------------------------

interface CacheEntry {
  content: string;
  mtime: number; // ms since epoch
  cachedAt: number; // ms since epoch
}

const _cache = new Map<string, CacheEntry>();

/**
 * Read a workspace file, returning the cached content if valid.
 * Falls back to a direct readFileSync on cache miss or invalidation.
 * Returns undefined if the file does not exist or cannot be read.
 */
export function readWorkspaceFileCached(filePath: string): string | undefined {
  const now = Date.now();

  const existing = _cache.get(filePath);
  if (existing) {
    // Check TTL
    if (now - existing.cachedAt > CACHE_TTL_MS) {
      _cache.delete(filePath);
    } else {
      // Check mtime — has the file changed?
      try {
        const stat = statSync(filePath);
        const mtime = stat.mtimeMs;
        if (mtime === existing.mtime) {
          return existing.content; // Cache hit
        }
        // mtime changed — invalidate and re-read below
        _cache.delete(filePath);
      } catch {
        // File no longer exists
        _cache.delete(filePath);
        return undefined;
      }
    }
  }

  // Cache miss or invalidated — read from disk
  try {
    const stat = statSync(filePath);
    const content = readFileSync(filePath, "utf-8");

    // Evict oldest entry if cache is at capacity
    if (_cache.size >= MAX_ENTRIES) {
      const oldest = _cache.keys().next().value;
      if (oldest !== undefined) _cache.delete(oldest);
    }

    _cache.set(filePath, {
      content,
      mtime: stat.mtimeMs,
      cachedAt: now,
    });

    return content;
  } catch {
    return undefined;
  }
}

/**
 * Explicitly invalidate a cached entry for a given path.
 * Call this after writing a workspace file to ensure the next read is fresh.
 */
export function invalidateWorkspaceCache(filePath: string): void {
  _cache.delete(filePath);
}

/**
 * Clear all cached entries. Useful for testing or after a bulk workspace update.
 */
export function clearWorkspaceCache(): void {
  _cache.clear();
}
