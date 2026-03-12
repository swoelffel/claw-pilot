/**
 * runtime/session/__tests__/prompt-loop.test.ts
 *
 * Unit tests for runPromptLoop — no network calls, no TTY.
 * Uses MockLanguageModelV3 from ai/test to simulate LLM responses.
 *
 * getTools() is mocked to return an empty tool set so tests run fast
 * without loading the full built-in tool registry.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";

// Mock getTools to avoid loading heavy built-in tools in unit tests
vi.mock("../../tool/registry.js", () => ({
  getTools: vi.fn().mockResolvedValue([]),
}));
import { initDatabase } from "../../../db/schema.js";
import type Database from "better-sqlite3";
import { createSession } from "../session.js";
import { listMessages, getMessage } from "../message.js";
import { listParts } from "../part.js";
import { getBus, disposeBus } from "../../bus/index.js";
import {
  SessionStatusChanged,
  MessageCreated,
  MessageUpdated,
  MessagePartDelta,
} from "../../bus/events.js";
import { runPromptLoop } from "../prompt-loop.js";
import type { ResolvedModel } from "../../provider/provider.js";
import type { RuntimeAgentConfig } from "../../config/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INSTANCE_SLUG = "test-prompt-loop";

function seedInstance(db: Database.Database) {
  db.prepare(
    `INSERT OR IGNORE INTO servers (hostname, openclaw_home) VALUES ('localhost', '/opt/openclaw')`,
  ).run();
  const server = db.prepare("SELECT id FROM servers LIMIT 1").get() as { id: number };
  db.prepare(
    `INSERT OR IGNORE INTO instances
     (server_id, slug, port, config_path, state_dir, systemd_unit)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(server.id, INSTANCE_SLUG, 19001, "/tmp/config.json", "/tmp/state", "openclaw-test.service");
}

function makeAgentConfig(overrides?: Partial<RuntimeAgentConfig>): RuntimeAgentConfig {
  return {
    id: "main",
    name: "main",
    model: "anthropic/claude-sonnet-4-5",
    permissions: [],
    maxSteps: 5,
    allowSubAgents: false,
    toolProfile: "coding",
    isDefault: true,
    ...overrides,
  };
}

function makeResolvedModel(mockModel: MockLanguageModelV3): ResolvedModel {
  return {
    languageModel: mockModel as unknown as ResolvedModel["languageModel"],
    providerId: "anthropic",
    modelId: "claude-sonnet-4-5",
    costPerMillion: { input: 3, output: 15 },
  };
}

/**
 * Build a mock that streams a simple text response.
 * Uses AI SDK v6 chunk format: stream-start → text-start → text-delta → text-end → finish
 */
function textStreamModel(text: string, inputTokens = 10, outputTokens = 5): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "1" },
          { type: "text-delta", id: "1", delta: text },
          { type: "text-end", id: "1" },
          {
            type: "finish",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            finishReason: { unified: "stop", raw: "stop" } as any,
            usage: {
              inputTokens: {
                total: inputTokens,
                noCache: undefined,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: { total: outputTokens, text: undefined, reasoning: undefined },
            },
          },
        ],
        initialDelayInMs: 0,
        chunkDelayInMs: 0,
      }),
      rawCall: { rawPrompt: null, rawSettings: {} },
    }),
  });
}

/** Build a mock that throws an error */
function errorModel(message: string): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async () => {
      throw new Error(message);
    },
  });
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let db: Database.Database;

beforeEach(() => {
  db = initDatabase(":memory:");
  seedInstance(db);
  // Clean up any leftover bus from previous tests
  disposeBus(INSTANCE_SLUG);
});

