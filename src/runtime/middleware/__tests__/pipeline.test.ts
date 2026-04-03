/**
 * runtime/middleware/__tests__/pipeline.test.ts
 *
 * Unit tests for the middleware registry and pipeline.
 * No DB, no LLM — all dependencies are stubbed.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { Middleware, MiddlewareContext } from "../types.js";
import type { PipelineInput } from "../pipeline.js";
import type { PromptLoopResult } from "../../session/prompt-loop.js";
import { registerMiddleware, getMiddlewares, clearMiddlewares } from "../registry.js";
import { runMiddlewarePipeline } from "../pipeline.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockCtx: PipelineInput["ctx"] = {
  db: {} as any,
  instanceSlug: "test" as any,
  sessionId: "sess-1" as any,
  agentConfig: { id: "main" } as any,
  message: { channelType: "web", peerId: "user-1", text: "hello" } as any,
};

function makeRunLoop(value?: Partial<PromptLoopResult>): PipelineInput["runLoop"] {
  return vi.fn().mockResolvedValue({ text: "response", messageId: "msg-1", ...value });
}

function makeMw(
  name: string,
  order: number,
  hooks?: {
    pre?: (ctx: MiddlewareContext) => Promise<void>;
    post?: (ctx: MiddlewareContext) => Promise<void>;
  },
): Middleware {
  return { name, order, ...hooks };
}

// ---------------------------------------------------------------------------
// Registry tests
// ---------------------------------------------------------------------------

describe("middleware registry", () => {
  afterEach(() => clearMiddlewares());

  it("registerMiddleware adds a middleware", () => {
    registerMiddleware(makeMw("a", 1));
    expect(getMiddlewares()).toHaveLength(1);
    expect(getMiddlewares()[0]!.name).toBe("a");
  });

  it("getMiddlewares returns middlewares sorted by order", () => {
    registerMiddleware(makeMw("c", 30));
    registerMiddleware(makeMw("a", 10));
    registerMiddleware(makeMw("b", 20));

    const names = getMiddlewares().map((m) => m.name);
    expect(names).toEqual(["a", "b", "c"]);
  });

  it("getMiddlewares returns a shallow copy (mutation-safe)", () => {
    registerMiddleware(makeMw("a", 1));
    const list1 = getMiddlewares();
    list1.push(makeMw("rogue", 99));

    // The internal list should be unaffected
    expect(getMiddlewares()).toHaveLength(1);
  });

  it("clearMiddlewares removes all middlewares", () => {
    registerMiddleware(makeMw("a", 1));
    registerMiddleware(makeMw("b", 2));
    clearMiddlewares();
    expect(getMiddlewares()).toHaveLength(0);
  });

  it("registering after clear works normally", () => {
    registerMiddleware(makeMw("a", 1));
    clearMiddlewares();
    registerMiddleware(makeMw("b", 5));
    expect(getMiddlewares()).toHaveLength(1);
    expect(getMiddlewares()[0]!.name).toBe("b");
  });

  it("multiple registrations preserve sort after getMiddlewares", () => {
    registerMiddleware(makeMw("z", 50));
    registerMiddleware(makeMw("a", 5));
    // Force sort
    getMiddlewares();

    // Register another — the list must re-sort on next call
    registerMiddleware(makeMw("m", 25));
    const names = getMiddlewares().map((m) => m.name);
    expect(names).toEqual(["a", "m", "z"]);
  });
});

// ---------------------------------------------------------------------------
// Pipeline tests
// ---------------------------------------------------------------------------

describe("runMiddlewarePipeline", () => {
  afterEach(() => clearMiddlewares());

  it("fast path: no middlewares → runs loop directly", async () => {
    const runLoop = makeRunLoop();
    const output = await runMiddlewarePipeline({ ctx: mockCtx, runLoop });

    expect(runLoop).toHaveBeenCalledOnce();
    expect(output.aborted).toBe(false);
    expect(output.result).toEqual(expect.objectContaining({ text: "response" }));
  });

  it("pre middlewares run in order (by order field)", async () => {
    const calls: string[] = [];

    registerMiddleware(
      makeMw("second", 20, {
        pre: async () => {
          calls.push("second");
        },
      }),
    );
    registerMiddleware(
      makeMw("first", 10, {
        pre: async () => {
          calls.push("first");
        },
      }),
    );
    registerMiddleware(
      makeMw("third", 30, {
        pre: async () => {
          calls.push("third");
        },
      }),
    );

    await runMiddlewarePipeline({ ctx: mockCtx, runLoop: makeRunLoop() });

    expect(calls).toEqual(["first", "second", "third"]);
  });

  it("post middlewares run in reverse order", async () => {
    const calls: string[] = [];

    registerMiddleware(
      makeMw("first", 10, {
        post: async () => {
          calls.push("first");
        },
      }),
    );
    registerMiddleware(
      makeMw("second", 20, {
        post: async () => {
          calls.push("second");
        },
      }),
    );
    registerMiddleware(
      makeMw("third", 30, {
        post: async () => {
          calls.push("third");
        },
      }),
    );

    await runMiddlewarePipeline({ ctx: mockCtx, runLoop: makeRunLoop() });

    expect(calls).toEqual(["third", "second", "first"]);
  });

  it("abort in pre skips remaining pre middlewares", async () => {
    const calls: string[] = [];

    registerMiddleware(
      makeMw("first", 10, {
        pre: async (ctx) => {
          calls.push("first");
          ctx.abort("stop");
        },
      }),
    );
    registerMiddleware(
      makeMw("second", 20, {
        pre: async () => {
          calls.push("second");
        },
      }),
    );

    await runMiddlewarePipeline({ ctx: mockCtx, runLoop: makeRunLoop() });

    expect(calls).toEqual(["first"]);
  });

  it("abort in pre skips the prompt loop", async () => {
    const runLoop = makeRunLoop();

    registerMiddleware(
      makeMw("aborter", 10, {
        pre: async (ctx) => {
          ctx.abort("denied");
        },
      }),
    );

    const output = await runMiddlewarePipeline({ ctx: mockCtx, runLoop });

    expect(runLoop).not.toHaveBeenCalled();
    expect(output.result).toBeUndefined();
  });

  it("abort in pre still runs post middlewares (for cleanup)", async () => {
    const calls: string[] = [];

    registerMiddleware(
      makeMw("aborter", 10, {
        pre: async (ctx) => {
          ctx.abort("denied");
        },
        post: async () => {
          calls.push("post-aborter");
        },
      }),
    );
    registerMiddleware(
      makeMw("cleaner", 20, {
        post: async () => {
          calls.push("post-cleaner");
        },
      }),
    );

    await runMiddlewarePipeline({ ctx: mockCtx, runLoop: makeRunLoop() });

    // Post runs in reverse order regardless of abort
    expect(calls).toEqual(["post-cleaner", "post-aborter"]);
  });

  it("abortReason is included in output when aborted", async () => {
    registerMiddleware(
      makeMw("aborter", 10, {
        pre: async (ctx) => {
          ctx.abort("rate-limited");
        },
      }),
    );

    const output = await runMiddlewarePipeline({ ctx: mockCtx, runLoop: makeRunLoop() });

    expect(output.aborted).toBe(true);
    expect(output.abortReason).toBe("rate-limited");
  });

  it("error in pre middleware is caught and logged (non-fatal)", async () => {
    const runLoop = makeRunLoop();
    const calls: string[] = [];

    registerMiddleware(
      makeMw("broken", 10, {
        pre: async () => {
          throw new Error("boom");
        },
      }),
    );
    registerMiddleware(
      makeMw("healthy", 20, {
        pre: async () => {
          calls.push("healthy");
        },
      }),
    );

    const output = await runMiddlewarePipeline({ ctx: mockCtx, runLoop });

    // The healthy middleware still ran, and the loop executed
    expect(calls).toEqual(["healthy"]);
    expect(runLoop).toHaveBeenCalledOnce();
    expect(output.aborted).toBe(false);
  });

  it("error in post middleware is caught and logged (non-fatal)", async () => {
    const calls: string[] = [];

    registerMiddleware(
      makeMw("first", 10, {
        post: async () => {
          calls.push("first");
        },
      }),
    );
    registerMiddleware(
      makeMw("broken", 20, {
        post: async () => {
          throw new Error("post-boom");
        },
      }),
    );
    registerMiddleware(
      makeMw("third", 30, {
        post: async () => {
          calls.push("third");
        },
      }),
    );

    const output = await runMiddlewarePipeline({ ctx: mockCtx, runLoop: makeRunLoop() });

    // Reverse order: third runs, broken throws (caught), first runs
    expect(calls).toEqual(["third", "first"]);
    expect(output.aborted).toBe(false);
  });

  it("middleware with only pre (no post) works fine", async () => {
    const calls: string[] = [];

    registerMiddleware(
      makeMw("pre-only", 10, {
        pre: async () => {
          calls.push("pre");
        },
      }),
    );

    const output = await runMiddlewarePipeline({ ctx: mockCtx, runLoop: makeRunLoop() });

    expect(calls).toEqual(["pre"]);
    expect(output.aborted).toBe(false);
    expect(output.result).toBeDefined();
  });

  it("middleware with only post (no pre) works fine", async () => {
    const calls: string[] = [];

    registerMiddleware(
      makeMw("post-only", 10, {
        post: async () => {
          calls.push("post");
        },
      }),
    );

    const output = await runMiddlewarePipeline({ ctx: mockCtx, runLoop: makeRunLoop() });

    expect(calls).toEqual(["post"]);
    expect(output.aborted).toBe(false);
    expect(output.result).toBeDefined();
  });

  it("metadata map is shared across all middlewares", async () => {
    registerMiddleware(
      makeMw("writer", 10, {
        pre: async (ctx) => {
          ctx.metadata.set("key", "value-from-pre");
        },
      }),
    );
    registerMiddleware(
      makeMw("reader", 20, {
        pre: async (ctx) => {
          expect(ctx.metadata.get("key")).toBe("value-from-pre");
        },
        post: async (ctx) => {
          // Still accessible in post phase
          expect(ctx.metadata.get("key")).toBe("value-from-pre");
          ctx.metadata.set("postKey", 42);
        },
      }),
    );
    registerMiddleware(
      makeMw("post-reader", 10, {
        // order 10 means this runs AFTER reader (order 20) in post (reverse)
        post: async (ctx) => {
          expect(ctx.metadata.get("postKey")).toBe(42);
        },
      }),
    );

    const output = await runMiddlewarePipeline({ ctx: mockCtx, runLoop: makeRunLoop() });
    expect(output.aborted).toBe(false);
  });
});
