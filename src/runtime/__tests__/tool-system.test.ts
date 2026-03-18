/**
 * runtime/__tests__/tool-system.test.ts
 *
 * Unit tests for Tool.define() factory and the tool registry.
 */

import { describe, it, expect, vi } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { Tool } from "../tool/tool.js";
import { getBuiltinTools, getTools } from "../tool/registry.js";
import {
  BashTool,
  WriteTool,
  EditTool,
  ReadTool,
  GlobTool,
  GrepTool,
  QuestionTool,
  MultiEditTool,
} from "../tool/built-in/index.js";

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
  it("returns 12 built-in tools (phase 2 + multiedit)", () => {
    const tools = getBuiltinTools();
    expect(tools).toHaveLength(12);
  });

  it("includes core tools: read, write, edit, bash, glob, grep", () => {
    const tools = getBuiltinTools();
    const ids = tools.map((t) => t.id);
    expect(ids).toContain("read");
    expect(ids).toContain("write");
    expect(ids).toContain("edit");
    expect(ids).toContain("bash");
    expect(ids).toContain("glob");
    expect(ids).toContain("grep");
  });

  it("includes extended tools: webfetch, question, todowrite, todoread, skill", () => {
    const tools = getBuiltinTools();
    const ids = tools.map((t) => t.id);
    expect(ids).toContain("webfetch");
    expect(ids).toContain("question");
    expect(ids).toContain("todowrite");
    expect(ids).toContain("todoread");
    expect(ids).toContain("skill");
  });
});