afterEach(() => {
  db.close();
  disposeBus(INSTANCE_SLUG);
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("runPromptLoop — happy path", () => {
  it("returns the correct text from the LLM", async () => {
    const session = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "main" });
    const model = textStreamModel("Hello, world!");

    const result = await runPromptLoop({
      db,
      instanceSlug: INSTANCE_SLUG,
      sessionId: session.id,
      userText: "Say hello",
      agentConfig: makeAgentConfig(),
      resolvedModel: makeResolvedModel(model),
      workDir: undefined,
    });

    expect(result.text).toBe("Hello, world!");
  });

  it("persists user message + text part in DB", async () => {
    const session = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "main" });
    const model = textStreamModel("Hi there");

    await runPromptLoop({
      db,
      instanceSlug: INSTANCE_SLUG,
      sessionId: session.id,
      userText: "Greet me",
      agentConfig: makeAgentConfig(),
      resolvedModel: makeResolvedModel(model),
      workDir: undefined,
    });

    const messages = listMessages(db, session.id);
    // user message + assistant message
    expect(messages).toHaveLength(2);

    const userMsg = messages[0]!;
    expect(userMsg.role).toBe("user");
    const userParts = listParts(db, userMsg.id);
    expect(userParts).toHaveLength(1);
    expect(userParts[0]!.type).toBe("text");
    expect(userParts[0]!.content).toBe("Greet me");
  });

  it("persists assistant message with text part in DB", async () => {
    const session = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "main" });
    // Use 2 deltas so updatePartState("completed") is called in onChunk for the second delta
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "1" },
            { type: "text-delta", id: "1", delta: "I am " },
            { type: "text-delta", id: "1", delta: "the assistant" },
            { type: "text-end", id: "1" },
            {
              type: "finish",
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              finishReason: { unified: "stop", raw: "stop" } as any,
              usage: {
                inputTokens: {
                  total: 10,
                  noCache: undefined,
                  cacheRead: undefined,
                  cacheWrite: undefined,
                },
                outputTokens: { total: 5, text: undefined, reasoning: undefined },
              },
            },
          ],
          initialDelayInMs: 0,
          chunkDelayInMs: 0,
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      }),
    });

    const result = await runPromptLoop({
      db,
      instanceSlug: INSTANCE_SLUG,
      sessionId: session.id,
      userText: "Who are you?",
      agentConfig: makeAgentConfig(),
      resolvedModel: makeResolvedModel(model),
      workDir: undefined,
    });

    const assistantMsg = getMessage(db, result.messageId);
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.role).toBe("assistant");
    expect(assistantMsg!.agentId).toBe("main");
    expect(assistantMsg!.model).toBe("anthropic/claude-sonnet-4-5");

    const parts = listParts(db, result.messageId);
    const textPart = parts.find((p) => p.type === "text");
    expect(textPart).toBeDefined();
    expect(textPart!.content).toBe("I am the assistant");
    expect(textPart!.state).toBe("completed");
  });

  it("returns correct token counts", async () => {
    const session = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "main" });
    const model = textStreamModel("answer", 42, 7);

    const result = await runPromptLoop({
      db,
      instanceSlug: INSTANCE_SLUG,
      sessionId: session.id,
      userText: "question",
      agentConfig: makeAgentConfig(),
      resolvedModel: makeResolvedModel(model),
      workDir: undefined,
    });

    expect(result.tokens.input).toBe(42);
    expect(result.tokens.output).toBe(7);
    expect(result.tokens.cacheRead).toBe(0);
    expect(result.tokens.cacheWrite).toBe(0);
  });

  it("computes cost from costPerMillion", async () => {
    const session = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "main" });
    // 1000 input tokens @ $3/M + 1000 output tokens @ $15/M = $0.003 + $0.015 = $0.018
    const model = textStreamModel("ok", 1000, 1000);

    const result = await runPromptLoop({
      db,
      instanceSlug: INSTANCE_SLUG,
      sessionId: session.id,
      userText: "compute cost",
      agentConfig: makeAgentConfig(),
      resolvedModel: makeResolvedModel(model),
      workDir: undefined,
    });

    expect(result.costUsd).toBeCloseTo(0.018, 6);
  });

  it("updates assistant message metadata in DB after completion", async () => {
    const session = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "main" });
    const model = textStreamModel("done", 20, 10);

    const result = await runPromptLoop({
      db,
      instanceSlug: INSTANCE_SLUG,
      sessionId: session.id,
      userText: "go",
      agentConfig: makeAgentConfig(),
      resolvedModel: makeResolvedModel(model),
      workDir: undefined,
    });

    const msg = getMessage(db, result.messageId)!;
    expect(msg.tokensIn).toBe(20);
    expect(msg.tokensOut).toBe(10);
    // MockLanguageModelV3 in AI SDK v6 always resolves finishReason as "other"
    // regardless of what the mock stream emits — we just verify it is set
    expect(msg.finishReason).toBeTruthy();
    expect(msg.costUsd).toBeGreaterThan(0);
  });

  it("returns steps = 0 when no tool calls", async () => {
    const session = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "main" });
    const model = textStreamModel("no tools here");

    const result = await runPromptLoop({
      db,
      instanceSlug: INSTANCE_SLUG,
      sessionId: session.id,
      userText: "simple question",
      agentConfig: makeAgentConfig(),
      resolvedModel: makeResolvedModel(model),
      workDir: undefined,
    });

    expect(result.steps).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Bus events
