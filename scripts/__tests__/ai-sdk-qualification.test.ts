/** Local qualification probes: real SDK, synthetic models/transports, no network. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { APICallError, generateText, stepCountIs, streamText, tool } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import { normalizeTokenUsage } from "../../src/runtime/session/usage-tracker.js";
import { initDatabase } from "../../src/db/schema.js";
import { createSession } from "../../src/runtime/session/session.js";
import {
  createUserMessage,
  createAssistantMessage,
  listMessagesFromCompaction,
} from "../../src/runtime/session/message.js";
import { createPart } from "../../src/runtime/session/part.js";
import { compact } from "../../src/runtime/session/compaction.js";
import { buildCoreMessages } from "../../src/runtime/session/message-builder.js";
import { disposeBus } from "../../src/runtime/bus/index.js";

const usage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 },
});

type StreamChunk =
  Awaited<ReturnType<MockLanguageModelV3["doStream"]>>["stream"] extends ReadableStream<infer T>
    ? T
    : never;

function textModel() {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text: "synthetic answer" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: usage(10, 2),
      warnings: [],
    }),
  });
}

describe("AI SDK qualification — actual SDK without provider network", () => {
  it("streams Anthropic SSE through the v4 provider without network", async () => {
    const events = [
      {
        type: "message_start",
        message: {
          id: "synthetic",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-5",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 100,
            output_tokens: 0,
            cache_read_input_tokens: 200,
            cache_creation_input_tokens: 30,
          },
        },
      },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "streamed" } },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 5 },
      },
      { type: "message_stop" },
    ];
    const anthropic = createAnthropic({
      apiKey: "synthetic-not-a-secret",
      fetch: async () =>
        new Response(
          events
            .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
            .join(""),
          { headers: { "content-type": "text/event-stream" } },
        ),
    });
    const received: string[] = [];
    const result = streamText({
      model: anthropic("claude-sonnet-4-5"),
      prompt: "hi",
      onChunk: ({ chunk }) => {
        if (chunk.type === "text-delta") received.push(chunk.text);
      },
    });
    await result.consumeStream();
    expect(received).toEqual(["streamed"]);
    expect(await result.usage).toMatchObject({
      inputTokens: 330,
      outputTokens: 5,
      inputTokenDetails: { cacheReadTokens: 200, cacheWriteTokens: 30 },
    });
  });

  it("reopens persisted tool history, compacts through the real SDK, and resumes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "clawpilot-ai7-"));
    const dbPath = path.join(root, "qualification.db");
    let db = initDatabase(dbPath);
    const slug = "ai7-qualification";
    try {
      db.prepare(
        "INSERT INTO servers (hostname, openclaw_home) VALUES ('localhost', '/synthetic')",
      ).run();
      db.prepare(
        "INSERT INTO instances (server_id, slug, port, config_path, state_dir, systemd_unit) VALUES (1, ?, 19999, '/synthetic', '/synthetic', 'synthetic')",
      ).run(slug);
      const session = createSession(db, { instanceSlug: slug, agentId: "main" });
      createUserMessage(db, { sessionId: session.id, text: "old request" });
      const assistant = createAssistantMessage(db, {
        sessionId: session.id,
        agentId: "main",
        model: "synthetic",
      });
      createPart(db, {
        messageId: assistant.id,
        type: "tool_call",
        metadata: JSON.stringify({ toolCallId: "interrupted-1", toolName: "echo", args: {} }),
      });
      db.close();
      db = initDatabase(dbPath);
      const history = buildCoreMessages(db, listMessagesFromCompaction(db, session.id));
      expect(history.some((m) => m.role === "system")).toBe(false);
      expect(history.at(-1)?.role).toBe("tool");
      expect(JSON.stringify(history)).toContain("interrupted unexpectedly");
      expect((await generateText({ model: textModel(), messages: history })).text).toBe(
        "synthetic answer",
      );
      const agentConfig = {
        id: "main",
        name: "main",
        model: "synthetic",
        permissions: [],
        maxSteps: 2,
        allowSubAgents: false,
        toolProfile: "executor" as const,
        isDefault: true,
      };
      await compact({
        db,
        instanceSlug: slug,
        sessionId: session.id,
        agentConfig,
        resolvedModel: {
          languageModel: textModel(),
          providerId: "anthropic",
          modelId: "synthetic",
          costPerMillion: undefined,
        },
        currentTokens: 100,
        contextWindow: 200,
      });
      db.close();
      db = initDatabase(dbPath);
      createUserMessage(db, { sessionId: session.id, text: "next request" });
      const resumed = buildCoreMessages(db, listMessagesFromCompaction(db, session.id));
      expect(JSON.stringify(resumed)).toContain("synthetic answer");
      expect(JSON.stringify(resumed)).not.toContain("old request");
      expect((await generateText({ model: textModel(), messages: resumed })).text).toBe(
        "synthetic answer",
      );
    } finally {
      db.close();
      disposeBus(slug);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(["openai", "openrouter", "google"])(
    "serializes and parses %s with an in-process HTTP fixture",
    async (provider) => {
      let calls = 0;
      let target = "";
      let body = "";
      const fetch: typeof globalThis.fetch = async (url, init) => {
        calls++;
        target = String(url);
        body = String(init?.body);
        const response =
          provider === "google"
            ? {
                candidates: [
                  {
                    content: { role: "model", parts: [{ text: "done" }] },
                    finishReason: "STOP",
                    index: 0,
                  },
                ],
                usageMetadata: {
                  promptTokenCount: 10,
                  candidatesTokenCount: 2,
                  totalTokenCount: 12,
                },
              }
            : {
                id: "synthetic",
                object: "chat.completion",
                created: 1,
                model: "synthetic",
                choices: [
                  {
                    index: 0,
                    message: { role: "assistant", content: "done" },
                    finish_reason: "stop",
                  },
                ],
                usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
              };
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      };
      const options = { apiKey: "synthetic-not-a-secret", fetch };
      const model =
        provider === "google"
          ? createGoogleGenerativeAI(options)("gemini-2.5-flash")
          : provider === "openrouter"
            ? createOpenRouter(options)("synthetic/model")
            : createOpenAI(options).chat("gpt-4o-mini");
      const result = await generateText({ model, prompt: "qualification", maxOutputTokens: 20 });
      expect(result.text).toBe("done");
      expect(result.usage.inputTokens).toBe(10);
      expect(calls).toBe(1);
      expect(target).toContain(provider === "google" ? ":generateContent" : "/chat/completions");
      expect(body).toContain("qualification");
    },
  );

  it("rejects system history by default while accepting top-level system fallback", async () => {
    await expect(
      generateText({
        model: textModel(),
        messages: [
          { role: "system", content: "trusted legacy instruction" },
          { role: "user", content: "hi" },
        ],
      }),
    ).rejects.toThrow();
    const result = await generateText({ model: textModel(), system: "trusted", prompt: "hi" });
    expect(result.text).toBe("synthetic answer");
  });

  it("accumulates usage across tool steps and exposes lifecycle chunks", async () => {
    let calls = 0;
    const chunks: string[] = [];
    const model = new MockLanguageModelV3({
      doStream: async () => {
        const first = calls++ === 0;
        return {
          stream: simulateReadableStream<StreamChunk>({
            chunks: first
              ? [
                  { type: "stream-start", warnings: [] },
                  {
                    type: "tool-call",
                    toolCallId: "echo-1",
                    toolName: "echo",
                    input: '{"value":"ok"}',
                  },
                  {
                    type: "finish",
                    finishReason: { unified: "tool-calls", raw: "tool_calls" },
                    usage: usage(100, 10),
                  },
                ]
              : [
                  { type: "stream-start", warnings: [] },
                  { type: "text-start", id: "answer" },
                  { type: "text-delta", id: "answer", delta: "done" },
                  { type: "text-end", id: "answer" },
                  {
                    type: "finish",
                    finishReason: { unified: "stop", raw: "stop" },
                    usage: usage(200, 20),
                  },
                ],
            initialDelayInMs: 0,
            chunkDelayInMs: 0,
          }),
        };
      },
    });
    const result = streamText({
      model,
      prompt: "echo then finish",
      stopWhen: stepCountIs(2),
      tools: {
        echo: tool({
          inputSchema: z.object({ value: z.string() }),
          execute: async ({ value }, options) => {
            expect(options.toolCallId).toBe("echo-1");
            return value;
          },
        }),
      },
      onChunk: ({ chunk }) => {
        chunks.push(chunk.type);
      },
    });
    await result.consumeStream();
    expect(calls).toBe(2);
    expect(await result.text).toBe("done");
    expect(await result.usage).toMatchObject({ inputTokens: 300, outputTokens: 30 });
    expect((await result.steps).at(-1)?.usage).toMatchObject({
      inputTokens: 200,
      outputTokens: 20,
    });
    expect(chunks).toEqual(
      expect.arrayContaining(["start", "finish", "tool-call", "tool-result", "text-delta"]),
    );
  });

  it("retries one synthetic retryable transport failure and honors maxRetries", async () => {
    const model = textModel();
    const success = model.doGenerate;
    let calls = 0;
    model.doGenerate = async (options) => {
      if (calls++ === 0)
        throw new APICallError({
          message: "synthetic throttling",
          url: "https://invalid.example",
          requestBodyValues: {},
          statusCode: 429,
          isRetryable: true,
        });
      return success(options);
    };
    expect((await generateText({ model, prompt: "hi", maxRetries: 1 })).text).toBe(
      "synthetic answer",
    );
    expect(calls).toBe(2);
  });

  it("propagates a caller abort to an active synthetic provider", async () => {
    const controller = new AbortController();
    let providerAborted = false;
    const model = new MockLanguageModelV3({
      doGenerate: async ({ abortSignal }) => {
        return new Promise((_resolve, reject) => {
          abortSignal!.addEventListener(
            "abort",
            () => {
              providerAborted = true;
              reject(abortSignal!.reason);
            },
            { once: true },
          );
          controller.abort(new Error("qualification cancellation"));
        });
      },
    });
    await expect(
      generateText({ model, prompt: "hi", abortSignal: controller.signal }),
    ).rejects.toThrow("qualification cancellation");
    expect(providerAborted).toBe(true);
  });

  it("preserves Anthropic cache counters without counting cache tokens twice", async () => {
    let calls = 0;
    const anthropic = createAnthropic({
      apiKey: "synthetic-not-a-secret",
      fetch: async () => {
        calls++;
        return new Response(
          JSON.stringify({
            id: "msg_synthetic",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4-5",
            content: [{ type: "text", text: "done" }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: {
              input_tokens: 100,
              output_tokens: 5,
              cache_read_input_tokens: 200,
              cache_creation_input_tokens: 30,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    const result = await generateText({ model: anthropic("claude-sonnet-4-5"), prompt: "hi" });
    expect(calls).toBe(1);
    expect(result.usage).toMatchObject({
      inputTokens: 330,
      outputTokens: 5,
      inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 200, cacheWriteTokens: 30 },
    });
    expect(normalizeTokenUsage(result.usage)).toEqual({
      input: 330,
      output: 5,
      cacheRead: 200,
      cacheWrite: 30,
    });
  });
});
