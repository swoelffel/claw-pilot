/**
 * runtime/memory/index.ts
 *
 * Long-term memory indexing for claw-runtime.
 *
 * Builds and maintains a SQLite FTS5 full-text search index over the agent's
 * memory files (MEMORY.md + memory/*.md). The index lives in a separate DB
 * file (<stateDir>/memory-index.db) to avoid polluting the main registry.
 *
 * Design:
 * - Chunking: MEMORY.md and memory/*.md are split into overlapping paragraphs
 * - Index: SQLite FTS5 with unicode61 tokenizer (BM25 ranking)
 * - Rebuild: full rebuild on each call to rebuildMemoryIndex() — simple and
 *   correct; incremental updates can be added later if performance requires it
 * - FTS5 covers 80% of use cases (keyword search, phrase search). Vector
 *   embeddings are not needed for V1.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum characters per chunk */
const CHUNK_SIZE = 500;

/** Character overlap between consecutive chunks */
const CHUNK_OVERLAP = 100;

/** Default maximum number of search results */
const DEFAULT_MAX_RESULTS = 5;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemorySearchResult {
  /** Source file name (e.g. "MEMORY.md", "memory/architecture.md") */
  source: string;
  /** Text chunk content */
  chunk: string;
  /** BM25 rank (lower = more relevant in SQLite FTS5) */
  rank: number;
}

// ---------------------------------------------------------------------------
// Index management
// ---------------------------------------------------------------------------

/**
 * Open (or create) the memory index database.
 * Creates the FTS5 virtual table if it does not exist.
 */
export function openMemoryIndex(stateDir: string): Database.Database {
  const dbPath = path.join(stateDir, "memory-index.db");
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks USING fts5(
      source UNINDEXED,
      chunk,
      tokenize = "unicode61"
    );
  `);

  return db;
}

/**
 * Rebuild the memory index from scratch.
 *
 * Reads MEMORY.md and all memory/*.md files from the agent's workspace
 * directory, chunks them, and inserts them into the FTS5 index.
 *
 * The workspace directory is resolved as:
 *   <workDir>/workspace-<agentId>/  (priority)
 *   <workDir>/workspace/            (fallback)
 *
 * This is a full rebuild — all existing chunks are deleted first.
 * Errors during file reading are silently ignored (missing files are skipped).
 */
export function rebuildMemoryIndex(
  memoryDb: Database.Database,
  workDir: string,
  agentId: string,
): void {
  // Resolve workspace directory (same logic as system-prompt.ts)
  const candidates = [path.join(workDir, `workspace-${agentId}`), path.join(workDir, "workspace")];

  let wsDir: string | undefined;
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      wsDir = candidate;
      break;
    }
  }

  if (!wsDir) return; // No workspace found — nothing to index

  // Collect files to index
  const filesToIndex: Array<{ source: string; filePath: string }> = [];

  // MEMORY.md
  const memoryMd = path.join(wsDir, "MEMORY.md");
  if (fs.existsSync(memoryMd)) {
    filesToIndex.push({ source: "MEMORY.md", filePath: memoryMd });
  }

  // memory/*.md (alphabetical order)
  const memoryDir = path.join(wsDir, "memory");
  if (fs.existsSync(memoryDir)) {
    try {
      if (fs.statSync(memoryDir).isDirectory()) {
        const files = fs
          .readdirSync(memoryDir)
          .filter((f) => f.endsWith(".md"))
          .sort();
        for (const filename of files) {
          filesToIndex.push({
            source: `memory/${filename}`,
            filePath: path.join(memoryDir, filename),
          });
        }
      }
    } catch {
      // Directory inaccessible — skip
    }
  }

  if (filesToIndex.length === 0) return;

  // Full rebuild: delete all existing chunks, then re-insert
  memoryDb.exec("DELETE FROM memory_chunks");

  const insert = memoryDb.prepare("INSERT INTO memory_chunks (source, chunk) VALUES (?, ?)");

  const insertMany = memoryDb.transaction(
    (entries: Array<{ source: string; chunks: string[] }>) => {
      for (const entry of entries) {
        for (const chunk of entry.chunks) {
          insert.run(entry.source, chunk);
        }
      }
    },
  );

  const entries: Array<{ source: string; chunks: string[] }> = [];

  for (const { source, filePath } of filesToIndex) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const chunks = chunkText(content, CHUNK_SIZE, CHUNK_OVERLAP);
      if (chunks.length > 0) {
        entries.push({ source, chunks });
      }
    } catch {
      // File unreadable — skip silently
    }
  }

  if (entries.length > 0) {
    insertMany(entries);
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Search the memory index using FTS5 full-text search (BM25 ranking).
 *
 * Returns up to `limit` chunks ordered by relevance (most relevant first).
 * Returns an empty array if no results are found or if the query is empty.
 */
export function searchMemory(
  memoryDb: Database.Database,
  query: string,
  limit = DEFAULT_MAX_RESULTS,
): MemorySearchResult[] {
  if (!query.trim()) return [];

  try {
    const rows = memoryDb
      .prepare(
        `SELECT source, chunk, rank
         FROM memory_chunks
         WHERE memory_chunks MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(query, limit) as Array<{ source: string; chunk: string; rank: number }>;

    return rows;
  } catch {
    // FTS5 query syntax error or other issue — return empty results
    return [];
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Split text into overlapping chunks of approximately `size` characters.
 * Tries to split on paragraph boundaries (\n\n) when possible.
 */
function chunkText(text: string, size: number, overlap: number): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);

  let current = "";

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    if (current.length + trimmed.length + 2 <= size) {
      current = current ? `${current}\n\n${trimmed}` : trimmed;
    } else {
      if (current) {
        chunks.push(current);
        // Keep overlap: last `overlap` chars of current as start of next chunk
        current = current.length > overlap ? current.slice(-overlap) + "\n\n" + trimmed : trimmed;
      } else {
        // Single paragraph larger than chunk size — split by characters
        let start = 0;
        while (start < trimmed.length) {
          chunks.push(trimmed.slice(start, start + size));
          start += size - overlap;
        }
        current = "";
      }
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks.filter((c) => c.trim().length > 0);
}
