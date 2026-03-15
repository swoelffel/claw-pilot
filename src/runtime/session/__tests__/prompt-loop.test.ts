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
import { z } from "zod";

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
  DoomLoopDetected,
  AgentTimeout,
} from "../../bus/events.js";
import { runPromptLoop } from "../prompt-loop.js";
import type { ResolvedModel } from "../../provider/provider.js";
import type { RuntimeAgentConfig } from "../../config/index.js";
import { getTools } from "../../tool/registry.js";
import { Tool } from "../../tool/tool.js";

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
// extraSystemPrompt
// ---------------------------------------------------------------------------

describe("runPromptLoop — extraSystemPrompt", () => {
  /**
   * Objective: extraSystemPrompt passed to runPromptLoop must be forwarded to
   * buildSystemPrompt and appear in the system prompt sent to the LLM.
   * Positive test: we spy on buildSystemPrompt and verify it receives the extra content.
   */
  it("[positive] extraSystemPrompt is forwarded to buildSystemPrompt", async () => {
    // Arrange: spy on buildSystemPrompt to capture the context it receives
    const { buildSystemPrompt } = await import("../system-prompt.js");
    const spy = vi.spyOn(await import("../system-prompt.js"), "buildSystemPrompt");

    const session = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "main" });
    const model = textStreamModel("ok");
    const extra = "## Subagent Context\nYou are a subagent.\nSpawn depth: 1";

    // Act
    await runPromptLoop({
      db,
      instanceSlug: INSTANCE_SLUG,
      sessionId: session.id,
      userText: "do the task",
      agentConfig: makeAgentConfig(),
      resolvedModel: makeResolvedModel(model),
      workDir: undefined,
      extraSystemPrompt: extra,
    });

    // Assert: buildSystemPrompt was called with the extra content
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ extraSystemPrompt: extra }));

    spy.mockRestore();
    void buildSystemPrompt; // suppress unused import warning
  });

  /**
   * Objective: when extraSystemPrompt is absent, buildSystemPrompt must NOT receive it.
   * Negative test: the context passed to buildSystemPrompt must not have extraSystemPrompt set.
   */
  it("[negative] without extraSystemPrompt, buildSystemPrompt receives no extra content", async () => {
    // Arrange
    const spy = vi.spyOn(await import("../system-prompt.js"), "buildSystemPrompt");

    const session = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "main" });
    const model = textStreamModel("ok");

    // Act
    await runPromptLoop({
      db,
      instanceSlug: INSTANCE_SLUG,
      sessionId: session.id,
      userText: "simple task",
      agentConfig: makeAgentConfig(),
      resolvedModel: makeResolvedModel(model),
      workDir: undefined,
      // extraSystemPrompt intentionally omitted
    });

    // Assert: buildSystemPrompt called without extraSystemPrompt key
    const callArg = spy.mock.calls[0]![0];
    expect(callArg).not.toHaveProperty("extraSystemPrompt");

    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Max-steps reminder
// ---------------------------------------------------------------------------

/**
 * The max-steps reminder is implemented as a closure inside runPromptLoop:
 *
 *   const getEffectiveSystem = () =>
 *     completedSteps >= agentConfig.maxSteps - 1
 *       ? systemPrompt + MAX_STEPS_REMINDER
 *       : systemPrompt;
 *
 * `getEffectiveSystem()` is evaluated once when `streamText` is called.
 * `completedSteps` is incremented in `onStepFinish`.
 *
 * The AI SDK passes `system` as a `{ role: 'system', content: string }` message
 * at the start of the `prompt` array in `LanguageModelV3CallOptions`.
 * `MockLanguageModelV3` stores all calls in `model.doStreamCalls`, so we can
 * inspect `model.doStreamCalls[0].prompt` to find the system message.
 *
 * We mock `buildSystemPrompt` to return a known sentinel so we can reliably
 * detect whether the reminder was appended.
 */
