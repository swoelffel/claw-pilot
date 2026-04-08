/**
 * runtime/session/__tests__/compaction.test.ts
 *
 * Unit tests for the compaction module:
 *   - shouldCompact() — pure threshold check
 *   - compact() — async compaction with knowledge extraction
 *   - getCompactionSummary() — reads most recent compaction part
 *
 * Uses in-memory SQLite via initDatabase(":memory:").
 * Mocks: ai (generateText), node:fs, memory/writer, memory/index, memory/decay.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { initDatabase } from "../../../db/schema.js";
import type { RuntimeAgentConfig } from "../../config/index.js";
import type { ResolvedModel } from "../../provider/provider.js";
import { createSession } from "../session.js";
import { createUserMessage, createAssistantMessage } from "../message.js";
import { createPart, listParts } from "../part.js";
import { getBus, disposeBus } from "../../bus/index.js";

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports of the module under test
// ---------------------------------------------------------------------------

vi.mock("node:fs", async (importOriginal) => {
  const mod = await importOriginal<typeof import("node:fs")>();
  return {
    ...mod,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => ""),
  };
});

vi.mock("ai", async (importOriginal) => {
  const mod = await importOriginal<typeof import("ai")>();
  return { ...mod, generateText: vi.fn() };
});

vi.mock("../../memory/writer.js", () => ({
  appendToMemoryFile: vi.fn(),
  consolidateMemoryFileIfNeeded: vi.fn().mockResolvedValue(false),
}));

vi.mock("../../memory/index.js", () => ({
  openMemoryIndex: vi.fn(() => ({ close: vi.fn() })),
  rebuildMemoryIndex: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../memory/decay.js", () => ({
  applyDecayToFile: vi.fn(() => ({ updated: 0, removed: 0 })),
  extractReferencedContents: vi.fn(() => new Set()),
}));

// Import the mocked modules to spy on them
import { generateText } from "ai";
import * as fs from "node:fs";
import { appendToMemoryFile } from "../../memory/writer.js";

// Module under test — imported AFTER mocks are set up
import { shouldCompact, compact, getCompactionSummary } from "../compaction.js";
import type { CompactionInput } from "../compaction.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedInstance(db: Database.Database, slug: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO servers (hostname, openclaw_home) VALUES ('localhost', '/opt/openclaw')`,
  ).run();
  const server = db.prepare("SELECT id FROM servers LIMIT 1").get() as { id: number };
  db.prepare(
    `INSERT OR IGNORE INTO instances
       (server_id, slug, port, config_path, state_dir, systemd_unit)
       VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(server.id, slug, 19010, "/tmp/config.json", "/tmp/state", "test.service");
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
    id: "main",
    name: "main",
    model: "anthropic/claude-sonnet-4-5",
    permissions: [],
    maxSteps: 5,
    allowSubAgents: false,
    toolProfile: "executor",
    isDefault: true,
    ...overrides,
  } as RuntimeAgentConfig;
}

const SLUG = "test-instance";

function makeCompactionInput(
  db: Database.Database,
  sessionId: string,
  overrides?: Partial<CompactionInput>,
): CompactionInput {
  return {
    db,
    instanceSlug: SLUG,
    sessionId,
    agentConfig: makeAgentConfig(),
    resolvedModel: makeResolvedModel(),
    currentTokens: 80_000,
    contextWindow: 100_000,
    ...overrides,
  };
}

/** Create a session and seed it with one user + one assistant message with text parts. */
function seedSessionWithMessages(db: Database.Database): string {
  const session = createSession(db, {
    instanceSlug: SLUG,
    agentId: "main",
    channel: "web",
  });

  const _userMsg = createUserMessage(db, {
    sessionId: session.id,
    text: "Hello, can you help me?",
  });

  const assistantMsg = createAssistantMessage(db, {
    sessionId: session.id,
    agentId: "main",
    model: "anthropic/claude-sonnet-4-5",
  });
  createPart(db, {
    messageId: assistantMsg.id,
    type: "text",
    content: "Sure, I can help you with that.",
  });

  return session.id;
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let db: Database.Database;

beforeEach(() => {
  vi.clearAllMocks();
  db = initDatabase(":memory:");
  seedInstance(db, SLUG);

  // Default generateText mock — returns a summary.
  // The mock uses plain numbers for inputTokens/outputTokens and a string for finishReason
  // because compact() passes these values directly to updateMessageMetadata() which writes
  // them to SQLite (which only accepts primitives).
  vi.mocked(generateText).mockResolvedValue({
    text: "### Active Goals\n- [IN PROGRESS] Help user\n\n### Key Constraints\n- (none)\n\n### Current State\n- Greeted user\n\n### Open Items\n- (none)\n\n### Working Context\n- (none)",
    usage: { inputTokens: 100, outputTokens: 50 },
    finishReason: "stop",
  } as unknown as Awaited<ReturnType<typeof generateText>>);
});

afterEach(() => {
  disposeBus(SLUG);
  db.close();
});

// ===========================================================================
// shouldCompact()
// ===========================================================================

describe("shouldCompact()", () => {
  it("returns false when contextWindow <= 0", () => {
    expect(shouldCompact({ currentTokens: 1000, contextWindow: 0 })).toBe(false);
    expect(shouldCompact({ currentTokens: 1000, contextWindow: -1 })).toBe(false);
  });

  it("returns false when currentTokens is below threshold", () => {
    // usable = 100000 - 8000 = 92000, threshold = 92000 * 0.85 = 78200
    expect(shouldCompact({ currentTokens: 50_000, contextWindow: 100_000 })).toBe(false);
  });

  it("returns true when currentTokens is at threshold", () => {
    // usable = 100000 - 8000 = 92000, threshold = 92000 * 0.85 = 78200
    expect(shouldCompact({ currentTokens: 78_200, contextWindow: 100_000 })).toBe(true);
  });

  it("returns true when currentTokens is above threshold", () => {
    expect(shouldCompact({ currentTokens: 90_000, contextWindow: 100_000 })).toBe(true);
  });

  it("respects custom threshold parameter", () => {
    // usable = 100000 - 8000 = 92000, custom threshold 0.50 => 46000
    expect(shouldCompact({ currentTokens: 45_000, contextWindow: 100_000, threshold: 0.5 })).toBe(
      false,
    );
    expect(shouldCompact({ currentTokens: 46_000, contextWindow: 100_000, threshold: 0.5 })).toBe(
      true,
    );
  });

  it("respects custom reservedTokens parameter", () => {
    // usable = 100000 - 0 = 100000, threshold = 100000 * 0.85 = 85000
    expect(
      shouldCompact({ currentTokens: 84_999, contextWindow: 100_000, reservedTokens: 0 }),
    ).toBe(false);
    expect(
      shouldCompact({ currentTokens: 85_000, contextWindow: 100_000, reservedTokens: 0 }),
    ).toBe(true);
  });

  it("edge case: currentTokens exactly at boundary (one below)", () => {
    // usable = 100000 - 8000 = 92000, threshold = floor(92000 * 0.85) = 78200
    expect(shouldCompact({ currentTokens: 78_199, contextWindow: 100_000 })).toBe(false);
  });
});

// ===========================================================================
// compact()
// ===========================================================================

describe("compact()", () => {
  it("returns compacted:false when session has no messages", async () => {
    const session = createSession(db, {
      instanceSlug: SLUG,
      agentId: "main",
      channel: "web",
    });

    const result = await compact(makeCompactionInput(db, session.id));

    expect(result.compacted).toBe(false);
    expect(result.compactionMessageId).toBeUndefined();
    // generateText should NOT have been called
    expect(generateText).not.toHaveBeenCalled();
  });

  it("creates compaction message with summary text", async () => {
    const sessionId = seedSessionWithMessages(db);

    const result = await compact(makeCompactionInput(db, sessionId));

    expect(result.compacted).toBe(true);
    expect(result.compactionMessageId).toBeDefined();

    // Verify the compaction part was created
    const parts = listParts(db, result.compactionMessageId!);
    const compactionPart = parts.find((p) => p.type === "compaction");
    expect(compactionPart).toBeDefined();
    expect(compactionPart!.content).toContain("Active Goals");
  });

  it("publishes SessionStatusChanged busy then idle (even on empty)", async () => {
    const session = createSession(db, {
      instanceSlug: SLUG,
      agentId: "main",
      channel: "web",
    });

    const bus = getBus(SLUG);
    const events: Array<{ type: string; payload: unknown }> = [];
    bus.subscribeAll((event) => events.push(event));

    await compact(makeCompactionInput(db, session.id));

    const statusEvents = events.filter((e) => e.type === "session.status");
    expect(statusEvents.length).toBe(2);
    expect((statusEvents[0]!.payload as { status: string }).status).toBe("busy");
    expect((statusEvents[1]!.payload as { status: string }).status).toBe("idle");
  });

  it("stores compaction metadata (compactedMessageCount, compactedAt)", async () => {
    const sessionId = seedSessionWithMessages(db);

    const result = await compact(makeCompactionInput(db, sessionId));

    const parts = listParts(db, result.compactionMessageId!);
    const compactionPart = parts.find((p) => p.type === "compaction");
    expect(compactionPart!.metadata).toBeDefined();

    const meta = JSON.parse(compactionPart!.metadata!) as {
      compactedMessageCount: number;
      compactedAt: string;
    };
    expect(meta.compactedMessageCount).toBe(2); // 1 user + 1 assistant
    expect(meta.compactedAt).toBeTruthy();
    // Verify it parses as a valid ISO date
    expect(new Date(meta.compactedAt).getTime()).toBeGreaterThan(0);
  });

  it("calls extractKnowledge for permanent agents with workDir", async () => {
    const sessionId = seedSessionWithMessages(db);

    // Make fs.existsSync return true for the workspace dir
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("");

    // Set up generateText to return knowledge JSON on first call, summary on second
    vi.mocked(generateText)
      .mockResolvedValueOnce({
        text: '{ "facts": ["fact1"], "decisions": [], "preferences": [], "timeline": [], "knowledge": [] }',
        usage: { inputTokens: 100, outputTokens: 50 },
        finishReason: "stop",
      } as unknown as Awaited<ReturnType<typeof generateText>>)
      .mockResolvedValueOnce({
        text: "### Active Goals\n- (none)",
        usage: { inputTokens: 100, outputTokens: 50 },
        finishReason: "stop",
      } as unknown as Awaited<ReturnType<typeof generateText>>);

    const result = await compact(
      makeCompactionInput(db, sessionId, {
        workDir: "/tmp/test-workdir",
        agentConfig: makeAgentConfig({ persistence: "permanent" }),
      }),
    );

    expect(result.compacted).toBe(true);
    // generateText called twice: once for extraction, once for summary
    expect(generateText).toHaveBeenCalledTimes(2);
    // appendToMemoryFile should be called for the extracted fact
    expect(appendToMemoryFile).toHaveBeenCalled();
  });

  it("does NOT call extractKnowledge when persistence != 'permanent'", async () => {
    const sessionId = seedSessionWithMessages(db);

    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = await compact(
      makeCompactionInput(db, sessionId, {
        workDir: "/tmp/test-workdir",
        agentConfig: makeAgentConfig({ persistence: "ephemeral" }),
      }),
    );

    expect(result.compacted).toBe(true);
    // generateText called only once (summary), not for extraction
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(appendToMemoryFile).not.toHaveBeenCalled();
  });

  it("does NOT call extractKnowledge when workDir is undefined", async () => {
    const sessionId = seedSessionWithMessages(db);

    const result = await compact(
      makeCompactionInput(db, sessionId, {
        agentConfig: makeAgentConfig({ persistence: "permanent" }),
      }),
    );

    expect(result.compacted).toBe(true);
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(appendToMemoryFile).not.toHaveBeenCalled();
  });

  it("calls appendToMemoryFile for each knowledge category", async () => {
    const sessionId = seedSessionWithMessages(db);

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("");

    vi.mocked(generateText)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          facts: ["fact1"],
          decisions: ["decision1"],
          preferences: ["pref1"],
          timeline: ["2026-01-01: event"],
          knowledge: ["pattern1"],
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
        finishReason: "stop",
      } as unknown as Awaited<ReturnType<typeof generateText>>)
      .mockResolvedValueOnce({
        text: "### Active Goals\n- (none)",
        usage: { inputTokens: 100, outputTokens: 50 },
        finishReason: "stop",
      } as unknown as Awaited<ReturnType<typeof generateText>>);

    await compact(
      makeCompactionInput(db, sessionId, {
        workDir: "/tmp/test-workdir",
        agentConfig: makeAgentConfig({ persistence: "permanent" }),
      }),
    );

    // 5 calls: facts.md, decisions.md, user-prefs.md, timeline.md, knowledge.md
    expect(appendToMemoryFile).toHaveBeenCalledTimes(5);

    const calls = vi.mocked(appendToMemoryFile).mock.calls;
    // Verify each category file
    expect(calls[0]![1]).toBe("facts.md");
    expect(calls[0]![2]).toEqual(["fact1"]);
    expect(calls[1]![1]).toBe("decisions.md");
    expect(calls[1]![2]).toEqual(["decision1"]);
    expect(calls[2]![1]).toBe("user-prefs.md");
    expect(calls[2]![2]).toEqual(["pref1"]);
    expect(calls[3]![1]).toBe("timeline.md");
    expect(calls[3]![2]).toEqual(["2026-01-01: event"]);
    expect(calls[4]![1]).toBe("knowledge.md");
    expect(calls[4]![2]).toEqual(["pattern1"]);
  });

  it("publishes MessageCreated and MessageUpdated events", async () => {
    const sessionId = seedSessionWithMessages(db);

    const bus = getBus(SLUG);
    const events: Array<{ type: string; payload: unknown }> = [];
    bus.subscribeAll((event) => events.push(event));

    const result = await compact(makeCompactionInput(db, sessionId));

    const created = events.filter((e) => e.type === "message.created");
    const updated = events.filter((e) => e.type === "message.updated");

    expect(created.length).toBe(1);
    expect((created[0]!.payload as { messageId: string }).messageId).toBe(
      result.compactionMessageId,
    );
    expect((created[0]!.payload as { role: string }).role).toBe("assistant");

    expect(updated.length).toBe(1);
    expect((updated[0]!.payload as { messageId: string }).messageId).toBe(
      result.compactionMessageId,
    );
  });

  it("calls markDirty with 'compaction' reason", async () => {
    // We spy on markDirty via its module
    const dirtyModule = await import("../system-prompt-dirty.js");
    const markDirtySpy = vi.spyOn(dirtyModule, "markDirty");

    const sessionId = seedSessionWithMessages(db);

    await compact(makeCompactionInput(db, sessionId));

    expect(markDirtySpy).toHaveBeenCalledWith(sessionId, "compaction");
    markDirtySpy.mockRestore();
  });

  it("updates message metadata with token usage", async () => {
    const sessionId = seedSessionWithMessages(db);

    vi.mocked(generateText).mockResolvedValueOnce({
      text: "Summary text",
      usage: { inputTokens: 250, outputTokens: 75 },
      finishReason: "stop",
    } as unknown as Awaited<ReturnType<typeof generateText>>);

    const result = await compact(makeCompactionInput(db, sessionId));

    // Read the message back from DB
    const row = db
      .prepare("SELECT tokens_in, tokens_out, finish_reason FROM rt_messages WHERE id = ?")
      .get(result.compactionMessageId!) as {
      tokens_in: number | null;
      tokens_out: number | null;
      finish_reason: string | null;
    };

    expect(row.tokens_in).toBe(250);
    expect(row.tokens_out).toBe(75);
  });
});