describe("getTools()", () => {
  it("returns 12 built-in tools without customToolsDir", async () => {
    const tools = await getTools();
    expect(tools).toHaveLength(12);
  });

  it("returns built-ins when customToolsDir does not exist", async () => {
    const tools = await getTools({ customToolsDir: "/nonexistent/path/to/tools" });
    expect(tools).toHaveLength(12);
  });

  it("excludes tools by ID when exclude option is provided", async () => {
    const tools = await getTools({ exclude: ["bash", "write", "edit"] });
    const ids = tools.map((t) => t.id);
    expect(ids).not.toContain("bash");
    expect(ids).not.toContain("write");
    expect(ids).not.toContain("edit");
    expect(ids).toContain("read");
    expect(tools).toHaveLength(9);
  });

  it("read tool has a real description (not a stub)", async () => {
    const tools = await getTools();
    const readTool = tools.find((t) => t.id === "read");
    expect(readTool).toBeDefined();

    const def = await readTool!.init();
    expect(def.description).not.toContain("[stub]");
    expect(def.description.length).toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------------------
// Tool profiles — getTools() with toolProfile option
// ---------------------------------------------------------------------------

describe("getTools() — toolProfile filtering", () => {
  /**
   * Objective: toolProfile "minimal" must return only the "question" tool.
   * Positive test: exactly 1 tool with id "question".
   */
  it('[positive] toolProfile "minimal" returns only question', async () => {
    // Arrange + Act
    const tools = await getTools({ toolProfile: "minimal" });
    const ids = tools.map((t) => t.id);

    // Assert
    expect(tools).toHaveLength(1);
    expect(ids).toContain("question");
  });

  /**
   * Objective: toolProfile "messaging" must return question + webfetch only.
   * Positive test: exactly 2 tools with the expected IDs.
   */
  it('[positive] toolProfile "messaging" returns question + webfetch', async () => {
    // Arrange + Act
    const tools = await getTools({ toolProfile: "messaging" });
    const ids = tools.map((t) => t.id);

    // Assert
    expect(tools).toHaveLength(2);
    expect(ids).toContain("question");
    expect(ids).toContain("webfetch");
  });

  /**
   * Objective: toolProfile "coding" must include the 11 coding tools but NOT "task".
   * Positive test: all expected coding tools present, "task" absent.
   */
  it('[positive] toolProfile "coding" includes coding tools but not task', async () => {
    // Arrange + Act
    const tools = await getTools({ toolProfile: "coding" });
    const ids = tools.map((t) => t.id);

    // Assert: all expected coding tools present
    expect(ids).toContain("read");
    expect(ids).toContain("write");
    expect(ids).toContain("edit");
    expect(ids).toContain("multiedit");
    expect(ids).toContain("bash");
    expect(ids).toContain("glob");
    expect(ids).toContain("grep");
    expect(ids).toContain("webfetch");
    expect(ids).toContain("question");
    expect(ids).toContain("todowrite");
    expect(ids).toContain("todoread");
    expect(ids).toContain("skill");
    // "task" must NOT be present in coding profile
    expect(ids).not.toContain("task");
    expect(tools).toHaveLength(12);
  });

  /**
   * Objective: toolProfile "full" must include all coding tools plus "task".
   * Note: "task" is a dynamic tool created by createTaskTool() and injected by the
   * prompt-loop — it is NOT in BUILTIN_TOOLS. TOOL_PROFILES["full"] lists "task" as
   * an allowed ID so that the prompt-loop can include it when building the toolset.
   * getTools() alone cannot return it since it only knows about BUILTIN_TOOLS.
   */
  it('[positive] toolProfile "full" includes all coding tools', async () => {
    // Arrange + Act
    const tools = await getTools({ toolProfile: "full" });
    const ids = tools.map((t) => t.id);

    // Assert: all coding tools are present
    expect(ids).toContain("read");
    expect(ids).toContain("bash");
    expect(ids).toContain("multiedit");
    expect(ids).toContain("skill");
    // "task" is NOT returned by getTools() — it is injected dynamically by the prompt-loop
    // via createTaskTool(). TOOL_PROFILES["full"] lists it as an allowed ID for that purpose.
    expect(ids).not.toContain("task");
  });

  /**
   * Objective: alsoAllow adds extra tools beyond the profile.
   * Positive test: messaging profile + alsoAllow:["bash"] → bash is included.
   */
  it("[positive] alsoAllow adds bash to messaging profile", async () => {
    // Arrange + Act
    const tools = await getTools({ toolProfile: "messaging", alsoAllow: ["bash"] });
    const ids = tools.map((t) => t.id);

    // Assert: messaging tools + bash
    expect(ids).toContain("question");
    expect(ids).toContain("webfetch");
    expect(ids).toContain("bash");
    expect(tools).toHaveLength(3);
  });

  /**
   * Objective: alsoAllow must not add duplicates if the tool is already in the profile.
   * Positive test: messaging + alsoAllow:["question"] → still 2 tools (no duplicate).
   */
  it("[positive] alsoAllow does not duplicate tools already in the profile", async () => {
    // Arrange + Act
    const tools = await getTools({ toolProfile: "messaging", alsoAllow: ["question"] });

    // Assert: no duplicate question
    const ids = tools.map((t) => t.id);
    const questionCount = ids.filter((id) => id === "question").length;
    expect(questionCount).toBe(1);
    expect(tools).toHaveLength(2);
  });

  /**
   * Objective: exclude must still work after profile filtering.
   * Positive test: coding profile + exclude:["bash"] → bash absent, others present.
   */
  it("[positive] exclude works after toolProfile filtering", async () => {
    // Arrange + Act
    const tools = await getTools({ toolProfile: "coding", exclude: ["bash"] });
    const ids = tools.map((t) => t.id);

    // Assert: bash excluded, other coding tools present
    expect(ids).not.toContain("bash");
    expect(ids).toContain("read");
    expect(ids).toContain("write");
    expect(tools).toHaveLength(11);
  });

  /**
   * Objective: without toolProfile, all 12 built-in tools are returned (unchanged behavior).
   * Negative test: no toolProfile → 12 tools (not filtered to any profile).
   */
  it("[negative] without toolProfile, all 12 built-in tools are returned", async () => {
    // Arrange + Act
    const tools = await getTools();

    // Assert: all 12 tools, not filtered
    expect(tools).toHaveLength(12);
  });

  /**
   * Objective: minimal profile must NOT include bash, write, edit, or other
   * coding tools — only question.
   * Negative test: coding tools are absent from minimal profile.
   */
  it('[negative] toolProfile "minimal" does not include coding tools', async () => {
    // Arrange + Act
    const tools = await getTools({ toolProfile: "minimal" });
    const ids = tools.map((t) => t.id);

    // Assert: no coding tools
    expect(ids).not.toContain("bash");
    expect(ids).not.toContain("write");
    expect(ids).not.toContain("edit");
    expect(ids).not.toContain("read");
    expect(ids).not.toContain("task");
  });
});

// ---------------------------------------------------------------------------
// ownerOnly flag on built-in tools
// ---------------------------------------------------------------------------

describe("ownerOnly flag on built-in tools", () => {
  /**
   * Objective: BashTool, WriteTool, EditTool, MultiEditTool must have
   * ownerOnly: true after init() — they must not be available to internal sub-agents.
   * Positive test: each of these tools has ownerOnly === true in their Definition.
   */
  it("[positive] BashTool has ownerOnly: true after init()", async () => {
    // Arrange + Act
    const def = await BashTool.init();

    // Assert: ownerOnly is explicitly true
    expect(def.ownerOnly).toBe(true);
  });

  it("[positive] WriteTool has ownerOnly: true after init()", async () => {
    const def = await WriteTool.init();
    expect(def.ownerOnly).toBe(true);
  });

  it("[positive] EditTool has ownerOnly: true after init()", async () => {
    const def = await EditTool.init();
    expect(def.ownerOnly).toBe(true);
  });

  it("[positive] MultiEditTool has ownerOnly: true after init()", async () => {
    const def = await MultiEditTool.init();
    expect(def.ownerOnly).toBe(true);
  });

  /**
   * Objective: ReadTool, GlobTool, GrepTool, QuestionTool must NOT have
   * ownerOnly — they are available to all agents including internal sub-agents.
   * Negative test: ownerOnly is falsy (undefined or false) for these tools.
   */
  it("[negative] ReadTool does NOT have ownerOnly", async () => {
    // Arrange + Act
    const def = await ReadTool.init();

    // Assert: ownerOnly is not set (undefined or false)
    expect(def.ownerOnly).toBeFalsy();
  });

  it("[negative] GlobTool does NOT have ownerOnly", async () => {
    const def = await GlobTool.init();
    expect(def.ownerOnly).toBeFalsy();
  });

  it("[negative] GrepTool does NOT have ownerOnly", async () => {
    const def = await GrepTool.init();
    expect(def.ownerOnly).toBeFalsy();
  });

  it("[negative] QuestionTool does NOT have ownerOnly", async () => {
    const def = await QuestionTool.init();
    expect(def.ownerOnly).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// ctx.workDir as search root for file tools
// ---------------------------------------------------------------------------

describe("ctx.workDir as search root", () => {
  /**
   * Objective: GlobTool and GrepTool must use ctx.workDir as their root directory
   * when no explicit `path` param is given, instead of process.cwd().
   * This ensures sub-agents launched from a daemon (where process.cwd() = "/") can
   * still find files in the instance workspace.
   */

  it("[positive] GlobTool uses ctx.workDir as root when path param is omitted", async () => {
    // Arrange: create a temp dir with a known file
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "claw-glob-test-"));
    try {
      await fs.writeFile(path.join(tmpDir, "TARGET.md"), "hello");

      const def = await GlobTool.init();
      const ctx: Tool.Context = {
        sessionId: "s1",
        messageId: "m1",
        agentId: "main",
        abort: new AbortController().signal,
        workDir: tmpDir,
        metadata: vi.fn(),
      };

      // Act
      const result = await def.execute({ pattern: "*.md" }, ctx);

      // Assert: found the file inside tmpDir, not searching from process.cwd()
      expect(result.output).toContain("TARGET.md");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("[positive] GlobTool uses ctx.workDir as root for relative path param", async () => {
    // Arrange
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "claw-glob-rel-"));
    try {
      await fs.mkdir(path.join(tmpDir, "sub"), { recursive: true });
      await fs.writeFile(path.join(tmpDir, "sub", "FOUND.md"), "content");

      const def = await GlobTool.init();
      const ctx: Tool.Context = {
        sessionId: "s1",
        messageId: "m1",
        agentId: "main",
        abort: new AbortController().signal,
        workDir: tmpDir,
        metadata: vi.fn(),
      };

      // Act: relative path resolved against workDir, not process.cwd()
      const result = await def.execute({ pattern: "*.md", path: "sub" }, ctx);

      // Assert
      expect(result.output).toContain("FOUND.md");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("[positive] GrepTool uses ctx.workDir as root when path param is omitted", async () => {
    // Arrange
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "claw-grep-test-"));
    try {
      await fs.writeFile(path.join(tmpDir, "notes.txt"), "hello workDir magic");

      const def = await GrepTool.init();
      const ctx: Tool.Context = {
        sessionId: "s1",
        messageId: "m1",
        agentId: "main",
        abort: new AbortController().signal,
        workDir: tmpDir,
        metadata: vi.fn(),
      };

      // Act
      const result = await def.execute({ pattern: "workDir magic" }, ctx);

      // Assert
      expect(result.output).toContain("notes.txt");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("[fallback] GlobTool falls back to process.cwd() when ctx.workDir is undefined", async () => {
    // Arrange: no workDir in ctx — must not throw, just use process.cwd()
    const def = await GlobTool.init();
    const ctx: Tool.Context = {
      sessionId: "s1",
      messageId: "m1",
      agentId: "main",
      abort: new AbortController().signal,
      // workDir intentionally omitted
      metadata: vi.fn(),
    };

    // Act — just ensure no exception thrown and result is a valid Tool.Result
    const result = await def.execute({ pattern: "*.json" }, ctx);
    expect(result).toHaveProperty("output");
    expect(result).toHaveProperty("truncated");
  });
});