describe("runPromptLoop — max-steps reminder", () => {
  /**
   * Objective: getEffectiveSystem() appends <system-reminder> when
   * completedSteps >= maxSteps - 1.
   *
   * Positive test: with maxSteps=1, completedSteps=0 >= 0 = maxSteps-1,
   * so the reminder is appended to the system prompt on the first (and only)
   * streamText call.
   */
  it("[positive] system-reminder is injected when completedSteps >= maxSteps - 1", async () => {
    // Arrange: mock buildSystemPrompt to return a known sentinel
    const SENTINEL = "SENTINEL_SYSTEM_PROMPT";
    const systemPromptModule = await import("../system-prompt.js");
    const buildSpy = vi.spyOn(systemPromptModule, "buildSystemPrompt").mockResolvedValue(SENTINEL);

    const model = textStreamModel("done");
    const session = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "main" });

    // Act: maxSteps=1 → completedSteps=0 >= maxSteps-1=0 → reminder injected immediately
    await runPromptLoop({
      db,
      instanceSlug: INSTANCE_SLUG,
      sessionId: session.id,
      userText: "last step task",
      agentConfig: makeAgentConfig({ maxSteps: 1 }),
      resolvedModel: makeResolvedModel(model),
      workDir: undefined,
    });

    buildSpy.mockRestore();

    // Assert: the system message in the prompt array contains the sentinel + reminder
    // The AI SDK encodes `system` as prompt[0] = { role: 'system', content: string }
    expect(model.doStreamCalls.length).toBeGreaterThanOrEqual(1);
    const firstCall = model.doStreamCalls[0]!;
    const systemMsg = firstCall.prompt.find(
      (m): m is { role: "system"; content: string } => m.role === "system",
    );
    expect(systemMsg).toBeDefined();
    expect(systemMsg!.content).toContain(SENTINEL);
    expect(systemMsg!.content).toContain("<system-reminder>");
    expect(systemMsg!.content).toContain("This is your last allowed step.");
  });

  /**
   * Objective: when the task finishes before reaching maxSteps - 1, no reminder is injected.
   * Negative test: with maxSteps=10 and a single-step response, completedSteps=0 < 9,
   * so the reminder must be absent from the system prompt.
   */
  it("[negative] system-reminder is NOT injected when task finishes before the last step", async () => {
    // Arrange: mock buildSystemPrompt to return a known sentinel
    const SENTINEL = "SENTINEL_SYSTEM_PROMPT_NO_REMINDER";
    const systemPromptModule = await import("../system-prompt.js");
    const buildSpy = vi.spyOn(systemPromptModule, "buildSystemPrompt").mockResolvedValue(SENTINEL);

    const model = textStreamModel("quick answer");
    const session = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "main" });

    // Act: maxSteps=10, task finishes in 1 step → completedSteps=0 < 9 → no reminder
    await runPromptLoop({
      db,
      instanceSlug: INSTANCE_SLUG,
      sessionId: session.id,
      userText: "quick question",
      agentConfig: makeAgentConfig({ maxSteps: 10 }),
      resolvedModel: makeResolvedModel(model),
      workDir: undefined,
    });

    buildSpy.mockRestore();

    // Assert: system message present but no reminder
    expect(model.doStreamCalls.length).toBeGreaterThanOrEqual(1);
    const firstCall = model.doStreamCalls[0]!;
    const systemMsg = firstCall.prompt.find(
      (m): m is { role: "system"; content: string } => m.role === "system",
    );
    expect(systemMsg).toBeDefined();
    expect(systemMsg!.content).toContain(SENTINEL);
    expect(systemMsg!.content).not.toContain("<system-reminder>");
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

// ---------------------------------------------------------------------------
// Doom-loop detection
// ---------------------------------------------------------------------------

