/**
 * runtime/middleware/__tests__/built-in.test.ts
 *
 * Unit tests for the 4 built-in middlewares:
 *   - guardrail
 *   - multimodal
 *   - suggestions (factory)
 *   - tool-error-recovery
 *
 * No real DB or LLM calls — all external dependencies are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MiddlewareContext } from "../types.js";
import type { InboundAttachment, InboundMessage } from "../../types.js";

// ---------------------------------------------------------------------------
// Mocks — hoisted before any module imports
// ---------------------------------------------------------------------------

const mockPublish = vi.fn();

vi.mock("../../bus/index.js", () => ({
  getBus: vi.fn(() => ({ publish: mockPublish })),
}));

vi.mock("../../../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("ai", async (importOriginal) => {
  const mod = await importOriginal<typeof import("ai")>();
  return { ...mod, generateText: vi.fn() };
});

vi.mock("../../session/message.js", () => ({
  listMessages: vi.fn(() => []),
}));

vi.mock("../../session/part.js", () => ({
  createPart: vi.fn(),
  listParts: vi.fn(() => []),
}));

vi.mock("../../channel/router.js", () => ({
  resolveModelForAgent: vi.fn(),
}));

vi.mock("../../provider/provider.js", () => ({
  resolveModel: vi.fn(() => ({
    languageModel: {},
    providerId: "anthropic",
    modelId: "claude-haiku-3-5",
  })),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { guardrailMiddleware } from "../built-in/guardrail.js";
import { multimodalMiddleware } from "../built-in/multimodal.js";
import { createSuggestionMiddleware } from "../built-in/suggestions.js";
import { toolErrorRecoveryMiddleware } from "../built-in/tool-error-recovery.js";
import { generateText } from "ai";
import { createPart } from "../../session/part.js";
import { listMessages } from "../../session/message.js";
import { listParts } from "../../session/part.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MB = 1024 * 1024;

function makeCtx(overrides?: Partial<MiddlewareContext>): MiddlewareContext {
  return {
    db: {} as any,
    instanceSlug: "test",
    sessionId: "sess-1",
    agentConfig: { id: "main", model: "anthropic/claude-sonnet-4-5" } as any,
    message: { channelType: "web", peerId: "user-1", text: "hello" } as any,
    metadata: new Map(),
    abort: vi.fn(),
    ...overrides,
  };
}

function makeAttachment(overrides?: Partial<InboundAttachment>): InboundAttachment {
  return {
    id: "att-1",
    type: "image",
    mimeType: "image/jpeg",
    data: "base64data",
    filename: "photo.jpg",
    sizeBytes: 1 * MB,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// guardrail middleware
// ---------------------------------------------------------------------------

describe("guardrailMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pre() with no providers does not abort", async () => {
    const ctx = makeCtx();
    await guardrailMiddleware.pre!(ctx);
    expect(ctx.abort).not.toHaveBeenCalled();
  });

  it("pre() with no providers does not publish events", async () => {
    const ctx = makeCtx();
    await guardrailMiddleware.pre!(ctx);
    expect(mockPublish).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// multimodal middleware
// ---------------------------------------------------------------------------

describe("multimodalMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pre() with no attachments does nothing", async () => {
    const ctx = makeCtx();
    await multimodalMiddleware.pre!(ctx);
    expect(ctx.metadata.has("imageAttachments")).toBe(false);
  });

  it("pre() with empty attachments array does nothing", async () => {
    const msg: InboundMessage = {
      channelType: "web",
      peerId: "user-1",
      text: "hello",
      attachments: [],
    };
    const ctx = makeCtx({ message: msg });
    await multimodalMiddleware.pre!(ctx);
    expect(ctx.metadata.has("imageAttachments")).toBe(false);
  });

  it("pre() filters non-image attachments", async () => {
    const msg: InboundMessage = {
      channelType: "web",
      peerId: "user-1",
      text: "hello",
      attachments: [makeAttachment({ id: "doc-1", type: "document", mimeType: "application/pdf" })],
    };
    const ctx = makeCtx({ message: msg });
    await multimodalMiddleware.pre!(ctx);
    // No valid images → metadata not set
    expect(ctx.metadata.has("imageAttachments")).toBe(false);
  });

  it("pre() filters unsupported MIME types", async () => {
    const msg: InboundMessage = {
      channelType: "web",
      peerId: "user-1",
      text: "hello",
      attachments: [makeAttachment({ mimeType: "image/bmp" })],
    };
    const ctx = makeCtx({ message: msg });
    await multimodalMiddleware.pre!(ctx);
    expect(ctx.metadata.has("imageAttachments")).toBe(false);
  });

  it("pre() filters oversized images (> 20 MB)", async () => {
    const msg: InboundMessage = {
      channelType: "web",
      peerId: "user-1",
      text: "hello",
      attachments: [makeAttachment({ sizeBytes: 21 * MB })],
    };
    const ctx = makeCtx({ message: msg });
    await multimodalMiddleware.pre!(ctx);
    expect(ctx.metadata.has("imageAttachments")).toBe(false);
  });

  it("pre() stores valid images in metadata", async () => {
    const img = makeAttachment({ mimeType: "image/png", sizeBytes: 5 * MB });
    const msg: InboundMessage = {
      channelType: "web",
      peerId: "user-1",
      text: "hello",
      attachments: [img],
    };
    const ctx = makeCtx({ message: msg });
    await multimodalMiddleware.pre!(ctx);

    expect(ctx.metadata.has("imageAttachments")).toBe(true);
    const stored = ctx.metadata.get("imageAttachments") as InboundAttachment[];
    expect(stored).toHaveLength(1);
    expect(stored[0]!.mimeType).toBe("image/png");
  });

  it("pre() handles multiple valid images and filters mixed attachments", async () => {
    const msg: InboundMessage = {
      channelType: "web",
      peerId: "user-1",
      text: "hello",
      attachments: [
        makeAttachment({ id: "jpg", mimeType: "image/jpeg", sizeBytes: 2 * MB }),
        makeAttachment({ id: "doc", type: "document", mimeType: "application/pdf" }),
        makeAttachment({ id: "webp", mimeType: "image/webp", sizeBytes: 10 * MB }),
        makeAttachment({ id: "big", mimeType: "image/png", sizeBytes: 25 * MB }),
        makeAttachment({ id: "gif", mimeType: "image/gif", sizeBytes: 500 }),
      ],
    };
    const ctx = makeCtx({ message: msg });
    await multimodalMiddleware.pre!(ctx);

    const stored = ctx.metadata.get("imageAttachments") as InboundAttachment[];
    expect(stored).toHaveLength(3);
    const ids = stored.map((a) => a.id);
    expect(ids).toEqual(["jpg", "webp", "gif"]);
  });
});

// ---------------------------------------------------------------------------
// suggestions middleware (factory)
// ---------------------------------------------------------------------------

describe("createSuggestionMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("post() skips when no result", async () => {
    const mw = createSuggestionMiddleware({
      maxSuggestions: 3,
    });
    const ctx = makeCtx();
    await mw.post!(ctx);

    expect(generateText).not.toHaveBeenCalled();
  });

  it("post() skips when result text is too short (< 20 chars)", async () => {
    const mw = createSuggestionMiddleware({
      maxSuggestions: 3,
    });
    const ctx = makeCtx({
      result: {
        messageId: "msg-1",
        text: "Short.",
        tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
        costUsd: 0.001,
        steps: 1,
      },
    });
    await mw.post!(ctx);

    expect(generateText).not.toHaveBeenCalled();
  });

  it("post() generates suggestions and creates a part in DB", async () => {
    const suggestions = ["Run the test suite", "Add error handling"];
    vi.mocked(generateText).mockResolvedValue({
      text: JSON.stringify(suggestions),
    } as any);
    vi.mocked(listMessages).mockReturnValue([
      { id: "msg-1", role: "user", sessionId: "sess-1", createdAt: "" } as any,
      { id: "msg-2", role: "assistant", sessionId: "sess-1", createdAt: "" } as any,
    ]);
    vi.mocked(listParts).mockReturnValue([
      {
        id: "p-1",
        messageId: "msg-1",
        type: "text",
        content: "Hello world",
        metadata: null,
      } as any,
    ]);

    const mw = createSuggestionMiddleware({
      maxSuggestions: 3,
      suggestionsModel: "anthropic/claude-haiku-3-5",
    });
    const ctx = makeCtx({
      result: {
        messageId: "msg-2",
        text: "Here is a detailed response to your question about testing.",
        tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
        costUsd: 0.01,
        steps: 1,
      },
    });

    await mw.post!(ctx);

    expect(generateText).toHaveBeenCalledOnce();
    expect(createPart).toHaveBeenCalledOnce();
    expect(vi.mocked(createPart).mock.calls[0]![1]).toEqual(
      expect.objectContaining({
        messageId: "msg-2",
        type: "suggestion",
      }),
    );
    // Verify bus event was published
    expect(mockPublish).toHaveBeenCalledOnce();
  });

  it("post() handles invalid JSON from LLM gracefully", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "This is not valid JSON at all",
    } as any);
    vi.mocked(listMessages).mockReturnValue([]);

    const mw = createSuggestionMiddleware({
      maxSuggestions: 3,
      suggestionsModel: "anthropic/claude-haiku-3-5",
    });
    const ctx = makeCtx({
      result: {
        messageId: "msg-1",
        text: "Here is a detailed response to your question about testing.",
        tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
        costUsd: 0.01,
        steps: 1,
      },
    });

    // Should not throw — invalid JSON results in empty suggestions (skipped)
    await mw.post!(ctx);

    expect(generateText).toHaveBeenCalledOnce();
    // No part created because parseSuggestions returns []
    expect(createPart).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("post() parses suggestions wrapped in markdown code blocks", async () => {
    const suggestions = ["Refactor the module", "Add unit tests"];
    vi.mocked(generateText).mockResolvedValue({
      text: "```json\n" + JSON.stringify(suggestions) + "\n```",
    } as any);
    vi.mocked(listMessages).mockReturnValue([]);

    const mw = createSuggestionMiddleware({
      maxSuggestions: 3,
      suggestionsModel: "anthropic/claude-haiku-3-5",
    });
    const ctx = makeCtx({
      result: {
        messageId: "msg-1",
        text: "Here is a detailed response to your question about testing.",
        tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
        costUsd: 0.01,
        steps: 1,
      },
    });

    await mw.post!(ctx);

    expect(createPart).toHaveBeenCalledOnce();
    const partArg = vi.mocked(createPart).mock.calls[0]![1] as any;
    const parsed = JSON.parse(partArg.content);
    expect(parsed).toEqual(suggestions);
  });
});

// ---------------------------------------------------------------------------
// tool-error-recovery middleware
// ---------------------------------------------------------------------------

describe("toolErrorRecoveryMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("post() returns early when no result", async () => {
    const ctx = makeCtx();
    await toolErrorRecoveryMiddleware.post!(ctx);

    expect(mockPublish).not.toHaveBeenCalled();
    expect(ctx.metadata.has("toolErrorHints")).toBe(false);
  });

  it("post() returns early when text has no error indicators", async () => {
    const ctx = makeCtx({
      result: {
        messageId: "msg-1",
        text: "Everything completed successfully.",
        tokens: { input: 50, output: 20, cacheRead: 0, cacheWrite: 0 },
        costUsd: 0.005,
        steps: 1,
      },
    });
    await toolErrorRecoveryMiddleware.post!(ctx);

    expect(mockPublish).not.toHaveBeenCalled();
    expect(ctx.metadata.has("toolErrorHints")).toBe(false);
  });

  it("post() classifies rate-limit errors", async () => {
    const ctx = makeCtx({
      result: {
        messageId: "msg-1",
        text: "tool 'web_search' failed with HTTP 429 rate limit exceeded",
        tokens: { input: 50, output: 20, cacheRead: 0, cacheWrite: 0 },
        costUsd: 0.005,
        steps: 1,
      },
    });
    await toolErrorRecoveryMiddleware.post!(ctx);

    expect(mockPublish).toHaveBeenCalledOnce();
    expect(mockPublish.mock.calls[0]![1]).toEqual(
      expect.objectContaining({
        toolName: "web_search",
        errorType: "rate-limit",
      }),
    );
    const hints = ctx.metadata.get("toolErrorHints") as string[];
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain("rate-limited");
  });

  it("post() classifies timeout errors", async () => {
    const ctx = makeCtx({
      result: {
        messageId: "msg-1",
        text: "error calling tool 'long_task': request timed out after 30s",
        tokens: { input: 50, output: 20, cacheRead: 0, cacheWrite: 0 },
        costUsd: 0.005,
        steps: 1,
      },
    });
    await toolErrorRecoveryMiddleware.post!(ctx);

    expect(mockPublish).toHaveBeenCalledOnce();
    expect(mockPublish.mock.calls[0]![1]).toEqual(
      expect.objectContaining({
        toolName: "long_task",
        errorType: "timeout",
      }),
    );
    const hints = ctx.metadata.get("toolErrorHints") as string[];
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain("timed out");
  });

  it("post() classifies parsing errors", async () => {
    const ctx = makeCtx({
      result: {
        messageId: "msg-1",
        text: "tool 'json_parser' error: invalid schema validation failed",
        tokens: { input: 50, output: 20, cacheRead: 0, cacheWrite: 0 },
        costUsd: 0.005,
        steps: 1,
      },
    });
    await toolErrorRecoveryMiddleware.post!(ctx);

    expect(mockPublish).toHaveBeenCalledOnce();
    expect(mockPublish.mock.calls[0]![1]).toEqual(
      expect.objectContaining({
        toolName: "json_parser",
        errorType: "parsing",
      }),
    );
    const hints = ctx.metadata.get("toolErrorHints") as string[];
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain("invalid input");
  });

  it("post() classifies unknown errors and stores hint in metadata", async () => {
    const ctx = makeCtx({
      result: {
        messageId: "msg-1",
        text: "error from tool 'mystery_tool': something unexpected happened",
        tokens: { input: 50, output: 20, cacheRead: 0, cacheWrite: 0 },
        costUsd: 0.005,
        steps: 1,
      },
    });
    await toolErrorRecoveryMiddleware.post!(ctx);

    expect(mockPublish).toHaveBeenCalledOnce();
    expect(mockPublish.mock.calls[0]![1]).toEqual(
      expect.objectContaining({
        toolName: "mystery_tool",
        errorType: "unknown",
      }),
    );
    const hints = ctx.metadata.get("toolErrorHints") as string[];
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain("different approach");
  });
});