// ---------------------------------------------------------------------------

describe("runPromptLoop — bus events", () => {
  it("emits SessionStatusChanged(busy) then (idle)", async () => {
    const session = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "main" });
    const model = textStreamModel("hi");
    const bus = getBus(INSTANCE_SLUG);

    const statusEvents: string[] = [];
    bus.subscribe(SessionStatusChanged, ({ status }) => statusEvents.push(status));

    await runPromptLoop({
      db,
      instanceSlug: INSTANCE_SLUG,
      sessionId: session.id,
      userText: "ping",
      agentConfig: makeAgentConfig(),
      resolvedModel: makeResolvedModel(model),
      workDir: undefined,
    });

    expect(statusEvents[0]).toBe("busy");
    expect(statusEvents[statusEvents.length - 1]).toBe("idle");
  });

  it("emits MessageCreated for user and assistant messages", async () => {
    const session = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "main" });
    const model = textStreamModel("response");
    const bus = getBus(INSTANCE_SLUG);

    const createdRoles: string[] = [];
    bus.subscribe(MessageCreated, ({ role }) => createdRoles.push(role));

    await runPromptLoop({
      db,
      instanceSlug: INSTANCE_SLUG,
      sessionId: session.id,
      userText: "hello",
      agentConfig: makeAgentConfig(),
      resolvedModel: makeResolvedModel(model),
      workDir: undefined,
    });

    expect(createdRoles).toContain("user");
    expect(createdRoles).toContain("assistant");
  });

  it("emits MessagePartDelta events during streaming", async () => {
    const session = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "main" });
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "1" },
            { type: "text-delta", id: "1", delta: "chunk1" },
            { type: "text-delta", id: "1", delta: "chunk2" },
            { type: "text-end", id: "1" },
            {
              type: "finish",
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              finishReason: { unified: "stop", raw: "stop" } as any,
              usage: {
                inputTokens: {
                  total: 5,
                  noCache: undefined,
                  cacheRead: undefined,
                  cacheWrite: undefined,
                },
                outputTokens: { total: 2, text: undefined, reasoning: undefined },
              },
            },
          ],
          initialDelayInMs: 0,
          chunkDelayInMs: 0,
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      }),
    });
    const bus = getBus(INSTANCE_SLUG);

    const deltas: string[] = [];
    bus.subscribe(MessagePartDelta, ({ delta }) => deltas.push(delta));

    await runPromptLoop({
      db,
      instanceSlug: INSTANCE_SLUG,
      sessionId: session.id,
      userText: "stream test",
      agentConfig: makeAgentConfig(),
      resolvedModel: makeResolvedModel(model),
      workDir: undefined,
    });

    expect(deltas).toContain("chunk1");
    expect(deltas).toContain("chunk2");
  });

  it("emits MessageUpdated after assistant turn completes", async () => {
    const session = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "main" });
    const model = textStreamModel("done");
    const bus = getBus(INSTANCE_SLUG);

    const updatedIds: string[] = [];
    bus.subscribe(MessageUpdated, ({ messageId }) => updatedIds.push(messageId));

    const result = await runPromptLoop({
      db,
      instanceSlug: INSTANCE_SLUG,
      sessionId: session.id,
      userText: "update test",
      agentConfig: makeAgentConfig(),
      resolvedModel: makeResolvedModel(model),
      workDir: undefined,
    });

    expect(updatedIds).toContain(result.messageId);
  });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe("runPromptLoop — error cases", () => {
  it("throws immediately if abort signal is already aborted", async () => {
    const session = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "main" });
    const model = textStreamModel("never");
    const controller = new AbortController();
    controller.abort();

    await expect(
      runPromptLoop({
        db,
        instanceSlug: INSTANCE_SLUG,
        sessionId: session.id,
        userText: "aborted",
        agentConfig: makeAgentConfig(),
        resolvedModel: makeResolvedModel(model),
        workDir: undefined,
        abort: controller.signal,
      }),
    ).rejects.toThrow("Aborted");
  });

  it("throws if session does not exist", async () => {
    const model = textStreamModel("never");

    await expect(
      runPromptLoop({
        db,
        instanceSlug: INSTANCE_SLUG,
        sessionId: "nonexistent-session-id",
        userText: "hello",
        agentConfig: makeAgentConfig(),
        resolvedModel: makeResolvedModel(model),
        workDir: undefined,
      }),
    ).rejects.toThrow("Session not found: nonexistent-session-id");
  });

  it("sets finishReason=error on assistant message when LLM throws", async () => {
    const session = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "main" });
    const model = errorModel("LLM exploded");

    let thrownError: Error | undefined;
    try {
      await runPromptLoop({
        db,
        instanceSlug: INSTANCE_SLUG,
        sessionId: session.id,
        userText: "boom",
        agentConfig: makeAgentConfig(),
        resolvedModel: makeResolvedModel(model),
        workDir: undefined,
      });
    } catch (err) {
      thrownError = err as Error;
    }

    expect(thrownError).toBeDefined();

    // Assistant message should have been created and marked with error
    const messages = listMessages(db, session.id);
    const assistantMsg = messages.find((m) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.finishReason).toBe("error");
  });

  it("emits SessionStatusChanged(idle) even when LLM throws (finally block)", async () => {
    const session = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "main" });
    const model = errorModel("crash");
    const bus = getBus(INSTANCE_SLUG);

    const statusEvents: string[] = [];
    bus.subscribe(SessionStatusChanged, ({ status }) => statusEvents.push(status));

    try {
      await runPromptLoop({
        db,
        instanceSlug: INSTANCE_SLUG,
        sessionId: session.id,
        userText: "crash test",
        agentConfig: makeAgentConfig(),
        resolvedModel: makeResolvedModel(model),
        workDir: undefined,
      });
    } catch {
      // expected
    }

    expect(statusEvents).toContain("idle");
  });
});

// ---------------------------------------------------------------------------
// costPerMillion = undefined
// ---------------------------------------------------------------------------

describe("runPromptLoop — no cost info", () => {
  it("returns costUsd = 0 when costPerMillion is undefined", async () => {
    const session = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "main" });
    const model = textStreamModel("free", 100, 100);

    const result = await runPromptLoop({
      db,
      instanceSlug: INSTANCE_SLUG,
      sessionId: session.id,
      userText: "free model",
      agentConfig: makeAgentConfig(),
      resolvedModel: {
        languageModel: model as unknown as ResolvedModel["languageModel"],
        providerId: "ollama",
        modelId: "llama3",
        costPerMillion: undefined,
      },
      workDir: undefined,
    });

    expect(result.costUsd).toBe(0);
  });
});