// ===========================================================================
// getCompactionSummary()
// ===========================================================================

describe("getCompactionSummary()", () => {
  it("returns undefined for session with no messages", () => {
    const session = createSession(db, {
      instanceSlug: SLUG,
      agentId: "main",
      channel: "web",
    });

    expect(getCompactionSummary(db, session.id)).toBeUndefined();
  });

  it("returns undefined when no compaction parts exist", () => {
    const sessionId = seedSessionWithMessages(db);

    expect(getCompactionSummary(db, sessionId)).toBeUndefined();
  });

  it("returns the compaction content when present", () => {
    const session = createSession(db, {
      instanceSlug: SLUG,
      agentId: "main",
      channel: "web",
    });

    // Create a message with a compaction part
    const msg = createAssistantMessage(db, {
      sessionId: session.id,
      agentId: "main",
    });
    createPart(db, {
      messageId: msg.id,
      type: "compaction",
      content: "This is the compaction summary.",
    });

    const summary = getCompactionSummary(db, session.id);
    expect(summary).toBe("This is the compaction summary.");
  });

  it("returns the most recent compaction (searches backwards)", () => {
    const session = createSession(db, {
      instanceSlug: SLUG,
      agentId: "main",
      channel: "web",
    });

    // First compaction
    const msg1 = createAssistantMessage(db, {
      sessionId: session.id,
      agentId: "main",
    });
    createPart(db, {
      messageId: msg1.id,
      type: "compaction",
      content: "Old compaction summary.",
    });

    // Some normal messages in between
    createUserMessage(db, { sessionId: session.id, text: "follow-up" });

    // Second compaction (more recent)
    const msg2 = createAssistantMessage(db, {
      sessionId: session.id,
      agentId: "main",
    });
    createPart(db, {
      messageId: msg2.id,
      type: "compaction",
      content: "New compaction summary.",
    });

    const summary = getCompactionSummary(db, session.id);
    expect(summary).toBe("New compaction summary.");
  });
});

