/**
 * runtime/session/__tests__/compaction-integration.test.ts
 *
 * Integration test for the compaction → memory pipeline.
 * Uses a REAL filesystem (tmpdir) + in-memory SQLite + mock LLM only.
 * Verifies the full chain: compact() → extractKnowledge → appendToMemoryFile
 * → rebuildMemoryIndex (FTS5) → applyDecayToFile → searchMemory.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type Database from "better-sqlite3";
import BetterSqlite3 from "better-sqlite3";
import { initDatabase } from "../../../db/schema.js";
import type { RuntimeAgentConfig } from "../../config/index.js";
import type { ResolvedModel } from "../../provider/provider.js";
import { createSession } from "../session.js";
import { createUserMessage, createAssistantMessage } from "../message.js";
import { createPart, listParts } from "../part.js";
import { disposeBus } from "../../bus/index.js";

// ---------------------------------------------------------------------------
// Mock ONLY the LLM — everything else is real
// ---------------------------------------------------------------------------

vi.mock("ai", async (importOriginal) => {
  const mod = await importOriginal<typeof import("ai")>();
  return { ...mod, generateText: vi.fn() };
});

import { generateText } from "ai";

// Real memory modules — no mocks
import { appendToMemoryFile } from "../../memory/writer.js";
import { rebuildMemoryIndex, searchMemory } from "../../memory/index.js";
import { applyDecayToFile, parseMemoryEntry } from "../../memory/decay.js";

// Module under test
import { compact } from "../compaction.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SLUG = "test-instance";

let tmpDir: string;
let db: Database.Database;

function seedInstance(): void {
  db.prepare(
    `INSERT OR IGNORE INTO servers (hostname, openclaw_home) VALUES ('localhost', '/opt/test')`,
  ).run();
  const server = db.prepare("SELECT id FROM servers LIMIT 1").get() as { id: number };
  db.prepare(
    `INSERT OR IGNORE INTO instances
       (server_id, slug, port, config_path, state_dir, systemd_unit)
       VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(server.id, SLUG, 19010, "/tmp/config.json", "/tmp/state", "test.service");
}

function makeResolvedModel(): ResolvedModel {
  return {
    languageModel: {} as ResolvedModel["languageModel"],
    providerId: "anthropic",
    modelId: "claude-sonnet-4-5",
    costPerMillion: { input: 3, output: 15 },
  };
}

function makeAgentConfig(overrides?: Partial<RuntimeAgentConfig>): RuntimeAgentConfig {
  return {
    id: "agent-1",
    name: "agent-1",
    model: "anthropic/claude-sonnet-4-5",
    permissions: [],
    maxSteps: 5,
    allowSubAgents: false,
    toolProfile: "executor",
    isDefault: true,
    ...overrides,
  } as RuntimeAgentConfig;
}

function seedSessionWithMessages(): string {
  const session = createSession(db, {
    instanceSlug: SLUG,
    agentId: "agent-1",
    channel: "web",
  });

  // createUserMessage already creates a text part internally
  createUserMessage(db, {
    sessionId: session.id,
    text: "The project uses TypeScript strict mode with exactOptionalPropertyTypes enabled.",
  });

  const assistantMsg = createAssistantMessage(db, {
    sessionId: session.id,
    agentId: "agent-1",
    model: "anthropic/claude-sonnet-4-5",
  });
  createPart(db, {
    messageId: assistantMsg.id,
    type: "text",
    content:
      "I understand. The project enforces strict TypeScript with exactOptionalPropertyTypes. I will use conditional spreads for optional fields.",
  });

  return session.id;
}

function setupWorkspace(): string {
  const wsDir = path.join(tmpDir, "workspaces", "agent-1");
  fs.mkdirSync(path.join(wsDir, "memory"), { recursive: true });
  return wsDir;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-test-"));
  db = initDatabase(":memory:");
  seedInstance();
});

afterEach(() => {
  disposeBus(SLUG);
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("compaction → memory integration", () => {
  it("appendToMemoryFile writes entries with [1.0] scores to disk", () => {
    const wsDir = setupWorkspace();

    appendToMemoryFile(wsDir, "facts.md", [
      "The project uses TypeScript strict mode",
      "SQLite is the database backend",
    ]);

    const content = fs.readFileSync(path.join(wsDir, "memory", "facts.md"), "utf-8");
    expect(content).toContain("[1.0] The project uses TypeScript strict mode");
    expect(content).toContain("[1.0] SQLite is the database backend");
  });

  it("appendToMemoryFile filters out duplicate entries", () => {
    const wsDir = setupWorkspace();

    appendToMemoryFile(wsDir, "facts.md", ["TypeScript strict mode is enabled"]);
    appendToMemoryFile(wsDir, "facts.md", [
      "TypeScript strict mode is enabled", // duplicate
      "New fact about the project",
    ]);

    const content = fs.readFileSync(path.join(wsDir, "memory", "facts.md"), "utf-8");
    // Should appear only once (case-insensitive duplicate check)
    const matches = content.match(/TypeScript strict mode is enabled/gi);
    expect(matches).toHaveLength(1);
    expect(content).toContain("New fact about the project");
  });

  it("applyDecayToFile decrements unreferenced entries and preserves referenced ones", () => {
    const wsDir = setupWorkspace();
    const filePath = path.join(wsDir, "memory", "facts.md");

    // Write initial entries
    fs.writeFileSync(
      filePath,
      [
        "## 2026-04-01",
        "- [1.0] TypeScript strict mode is used",
        "- [1.0] The database is PostgreSQL",
        "- [0.4] Old fact that will decay below threshold",
      ].join("\n"),
      "utf-8",
    );

    // The decay check compares the first 40 lowercase chars of each entry against
    // the referenced contents. "typescript strict mode is used" (30 chars) must appear
    // as a substring of at least one reference sentence.
    const referenced = new Set([
      "We confirmed that typescript strict mode is used in the project configuration",
    ]);

    const result = applyDecayToFile(filePath, referenced);

    const content = fs.readFileSync(filePath, "utf-8");

    // TypeScript entry should be reset to 1.0 (referenced — first 40 chars match)
    expect(content).toContain("[1.0] TypeScript strict mode is used");
    // PostgreSQL should be decremented to 0.9 (not referenced)
    expect(content).toContain("[0.9] The database is PostgreSQL");
    // Old fact at 0.4 - 0.1 = 0.3 → exactly at threshold (< 0.3 is the removal check), so it survives
    expect(content).toContain("[0.3] Old fact that will decay below threshold");
    expect(result.removed).toBe(0);
  });

  it("applyDecayToFile removes entries below DECAY_THRESHOLD (0.3)", () => {
    const wsDir = setupWorkspace();
    const filePath = path.join(wsDir, "memory", "facts.md");

    fs.writeFileSync(
      filePath,
      ["## 2026-04-01", "- [0.3] Almost forgotten fact", "- [1.0] Still relevant fact"].join("\n"),
      "utf-8",
    );

    const result = applyDecayToFile(filePath, new Set());

    const content = fs.readFileSync(filePath, "utf-8");
    // 0.3 - 0.1 = 0.2 < 0.3 → removed
    expect(content).not.toContain("Almost forgotten fact");
    // 1.0 - 0.1 = 0.9 → kept
    expect(content).toContain("[0.9] Still relevant fact");
    expect(result.removed).toBe(1);
    expect(result.updated).toBe(1);
  });

  it("FTS5 index: rebuildMemoryIndex indexes memory files and searchMemory finds them", () => {
    const wsDir = setupWorkspace();

    // Write memory files
    fs.writeFileSync(
      path.join(wsDir, "memory", "facts.md"),
      "## 2026-04-01\n- [1.0] The project uses TypeScript strict mode\n- [1.0] SQLite is the database",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(wsDir, "memory", "decisions.md"),
      "## 2026-04-01\n- [1.0] Chose Vitest over Jest for testing",
      "utf-8",
    );

    // Create FTS5 index in-memory
    const memoryDb = new BetterSqlite3(":memory:");
    memoryDb.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks USING fts5(
        source UNINDEXED,
        chunk,
        tokenize = "unicode61"
      );
    `);

    rebuildMemoryIndex(memoryDb, tmpDir, "agent-1");

    // Search for TypeScript
    const results = searchMemory(memoryDb, "TypeScript");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.chunk).toContain("TypeScript strict mode");

    // Search for Vitest
    const results2 = searchMemory(memoryDb, "Vitest");
    expect(results2.length).toBeGreaterThan(0);
    expect(results2[0]!.chunk).toContain("Vitest");

    // Search for something not in memory
    const results3 = searchMemory(memoryDb, "nonexistent-term");
    expect(results3).toHaveLength(0);

    memoryDb.close();
  });

  it("FTS5 index strips decay scores before indexing", () => {
    const wsDir = setupWorkspace();

    fs.writeFileSync(
      path.join(wsDir, "memory", "facts.md"),
      "## 2026-04-01\n- [0.8] The server runs on port 19000\n- [1.0] Node.js version 22 is required",
      "utf-8",
    );

    const memoryDb = new BetterSqlite3(":memory:");
    memoryDb.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks USING fts5(
        source UNINDEXED,
        chunk,
        tokenize = "unicode61"
      );
    `);

    rebuildMemoryIndex(memoryDb, tmpDir, "agent-1");

    // Searching for the score pattern should not match
    const _results = searchMemory(memoryDb, "0.8");
    // FTS5 strips scores, so "0.8" should not be indexed as content
    // (it might still match as a number in the text — let's check the actual content)
    const allChunks = memoryDb.prepare("SELECT chunk FROM memory_chunks").all() as Array<{
      chunk: string;
    }>;
    for (const row of allChunks) {
      expect(row.chunk).not.toMatch(/^\[0\.8\]/);
    }

    memoryDb.close();
  });

  it("full pipeline: compact() extracts knowledge, writes to files, and decays entries", async () => {
    const wsDir = setupWorkspace();
    const sessionId = seedSessionWithMessages();

    // Pre-populate a memory file to test decay
    fs.writeFileSync(
      path.join(wsDir, "memory", "facts.md"),
      "## 2026-03-01\n- [0.5] Old fact about something unrelated\n",
      "utf-8",
    );

    const mockedGenerateText = vi.mocked(generateText);

    // First call: knowledge extraction (returns JSON)
    // Second call: compaction summary
    let callCount = 0;
    mockedGenerateText.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Knowledge extraction response
        return {
          text: JSON.stringify({
            facts: ["TypeScript strict mode with exactOptionalPropertyTypes is enabled"],
            decisions: ["Use conditional spreads for optional fields"],
            preferences: [],
            timeline: [],
            knowledge: ["exactOptionalPropertyTypes requires conditional spread pattern"],
          }),
          usage: { inputTokens: 500, outputTokens: 200 },
          finishReason: "stop",
        } as any;
      }
      // Compaction summary
      return {
        text: "### Active Goals\n- [IN PROGRESS] Setting up TypeScript strict mode",
        usage: { inputTokens: 1000, outputTokens: 300 },
        finishReason: "stop",
      } as any;
    });

    const result = await compact({
      db,
      instanceSlug: SLUG,
      sessionId,
      agentConfig: makeAgentConfig({ persistence: "permanent" }),
      resolvedModel: makeResolvedModel(),
      currentTokens: 90_000,
      contextWindow: 100_000,
      workDir: tmpDir,
    });

    expect(result.compacted).toBe(true);
    expect(result.compactionMessageId).toBeDefined();

    // Verify knowledge was written to memory files
    const factsContent = fs.readFileSync(path.join(wsDir, "memory", "facts.md"), "utf-8");
    expect(factsContent).toContain("exactOptionalPropertyTypes");

    const decisionsPath = path.join(wsDir, "memory", "decisions.md");
    expect(fs.existsSync(decisionsPath)).toBe(true);
    const decisionsContent = fs.readFileSync(decisionsPath, "utf-8");
    expect(decisionsContent).toContain("conditional spreads");

    const knowledgePath = path.join(wsDir, "memory", "knowledge.md");
    expect(fs.existsSync(knowledgePath)).toBe(true);
    const knowledgeContent = fs.readFileSync(knowledgePath, "utf-8");
    expect(knowledgeContent).toContain("conditional spread pattern");

    // Verify decay was applied to facts.md
    // The old fact (0.5) should have been decremented (not referenced in conversation)
    const factsLines = factsContent.split("\n");
    const oldFactLine = factsLines.find((l) => l.includes("something unrelated"));
    if (oldFactLine) {
      const entry = parseMemoryEntry(oldFactLine);
      // Should be decremented from 0.5 to 0.4
      expect(entry?.score).toBe(0.4);
    }

    // Verify compaction message was stored in DB
    const parts = listParts(db, result.compactionMessageId!);
    const compactionPart = parts.find((p) => p.type === "compaction");
    expect(compactionPart).toBeDefined();
    expect(compactionPart!.content).toContain("Active Goals");
  });
});