/**
 * The doom-loop detector lives inside buildToolSet (prompt-loop.ts).
 * It maintains a sliding window of the last 3 tool calls. If the same tool
 * is called 3 consecutive times with identical arguments, it throws an Error
 * and emits a DoomLoopDetected bus event.
 *
 * Implementation detail: the doom-loop check runs inside the `execute()` wrapper
 * of each tool in the ToolSet. The AI SDK calls `execute()` when the LLM emits
 * a `tool-call` chunk WITHOUT a corresponding `tool-result` in the same stream
 * (i.e., the tool is executed locally, not by the provider).
 *
 * To trigger `execute()`, the mock LLM must emit only `tool-call` chunks (no
 * `tool-result`). The SDK then calls `execute()`, gets the result, and starts
 * a new step. We use a step counter in `doStream` to return tool-calls for the
 * first N steps and a text response on the final step.
 */
describe("runPromptLoop — doom-loop detection", () => {
  /** Create a minimal fake Tool.Info that always returns "ok" */
  function makeFakeTool(id: string): Tool.Info {
    return {
      id,
      init: async () => ({
        description: `Fake tool ${id}`,
        parameters: z.object({ input: z.string() }),
        execute: async () => ({ title: id, output: "ok", truncated: false }),
      }),
    };
  }

  /** Finish chunk helper */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finishChunk = {
    type: "finish" as const,
    finishReason: { unified: "stop", raw: "stop" } as any,
    usage: {
      inputTokens: { total: 5, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 2, text: undefined, reasoning: undefined },
    },
  };

  /**
   * Build a multi-step mock: returns a tool-call for the first `toolCallSteps`
   * invocations of doStream, then a text response.
   * Each step is a separate doStream call (the SDK calls doStream once per step).
   */
  function multiStepModel(
    toolName: string,
    args: Record<string, unknown>,
    toolCallSteps: number,
  ): MockLanguageModelV3 {
    let callCount = 0;
    return new MockLanguageModelV3({
      doStream: async () => {
        const step = callCount++;
        if (step < toolCallSteps) {
          // Emit a tool-call (no tool-result → SDK will call execute())
          return {
            stream: simulateReadableStream({
              chunks: [
                { type: "stream-start", warnings: [] },
                {
                  type: "tool-call",
                  toolCallId: `call-${step}`,
                  toolName,
                  input: JSON.stringify(args),
                },
                finishChunk,
              ],
              initialDelayInMs: 0,
              chunkDelayInMs: 0,
            }),
            rawCall: { rawPrompt: null, rawSettings: {} },
          };
        }
        // Final step: text response
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "t1" },
              { type: "text-delta", id: "t1", delta: "done" },
              { type: "text-end", id: "t1" },
              finishChunk,
            ],
            initialDelayInMs: 0,
            chunkDelayInMs: 0,
          }),
          rawCall: { rawPrompt: null, rawSettings: {} },
        };
      },
    });
  }

  /**
   * Objective: 3 consecutive identical tool calls (via execute()) must trigger
   * doom-loop detection, emitting a DoomLoopDetected bus event.
   *
   * Note: the Vercel AI SDK v6 catches errors thrown from tool execute() and
   * returns them as tool error results — the error does NOT propagate to
   * runPromptLoop. The observable side-effect is the DoomLoopDetected bus event.
   *
   * Negative test: 3 identical calls → DoomLoopDetected event emitted for the tool.
   */
  it("[negative] 3 consecutive identical tool calls → emits DoomLoopDetected event", async () => {
    // Arrange: inject a fake tool; mock LLM will call it 3 times via execute()
    const fakeTool = makeFakeTool("fake_tool");
    vi.mocked(getTools).mockResolvedValueOnce([fakeTool]);

    const session = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "main" });
    const bus = getBus(INSTANCE_SLUG);

    const doomEvents: string[] = [];
    bus.subscribe(DoomLoopDetected, ({ toolName }) => doomEvents.push(toolName));

    // 3 steps with identical tool calls → doom loop on 3rd execute()
    const model = multiStepModel("fake_tool", { input: "same-arg" }, 3);

    // Act: run the loop (does NOT throw — SDK swallows tool execute() errors)
    await runPromptLoop({
      db,
      instanceSlug: INSTANCE_SLUG,
      sessionId: session.id,
      userText: "trigger doom loop",
      agentConfig: makeAgentConfig({ maxSteps: 10 }),
      resolvedModel: makeResolvedModel(model),
      workDir: undefined,
    });

    // Assert: DoomLoopDetected event was emitted for the tool
    expect(doomEvents).toContain("fake_tool");
  });

  /**
   * Objective: 2 identical calls followed by 1 different call must NOT trigger
   * doom-loop detection — the window never has 3 identical consecutive entries.
   * Positive test: [tool_a(x), tool_a(x), tool_b(x)] → no error.
   */
  it("[positive] 2 identical + 1 different call does NOT trigger doom loop", async () => {
    // Arrange: inject two fake tools
    const toolA = makeFakeTool("tool_a");
    const toolB = makeFakeTool("tool_b");
    vi.mocked(getTools).mockResolvedValueOnce([toolA, toolB]);

    const session = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "main" });

    // Steps: tool_a(x), tool_a(x), tool_b(x), then text
    let callCount = 0;
    const steps = [
      { toolName: "tool_a", args: { input: "x" } },
      { toolName: "tool_a", args: { input: "x" } },
      { toolName: "tool_b", args: { input: "x" } },
    ];
    const model = new MockLanguageModelV3({
      doStream: async () => {
        const step = callCount++;
        if (step < steps.length) {
          const { toolName, args } = steps[step]!;
          return {
            stream: simulateReadableStream({
              chunks: [
                { type: "stream-start", warnings: [] },
                {
                  type: "tool-call",
                  toolCallId: `c${step}`,
                  toolName,
                  input: JSON.stringify(args),
                },
                finishChunk,
              ],
              initialDelayInMs: 0,
              chunkDelayInMs: 0,
            }),
            rawCall: { rawPrompt: null, rawSettings: {} },
          };
        }
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "t1" },
              { type: "text-delta", id: "t1", delta: "ok" },
              { type: "text-end", id: "t1" },
              finishChunk,
            ],
            initialDelayInMs: 0,
            chunkDelayInMs: 0,
          }),
          rawCall: { rawPrompt: null, rawSettings: {} },
        };
      },
    });

    // Act + Assert: must NOT throw
    const result = await runPromptLoop({
      db,
      instanceSlug: INSTANCE_SLUG,
      sessionId: session.id,
      userText: "no doom loop",
      agentConfig: makeAgentConfig({ maxSteps: 10 }),
      resolvedModel: makeResolvedModel(model),
      workDir: undefined,
    });

    expect(result.text).toBe("ok");
  });

  /**
   * Objective: identical calls that are NOT consecutive (interleaved with different
   * calls) must NOT trigger doom-loop detection.
   * Positive test: [tool_a(x), tool_b(x), tool_a(x)] → no error.
   */
  it("[positive] identical non-consecutive calls do NOT trigger doom loop", async () => {
    // Arrange: inject two fake tools
    const toolA = makeFakeTool("tool_a");
    const toolB = makeFakeTool("tool_b");
    vi.mocked(getTools).mockResolvedValueOnce([toolA, toolB]);

    const session = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "main" });

    // Steps: tool_a(x), tool_b(x), tool_a(x) — A, B, A pattern
    let callCount = 0;
    const steps = [
      { toolName: "tool_a", args: { input: "x" } },
      { toolName: "tool_b", args: { input: "x" } },
      { toolName: "tool_a", args: { input: "x" } },
    ];
    const model = new MockLanguageModelV3({
      doStream: async () => {
        const step = callCount++;
        if (step < steps.length) {
          const { toolName, args } = steps[step]!;
          return {
            stream: simulateReadableStream({
              chunks: [
                { type: "stream-start", warnings: [] },
                {
                  type: "tool-call",
                  toolCallId: `c${step}`,
                  toolName,
                  input: JSON.stringify(args),
                },
                finishChunk,
              ],
              initialDelayInMs: 0,
              chunkDelayInMs: 0,
            }),
            rawCall: { rawPrompt: null, rawSettings: {} },
          };
        }
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "t1" },
              { type: "text-delta", id: "t1", delta: "done" },
              { type: "text-end", id: "t1" },
              finishChunk,
            ],
            initialDelayInMs: 0,
            chunkDelayInMs: 0,
          }),
          rawCall: { rawPrompt: null, rawSettings: {} },
        };
      },
    });

    // Act + Assert: must NOT throw
    const result = await runPromptLoop({
      db,
      instanceSlug: INSTANCE_SLUG,
      sessionId: session.id,
      userText: "interleaved calls",
      agentConfig: makeAgentConfig({ maxSteps: 10 }),
      resolvedModel: makeResolvedModel(model),
      workDir: undefined,
    });

    expect(result.text).toBe("done");
  });
});

