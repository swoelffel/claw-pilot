/**
 * runtime/__tests__/tool-system.test.ts
 *
 * Unit tests for Tool.define() factory and the tool registry.
 */

import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { Tool } from "../tool/tool.js";
import { getBuiltinTools, getTools } from "../tool/registry.js";

// ---------------------------------------------------------------------------
// Tool.define() factory
// ---------------------------------------------------------------------------

describe("Tool.define()", () => {
  it("returns a Tool.Info with the correct id", () => {
    const tool = Tool.define("test-tool", {
      description: "A test tool",
      parameters: z.object({ x: z.string() }),
      async execute(args) {
        return { title: "test", output: args.x, truncated: false };
      },
    });

    expect(tool.id).toBe("test-tool");
    expect(typeof tool.init).toBe("function");
  });

  it("executes successfully with valid args", async () => {
    const tool = Tool.define("echo", {
      description: "Echo tool",
      parameters: z.object({ message: z.string() }),
      async execute(args) {
        return { title: "echo", output: args.message, truncated: false };
      },
    });

    const def = await tool.init();
    const ctx: Tool.Context = {
      sessionId: "s1",
      messageId: "m1",
      agentId: "main",
      abort: new AbortController().signal,
      metadata: vi.fn(),
    };

    const result = await def.execute({ message: "hello" }, ctx);
    expect(result.output).toBe("hello");
    expect(result.truncated).toBe(false);
  });

  it("throws with clear message for invalid args", async () => {
    const tool = Tool.define("strict", {
      description: "Strict tool",
      parameters: z.object({ count: z.number() }),
      async execute(args) {
        return { title: "strict", output: String(args.count), truncated: false };
      },
    });

    const def = await tool.init();
    const ctx: Tool.Context = {
      sessionId: "s1",
      messageId: "m1",
      agentId: "main",
      abort: new AbortController().signal,
      metadata: vi.fn(),
    };

    await expect(def.execute({ count: "not-a-number" } as never, ctx)).rejects.toThrow(
      "invalid arguments",
    );
  });

  it("truncates output > 32_000 chars", async () => {
    const longOutput = "x".repeat(33_000);

    const tool = Tool.define("long-output", {
      description: "Long output tool",
      parameters: z.object({}),
      async execute() {
        return { title: "long", output: longOutput, truncated: false };
      },
    });

    const def = await tool.init();
    const ctx: Tool.Context = {
      sessionId: "s1",
      messageId: "m1",
      agentId: "main",
      abort: new AbortController().signal,
      metadata: vi.fn(),
    };

    const result = await def.execute({}, ctx);
    expect(result.truncated).toBe(true);
    expect(result.output.length).toBeLessThan(longOutput.length);
    expect(result.output).toContain("[Output truncated");
    expect(result.output).toContain("33000 chars total");
  });

  it("does not truncate output <= 32_000 chars", async () => {
    const output = "x".repeat(32_000);

    const tool = Tool.define("exact-limit", {
      description: "Exact limit tool",
      parameters: z.object({}),
      async execute() {
        return { title: "exact", output, truncated: false };
      },
    });

    const def = await tool.init();
    const ctx: Tool.Context = {
      sessionId: "s1",
      messageId: "m1",
      agentId: "main",
      abort: new AbortController().signal,
      metadata: vi.fn(),
    };

    const result = await def.execute({}, ctx);
    expect(result.truncated).toBe(false);
    expect(result.output.length).toBe(32_000);
  });

  it("supports lazy init via factory function", async () => {
    let initCalled = false;

    const tool = Tool.define("lazy", async () => {
      initCalled = true;
      return {
        description: "Lazy tool",
        parameters: z.object({ val: z.string() }),
        async execute(args) {
          return { title: "lazy", output: args.val, truncated: false };
        },
      };
    });

    expect(initCalled).toBe(false);
    await tool.init();
    expect(initCalled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

describe("getBuiltinTools()", () => {
  it("returns exactly 5 built-in tools", () => {
    const tools = getBuiltinTools();
    expect(tools).toHaveLength(5);
  });

  it("includes read, write, bash, glob, grep", () => {
    const tools = getBuiltinTools();
    const ids = tools.map((t) => t.id);
    expect(ids).toContain("read");
    expect(ids).toContain("write");
    expect(ids).toContain("bash");
    expect(ids).toContain("glob");
    expect(ids).toContain("grep");
  });
});

describe("getTools()", () => {
  it("returns the 5 built-in tools without customToolsDir", async () => {
    const tools = await getTools();
    expect(tools).toHaveLength(5);
  });

  it("returns built-ins when customToolsDir does not exist", async () => {
    const tools = await getTools({ customToolsDir: "/nonexistent/path/to/tools" });
    expect(tools).toHaveLength(5);
  });

  it("built-in stubs return placeholder output", async () => {
    const tools = await getTools();
    const readTool = tools.find((t) => t.id === "read");
    expect(readTool).toBeDefined();

    const def = await readTool!.init();
    const ctx: Tool.Context = {
      sessionId: "s1",
      messageId: "m1",
      agentId: "main",
      abort: new AbortController().signal,
      metadata: vi.fn(),
    };

    const result = await def.execute({ path: "/tmp/test.txt" }, ctx);
    expect(result.output).toContain("[stub]");
    expect(result.truncated).toBe(false);
  });
});
