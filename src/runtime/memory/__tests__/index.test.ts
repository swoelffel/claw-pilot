// src/runtime/memory/__tests__/index.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:fs");
import * as fs from "node:fs";
import Database from "better-sqlite3";

import { rebuildMemoryIndex, searchMemory } from "../index.js";
import type { MemorySearchResult } from "../index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create an in-memory FTS5 database matching the schema from openMemoryIndex */
function createTestMemoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks USING fts5(
      source UNINDEXED,
      chunk,
      tokenize = "unicode61"
    );
  `);
  return db;
}

// ---------------------------------------------------------------------------
// openMemoryIndex (FTS5 table creation)
// ---------------------------------------------------------------------------

describe("FTS5 memory_chunks table", () => {
  it("creates FTS5 table in new DB", () => {
    const db = createTestMemoryDb();
    // Table should exist — inserting should work
    db.prepare("INSERT INTO memory_chunks (source, chunk) VALUES (?, ?)").run("test", "hello");
    const row = db.prepare("SELECT * FROM memory_chunks").get() as {
      source: string;
      chunk: string;
    };
    expect(row.source).toBe("test");
    expect(row.chunk).toBe("hello");
    db.close();
  });

  it("can create FTS5 table twice without error (IF NOT EXISTS)", () => {
    const db = new Database(":memory:");
    const sql = `CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks USING fts5(
      source UNINDEXED, chunk, tokenize = "unicode61"
    )`;
    db.exec(sql);
    db.exec(sql); // Second time should not throw
    db.close();
  });
});

// ---------------------------------------------------------------------------
// rebuildMemoryIndex
// ---------------------------------------------------------------------------

describe("rebuildMemoryIndex", () => {
  let db: Database.Database;

  beforeEach(() => {
    vi.resetAllMocks();
    db = createTestMemoryDb();
  });

  afterEach(() => {
    db.close();
  });

  it("does nothing when workspace dir doesn't exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    rebuildMemoryIndex(db, "/work", "agent-1");
    const count = (db.prepare("SELECT count(*) as c FROM memory_chunks").get() as { c: number }).c;
    expect(count).toBe(0);
  });

  it("indexes MEMORY.md file", () => {
    // existsSync: wsDir true, MEMORY.md true, memoryDir false
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith("agent-1")) return true; // wsDir
      if (s.endsWith("MEMORY.md")) return true;
      return false; // memoryDir
    });
    vi.mocked(fs.readFileSync).mockReturnValue("The project uses TypeScript and ESM modules.");

    rebuildMemoryIndex(db, "/work", "agent-1");

    const count = (db.prepare("SELECT count(*) as c FROM memory_chunks").get() as { c: number }).c;
    expect(count).toBeGreaterThan(0);

    const row = db.prepare("SELECT source, chunk FROM memory_chunks LIMIT 1").get() as {
      source: string;
      chunk: string;
    };
    expect(row.source).toBe("MEMORY.md");
    expect(row.chunk).toContain("TypeScript");
  });

  it("indexes memory/*.md files", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(fs.readdirSync).mockReturnValue(["facts.md"] as any);
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith("MEMORY.md")) return "Main memory content for testing purposes.";
      if (s.endsWith("facts.md")) return "SQLite is the database engine used in the project.";
      return "";
    });

    rebuildMemoryIndex(db, "/work", "agent-1");

    const rows = db.prepare("SELECT source FROM memory_chunks").all() as Array<{ source: string }>;
    const sources = rows.map((r) => r.source);
    expect(sources).toContain("MEMORY.md");
    expect(sources).toContain("memory/facts.md");
  });

  it("strips decay scores before indexing", () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith("agent-1")) return true;
      if (s.endsWith("MEMORY.md")) return true;
      return false;
    });
    vi.mocked(fs.readFileSync).mockReturnValue("- [0.8] The project uses pnpm as package manager");

    rebuildMemoryIndex(db, "/work", "agent-1");

    const row = db.prepare("SELECT chunk FROM memory_chunks LIMIT 1").get() as { chunk: string };
    // Score prefix [0.8] should be stripped
    expect(row.chunk).not.toContain("[0.8]");
    expect(row.chunk).toContain("The project uses pnpm");
  });

  it("full rebuild deletes old chunks first", () => {
    // Insert some pre-existing data
    db.prepare("INSERT INTO memory_chunks (source, chunk) VALUES (?, ?)").run("old.md", "Old data");

    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith("agent-1")) return true;
      if (s.endsWith("MEMORY.md")) return true;
      return false;
    });
    vi.mocked(fs.readFileSync).mockReturnValue("Fresh content after rebuild of the memory index.");

    rebuildMemoryIndex(db, "/work", "agent-1");

    const rows = db.prepare("SELECT source FROM memory_chunks").all() as Array<{ source: string }>;
    const sources = rows.map((r) => r.source);
    expect(sources).not.toContain("old.md");
    expect(sources).toContain("MEMORY.md");
  });
});

// ---------------------------------------------------------------------------
// searchMemory
// ---------------------------------------------------------------------------

describe("searchMemory", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestMemoryDb();
  });

  afterEach(() => {
    db.close();
  });

  it("returns empty for empty query", () => {
    const results = searchMemory(db, "");
    expect(results).toEqual([]);
    const results2 = searchMemory(db, "   ");
    expect(results2).toEqual([]);
  });

  it("finds matching chunks", () => {
    db.prepare("INSERT INTO memory_chunks (source, chunk) VALUES (?, ?)").run(
      "facts.md",
      "The project uses TypeScript with strict mode enabled",
    );
    db.prepare("INSERT INTO memory_chunks (source, chunk) VALUES (?, ?)").run(
      "decisions.md",
      "We decided to use SQLite for the database layer",
    );

    const results: MemorySearchResult[] = searchMemory(db, "TypeScript");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.chunk).toContain("TypeScript");
    expect(results[0]!.source).toBe("facts.md");
  });

  it("returns empty for no match", () => {
    db.prepare("INSERT INTO memory_chunks (source, chunk) VALUES (?, ?)").run(
      "facts.md",
      "The project uses TypeScript",
    );

    const results = searchMemory(db, "kubernetes");
    expect(results).toEqual([]);
  });
});