// ---------------------------------------------------------------------------
// ownerOnly filtering — channel-based tool access
// ---------------------------------------------------------------------------

/**
 * The ownerOnly filter is applied in buildToolSet (prompt-loop.ts):
 *   if (def.ownerOnly && !ctx.senderIsOwner) continue;
 *
 * senderIsOwner = session.channel !== "internal"
 *
 * So:
 *   - channel "web"      → senderIsOwner = true  → ownerOnly tools ARE included
 *   - channel "internal" → senderIsOwner = false → ownerOnly tools are EXCLUDED
 *
 * We verify this by injecting fake tools via getTools mock and inspecting
 * model.doStreamCalls[0].tools — the AI SDK passes tools as an Array of
 * { type: "function", name: string, ... } objects (LanguageModelV3FunctionTool).
 */
describe("runPromptLoop — ownerOnly filtering", () => {
  /** Create a minimal fake Tool.Info with ownerOnly flag */
  function makeOwnerOnlyTool(id: string): Tool.Info {
    return {
      id,
      init: async () => ({
        description: `Owner-only tool ${id}`,
        parameters: z.object({ x: z.string() }),
        ownerOnly: true as const,
        execute: async () => ({ title: id, output: "ok", truncated: false }),
      }),
    };
  }

  function makePublicTool(id: string): Tool.Info {
    return {
      id,
      init: async () => ({
        description: `Public tool ${id}`,
        parameters: z.object({ x: z.string() }),
        execute: async () => ({ title: id, output: "ok", truncated: false }),
      }),
    };
  }

  /**
   * Objective: a session with channel "web" (owner channel) must have access
   * to ownerOnly tools — they must appear in the tools array sent to the LLM.
   * Positive test: channel "web" + ownerOnly tool → tool name present in LLM call.
   */
  it("[positive] channel 'web' → ownerOnly tool IS included in toolset", async () => {
    // Arrange: inject one ownerOnly tool + one public tool
    const ownerTool = makeOwnerOnlyTool("owner_tool");
    const publicTool = makePublicTool("public_tool");
    vi.mocked(getTools).mockResolvedValueOnce([ownerTool, publicTool]);

    const session = createSession(db, {
      instanceSlug: INSTANCE_SLUG,
      agentId: "main",
      channel: "web",
    });
    const model = textStreamModel("ok");

    // Act
    await runPromptLoop({
      db,
      instanceSlug: INSTANCE_SLUG,
      sessionId: session.id,
      userText: "test owner access",
      agentConfig: makeAgentConfig(),
      resolvedModel: makeResolvedModel(model),
      workDir: undefined,
    });

    // Assert: the LLM call includes the ownerOnly tool
    // tools is an Array<{type, name, ...}> in LanguageModelV3CallOptions
    expect(model.doStreamCalls.length).toBeGreaterThanOrEqual(1);
    const firstCall = model.doStreamCalls[0]!;
    const toolNames = (firstCall.tools ?? []).map((t: { name: string }) => t.name);
    expect(toolNames).toContain("owner_tool");
    expect(toolNames).toContain("public_tool");
  });

  /**
   * Objective: a session with channel "internal" (sub-agent) must NOT have
   * access to ownerOnly tools — they must be absent from the tools array.
   * Negative test: channel "internal" + ownerOnly tool → tool absent from LLM call.
   */
  it("[negative] channel 'internal' → ownerOnly tool is EXCLUDED from toolset", async () => {
    // Arrange: inject one ownerOnly tool + one public tool
    const ownerTool = makeOwnerOnlyTool("owner_tool");
    const publicTool = makePublicTool("public_tool");
    vi.mocked(getTools).mockResolvedValueOnce([ownerTool, publicTool]);

    const session = createSession(db, {
      instanceSlug: INSTANCE_SLUG,
      agentId: "main",
      channel: "internal", // sub-agent channel
    });
    const model = textStreamModel("ok");

    // Act
    await runPromptLoop({
      db,
      instanceSlug: INSTANCE_SLUG,
      sessionId: session.id,
      userText: "test internal access",
      agentConfig: makeAgentConfig(),
      resolvedModel: makeResolvedModel(model),
      workDir: undefined,
    });

    // Assert: ownerOnly tool is absent, public tool is present
    expect(model.doStreamCalls.length).toBeGreaterThanOrEqual(1);
    const firstCall = model.doStreamCalls[0]!;
    const toolNames = (firstCall.tools ?? []).map((t: { name: string }) => t.name);
    expect(toolNames).not.toContain("owner_tool");
    expect(toolNames).toContain("public_tool");
  });
});