// ===========================================================================
// extractKnowledge (tested indirectly via compact())
// ===========================================================================

describe("extractKnowledge (via compact)", () => {
  /** Helper: run compact with knowledge extraction enabled. */
  async function compactWithKnowledge(llmResponse: string | Error): Promise<void> {
    const sessionId = seedSessionWithMessages(db);

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("");

    if (llmResponse instanceof Error) {
      vi.mocked(generateText)
        .mockRejectedValueOnce(llmResponse) // extraction fails
        .mockResolvedValueOnce({
          text: "Summary",
          usage: { inputTokens: 10, outputTokens: 5 },
          finishReason: "stop",
        } as unknown as Awaited<ReturnType<typeof generateText>>);
    } else {
      vi.mocked(generateText)
        .mockResolvedValueOnce({
          text: llmResponse,
          usage: { inputTokens: 10, outputTokens: 5 },
          finishReason: "stop",
        } as unknown as Awaited<ReturnType<typeof generateText>>)
        .mockResolvedValueOnce({
          text: "Summary",
          usage: { inputTokens: 10, outputTokens: 5 },
          finishReason: "stop",
        } as unknown as Awaited<ReturnType<typeof generateText>>);
    }

    await compact(
      makeCompactionInput(db, sessionId, {
        workDir: "/tmp/test-workdir",
        agentConfig: makeAgentConfig({ persistence: "permanent" }),
      }),
    );
  }

  it("returns empty arrays on LLM failure", async () => {
    await compactWithKnowledge(new Error("LLM timeout"));

    // All appendToMemoryFile calls should have empty arrays
    const calls = vi.mocked(appendToMemoryFile).mock.calls;
    expect(calls.length).toBe(5);
    for (const call of calls) {
      expect(call[2]).toEqual([]);
    }
  });

  it("parses valid JSON response", async () => {
    const json = JSON.stringify({
      facts: ["The project uses ESM"],
      decisions: ["Chose SQLite"],
      preferences: ["Prefers French"],
      timeline: ["2026-01-01: Launch"],
      knowledge: ["Pattern A"],
    });

    await compactWithKnowledge(json);

    const calls = vi.mocked(appendToMemoryFile).mock.calls;
    expect(calls[0]![2]).toEqual(["The project uses ESM"]);
    expect(calls[1]![2]).toEqual(["Chose SQLite"]);
    expect(calls[2]![2]).toEqual(["Prefers French"]);
    expect(calls[3]![2]).toEqual(["2026-01-01: Launch"]);
    expect(calls[4]![2]).toEqual(["Pattern A"]);
  });

  it("handles markdown-wrapped JSON (```json ... ```)", async () => {
    const wrapped =
      '```json\n{ "facts": ["wrapped fact"], "decisions": [], "preferences": [], "timeline": [], "knowledge": [] }\n```';

    await compactWithKnowledge(wrapped);

    const calls = vi.mocked(appendToMemoryFile).mock.calls;
    expect(calls[0]![2]).toEqual(["wrapped fact"]);
  });

  it("returns empty arrays on malformed JSON", async () => {
    await compactWithKnowledge("this is not JSON at all { broken");

    const calls = vi.mocked(appendToMemoryFile).mock.calls;
    expect(calls.length).toBe(5);
    for (const call of calls) {
      expect(call[2]).toEqual([]);
    }
  });
});
