/**
 * runtime/session/__tests__/message-builder.test.ts
 *
 * Unit tests for message-builder functions: loadPartsBatch, applyToolOutputPruning, applyCaching.
 * buildCoreMessages is already covered by prompt-loop.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import type { ModelMessage } from "ai";
import { initDatabase } from "../../../db/schema.js";
import { loadPartsBatch, applyToolOutputPruning, applyCaching } from "../message-builder.js";
import { createSession } from "../session.js";
import { createUserMessage, createAssistantMessage } from "../message.js";
import { createPart } from "../part.js";

// ---------------------------------------------------------------------------
// DB setup for loadPartsBatch tests
// ---------------------------------------------------------------------------

let db: Database.Database;
const SLUG = "test-inst";

function seedInstance(): void {
  db.prepare(
    "INSERT OR IGNORE INTO servers (hostname, openclaw_home) VALUES ('localhost', '/opt/test')",
  ).run();
  const server = db.prepare("SELECT id FROM servers LIMIT 1").get() as { id: number };
  db.prepare(
    `INSERT OR IGNORE INTO instances (server_id, slug, port, config_path, state_dir, systemd_unit)
     VALUES (?, ?, 18789, '/tmp/rt.json', '/tmp/state', 'test.service')`,
  ).run(server.id, SLUG);
}

beforeEach(() => {
  db = initDatabase(":memory:");
  seedInstance();
});

afterEach(() => {
  db.close();
});

// ---------------------------------------------------------------------------
// loadPartsBatch
// ---------------------------------------------------------------------------

describe("loadPartsBatch", () => {
  it("returns empty map for empty input", () => {
    const result = loadPartsBatch(db, []);
    expect(result.size).toBe(0);
  });

  it("returns parts grouped by message ID", () => {
    const session = createSession(db, { instanceSlug: SLUG, agentId: "a1" });
    const userMsg = createUserMessage(db, { sessionId: session.id, text: "hello" });
    const assistantMsg = createAssistantMessage(db, {
      sessionId: session.id,
      agentId: "a1",
      model: "anthropic/claude-sonnet-4-6",
    });
    createPart(db, { messageId: assistantMsg.id, type: "text", content: "reply" });

    const result = loadPartsBatch(db, [userMsg.id, assistantMsg.id]);
    expect(result.size).toBe(2);

    const userParts = result.get(userMsg.id)!;
    expect(userParts.length).toBeGreaterThan(0); // createUserMessage creates a text part

    const assistantParts = result.get(assistantMsg.id)!;
    expect(assistantParts).toHaveLength(1);
    expect(assistantParts[0]!.content).toBe("reply");
  });

  it("returns empty arrays for messages with no parts", () => {
    const session = createSession(db, { instanceSlug: SLUG, agentId: "a1" });
    const msg = createAssistantMessage(db, {
      sessionId: session.id,
      agentId: "a1",
      model: "anthropic/claude-sonnet-4-6",
    });
    const result = loadPartsBatch(db, [msg.id]);
    expect(result.get(msg.id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// applyToolOutputPruning
// ---------------------------------------------------------------------------

describe("applyToolOutputPruning", () => {
  function makeToolMessage(outputSize: number): ModelMessage {
    return {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "tc-1",
          toolName: "bash",
          output: { type: "text", value: "x".repeat(outputSize) },
        },
      ],
    } as ModelMessage;
  }

  it("returns messages unchanged when under 20k chars", () => {
    const msgs: ModelMessage[] = [{ role: "user", content: "hello" }, makeToolMessage(5000)];
    const result = applyToolOutputPruning(msgs);
    expect(result).toBe(msgs); // same reference — no copy
  });

  it("prunes oldest tool outputs when over 40k chars (PRUNE_PROTECT_CHARS)", () => {
    const msgs: ModelMessage[] = [
      makeToolMessage(25_000), // oldest — will be pruned first
      makeToolMessage(25_000), // newer
    ];
    const result = applyToolOutputPruning(msgs);

    // First tool result should be pruned (total 50k > 40k protect threshold)
    const first = (result[0] as any).content[0];
    expect(first.output.value).toBe("[output pruned]");

    // Second should be preserved (remaining 25k <= 40k after pruning first)
    const second = (result[1] as any).content[0];
    expect(second.output.value).toHaveLength(25_000);
  });

  it("does not modify non-tool messages", () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: "a long user message" },
      makeToolMessage(25_000),
    ];
    const result = applyToolOutputPruning(msgs);
    expect(result[0]).toEqual({ role: "user", content: "a long user message" });
  });

  it("stops pruning when remaining drops below 40k chars", () => {
    const msgs: ModelMessage[] = [
      makeToolMessage(20_000), // oldest — will be pruned
      makeToolMessage(20_000), // middle — preserved (remaining 40k <= 40k after first pruned)
      makeToolMessage(20_000), // newest — preserved
    ];
    // Total 60k > 20k minimum — pruning starts
    const result = applyToolOutputPruning(msgs);

    // After pruning first (remaining = 40k), 40k <= 40k so stop
    const first = (result[0] as any).content[0];
    expect(first.output.value).toBe("[output pruned]");

    // Others preserved
    const second = (result[1] as any).content[0];
    expect(second.output.value).toHaveLength(20_000);
    const third = (result[2] as any).content[0];
    expect(third.output.value).toHaveLength(20_000);
  });
});

// ---------------------------------------------------------------------------
// applyCaching
// ---------------------------------------------------------------------------

describe("applyCaching", () => {
  const sysPrompt = "You are an assistant.";

  it("non-Anthropic provider: returns inputs unchanged", () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];
    const result = applyCaching(sysPrompt, msgs, "openai");
    expect(result.system).toBe(sysPrompt);
    expect(result.messages).toBe(msgs); // same reference
    expect(result.systemProviderOptions).toBeUndefined();
  });

  it("Anthropic: returns systemProviderOptions with cacheControl", () => {
    const msgs: ModelMessage[] = [{ role: "user", content: "hello" }];
    const result = applyCaching(sysPrompt, msgs, "anthropic");
    expect(result.systemProviderOptions).toEqual({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
  });

  it("Anthropic: adds cacheControl to last 2 non-system messages", () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: "first" },
      { role: "assistant", content: "second" },
      { role: "user", content: "third" },
    ];
    const result = applyCaching(sysPrompt, msgs, "anthropic");

    // msg[0] (user "first") — NOT cached (not in last 2)
    expect(result.messages[0]).toEqual({ role: "user", content: "first" });

    // msg[1] (assistant "second") — cached (2nd-to-last non-system)
    const cached1 = result.messages[1] as any;
    expect(Array.isArray(cached1.content)).toBe(true);
    expect(cached1.content[0].providerOptions.anthropic.cacheControl.type).toBe("ephemeral");

    // msg[2] (user "third") — cached (last non-system)
    const cached2 = result.messages[2] as any;
    expect(Array.isArray(cached2.content)).toBe(true);
    expect(cached2.content[0].providerOptions.anthropic.cacheControl.type).toBe("ephemeral");
  });

  it("Anthropic: string content is converted to text array with provider options", () => {
    const msgs: ModelMessage[] = [{ role: "user", content: "hello" }];
    const result = applyCaching(sysPrompt, msgs, "anthropic");
    const msg = result.messages[0] as any;
    expect(msg.content).toEqual([
      {
        type: "text",
        text: "hello",
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
      },
    ]);
  });

  it("Anthropic: array content has last part annotated", () => {
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "part1" },
          { type: "text", text: "part2" },
        ],
      } as ModelMessage,
    ];
    const result = applyCaching(sysPrompt, msgs, "anthropic");
    const content = (result.messages[0] as any).content;
    // First part unchanged
    expect(content[0].providerOptions).toBeUndefined();
    // Last part has cacheControl
    expect(content[1].providerOptions.anthropic.cacheControl.type).toBe("ephemeral");
  });

  it("Anthropic: single message gets cacheControl", () => {
    const msgs: ModelMessage[] = [{ role: "user", content: "only one" }];
    const result = applyCaching(sysPrompt, msgs, "anthropic");
    const msg = result.messages[0] as any;
    expect(msg.content[0].providerOptions).toBeDefined();
  });
});