// ---------------------------------------------------------------------------
// Watchdog timeout
// ---------------------------------------------------------------------------

describe("runPromptLoop — watchdog timeout", () => {
  /**
   * Objective: clearTimeout is called in the finally block after normal completion.
   * We spy on clearTimeout (real timers) and verify it is called after the loop completes.
   * Positive test: normal completion → clearTimeout called.
   *
   * Note: vi.useFakeTimers() is intentionally NOT used here — it blocks streamText's
   * internal Promises and causes the test to hang. Real timers work fine since the
   * timeout is large (60s) and the mock LLM responds instantly.
   */
  it("[positive] clearTimeout is called in finally block on normal completion", async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    const session = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "main" });
    const model = textStreamModel("done");

    await runPromptLoop({
      db,
      instanceSlug: INSTANCE_SLUG,
      sessionId: session.id,
      userText: "quick task",
      agentConfig: makeAgentConfig({ timeoutMs: 60_000 }),
      resolvedModel: makeResolvedModel(model),
      workDir: undefined,
    });

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  /**
   * Objective: AgentTimeout is NOT published when the loop completes before the timeout.
   * Negative test: loop completes quickly with a large timeout → no AgentTimeout event.
   */
  it("[negative] no AgentTimeout published when loop completes before timeout", async () => {
    const session = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "main" });
    const model = textStreamModel("done");
    const bus = getBus(INSTANCE_SLUG);

    const timeoutHandler = vi.fn();
    bus.subscribe(AgentTimeout, timeoutHandler);

    // Large timeout (60s) — mock LLM responds instantly, loop completes well before timeout
    await runPromptLoop({
      db,
      instanceSlug: INSTANCE_SLUG,
      sessionId: session.id,
      userText: "quick task",
      agentConfig: makeAgentConfig({ timeoutMs: 60_000 }),
      resolvedModel: makeResolvedModel(model),
      workDir: undefined,
    });

    // AgentTimeout must NOT have been published
    expect(timeoutHandler).not.toHaveBeenCalled();
  });
});
