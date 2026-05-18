// src/runtime/tool/__tests__/built-in-bash.test.ts
//
// Tests for BashTool, WebFetchTool, and QuestionTool built-in tools.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import type { Tool } from "../tool.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("nanoid", () => ({ nanoid: () => "test-question-id" }));

vi.mock("../../bus/index.js", () => ({
  getBus: vi.fn(() => ({ publish: vi.fn() })),
}));

// Mock child_process.spawn for BashTool execute tests
const mockSpawn = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeCtx(overrides?: Partial<Tool.Context>): Tool.Context {
  return {
    sessionId: "sess-1",
    messageId: "msg-1",
    agentId: "test:main",
    abort: new AbortController().signal,
    metadata: vi.fn(),
    workDir: "/tmp/test-workspace",
    ...overrides,
  };
}

// =========================================================================
// BashTool
// =========================================================================

describe("BashTool", () => {
  // Import at top level — detectExternalPaths is a pure export
  let detectExternalPaths: (typeof import("../built-in/bash.js"))["detectExternalPaths"];
  let BashTool: (typeof import("../built-in/bash.js"))["BashTool"];

  beforeEach(async () => {
    const mod = await import("../built-in/bash.js");
    detectExternalPaths = mod.detectExternalPaths;
    BashTool = mod.BashTool;
  });

  // -----------------------------------------------------------------------
  // detectExternalPaths (pure function)
  // -----------------------------------------------------------------------

  describe("detectExternalPaths", () => {
    it("returns empty for paths within workDir", () => {
      const result = detectExternalPaths("cat /tmp/test-workspace/file.txt", "/tmp/test-workspace");
      expect(result).toEqual([]);
    });

    it("returns empty for allowed system paths", () => {
      const result = detectExternalPaths("/usr/bin/ls /bin/echo", "/tmp/test-workspace");
      expect(result).toEqual([]);
    });

    it("detects external paths outside workDir", () => {
      const result = detectExternalPaths("cat /home/user/secret.txt", "/tmp/test-workspace");
      expect(result).toContain("/home/user/secret.txt");
    });

    it("handles multiple paths in one command", () => {
      const result = detectExternalPaths(
        "cp /home/user/a.txt /opt/data/b.txt /usr/bin/ls",
        "/tmp/test-workspace",
      );
      expect(result).toContain("/home/user/a.txt");
      expect(result).toContain("/opt/data/b.txt");
      // /usr/bin/ls is allowed
      expect(result).not.toContain("/usr/bin/ls");
      expect(result).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // execute
  // -----------------------------------------------------------------------

  /** Create a fake child process that emits exit after writing to stdout */
  function fakeProc(stdout: string, exitCode = 0) {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      pid: number;
      kill: () => void;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.pid = 12345;
    proc.kill = vi.fn();
    // Emit data + exit on next tick
    setTimeout(() => {
      proc.stdout.emit("data", Buffer.from(stdout));
      proc.emit("exit", exitCode, null);
    }, 5);
    return proc;
  }

  /** Create a fake child process that never exits until killed (for timeout tests) */
  function hangingProc() {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      pid: number;
      kill: () => void;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.pid = 12345;
    proc.kill = vi.fn(() => {
      setTimeout(() => proc.emit("exit", null, "SIGTERM"), 5);
    });
    // The source code calls process.kill(-proc.pid, "SIGTERM") on non-win32
    const origProcessKill = process.kill;
    vi.spyOn(process, "kill").mockImplementation((...args: unknown[]) => {
      const sig = args[0] as number;
      // Negative PID = process group kill used by bash tool
      if (sig === -12345) {
        setTimeout(() => proc.emit("exit", null, "SIGTERM"), 5);
        return true;
      }
      return origProcessKill.call(process, ...(args as Parameters<typeof origProcessKill>));
    });
    return proc;
  }

  describe("execute", () => {
    afterEach(() => mockSpawn.mockReset());

    it("executes simple command and returns output", async () => {
      mockSpawn.mockReturnValueOnce(fakeProc("hello\n"));
      const def = await BashTool.init();
      const ctx = makeCtx();
      const result = await def.execute({ command: 'echo "hello"', description: "echo hello" }, ctx);
      expect(result.output.trim()).toBe("hello");
      expect(result.title).toBe("echo hello");
      expect(result.truncated).toBe(false);
    });

    it("returns output with timeout metadata when command times out", async () => {
      mockSpawn.mockReturnValueOnce(hangingProc());
      const def = await BashTool.init();
      const ctx = makeCtx();
      const result = await def.execute(
        { command: "sleep 60", description: "long sleep", timeout: 50 },
        ctx,
      );
      expect(result.output).toContain("<bash_metadata>");
      expect(result.output).toContain("timeout");
    });

    it("blocks sub-agent external path access (senderIsOwner=false)", async () => {
      const def = await BashTool.init();
      const ctx = makeCtx({ senderIsOwner: false });
      // spawn should NOT be called — access is denied before spawn
      const result = await def.execute(
        { command: "cat /home/user/secret.txt", description: "read secret" },
        ctx,
      );
      expect(result.output).toContain("Access denied");
      expect(result.output).toContain("/home/user/secret.txt");
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it("allows owner to use external paths (senderIsOwner=true)", async () => {
      mockSpawn.mockReturnValueOnce(fakeProc("/home/user/path\n"));
      const def = await BashTool.init();
      const ctx = makeCtx({ senderIsOwner: true });
      const result = await def.execute(
        { command: "echo /home/user/path", description: "echo path" },
        ctx,
      );
      expect(result.output).not.toContain("Access denied");
      expect(mockSpawn).toHaveBeenCalledOnce();
    });

    it("allows owner to use external paths (senderIsOwner=undefined)", async () => {
      mockSpawn.mockReturnValueOnce(fakeProc("/home/user/path\n"));
      const def = await BashTool.init();
      const ctx = makeCtx();
      const result = await def.execute(
        { command: "echo /home/user/path", description: "echo path" },
        ctx,
      );
      expect(result.output).not.toContain("Access denied");
      expect(mockSpawn).toHaveBeenCalledOnce();
    });
  });
});

// =========================================================================
// WebFetchTool
// =========================================================================

describe("WebFetchTool", () => {
  const mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);

  afterEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", mockFetch);
  });

  // Helper to create a minimal Response-like object
  function makeResponse(
    body: string,
    init?: { status?: number; headers?: Record<string, string> },
  ) {
    const status = init?.status ?? 200;
    const headers = new Headers(init?.headers ?? { "content-type": "text/plain" });
    const buf = new TextEncoder().encode(body).buffer;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers,
      arrayBuffer: () => Promise.resolve(buf),
    } as unknown as Response;
  }

  it("throws error for non-http URL", async () => {
    const { WebFetchTool } = await import("../built-in/web-fetch.js");
    const def = await WebFetchTool.init();
    const ctx = makeCtx();
    await expect(def.execute({ url: "ftp://example.com", format: "text" }, ctx)).rejects.toThrow(
      "URL must start with http:// or https://",
    );
  });

  it("fetches URL and returns content", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse("Hello World"));
    const { WebFetchTool } = await import("../built-in/web-fetch.js");
    const def = await WebFetchTool.init();
    const ctx = makeCtx();
    const result = await def.execute({ url: "https://example.com", format: "text" }, ctx);
    expect(result.output).toBe("Hello World");
    expect(result.truncated).toBe(false);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("throws error for non-ok response (status 404)", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse("Not Found", { status: 404 }));
    const { WebFetchTool } = await import("../built-in/web-fetch.js");
    const def = await WebFetchTool.init();
    const ctx = makeCtx();
    await expect(
      def.execute({ url: "https://example.com/missing", format: "text" }, ctx),
    ).rejects.toThrow("status code: 404");
  });

  it("throws error when content-length exceeds 5MB", async () => {
    const headers = {
      "content-type": "text/plain",
      "content-length": String(6 * 1024 * 1024),
    };
    mockFetch.mockResolvedValueOnce(makeResponse("x", { headers }));
    const { WebFetchTool } = await import("../built-in/web-fetch.js");
    const def = await WebFetchTool.init();
    const ctx = makeCtx();
    await expect(
      def.execute({ url: "https://example.com/big", format: "text" }, ctx),
    ).rejects.toThrow("5MB");
  });

  it("converts HTML to markdown when format=markdown", async () => {
    const html = '<h1>Title</h1><p>Hello</p><a href="https://x.com">link</a>';
    const headers = { "content-type": "text/html" };
    mockFetch.mockResolvedValueOnce(makeResponse(html, { headers }));
    const { WebFetchTool } = await import("../built-in/web-fetch.js");
    const def = await WebFetchTool.init();
    const ctx = makeCtx();
    const result = await def.execute({ url: "https://example.com", format: "markdown" }, ctx);
    expect(result.output).toContain("# Title");
    expect(result.output).toContain("[link](https://x.com)");
  });

  it("converts HTML to text when format=text", async () => {
    const html = "<h1>Title</h1><p>Hello world</p>";
    const headers = { "content-type": "text/html" };
    mockFetch.mockResolvedValueOnce(makeResponse(html, { headers }));
    const { WebFetchTool } = await import("../built-in/web-fetch.js");
    const def = await WebFetchTool.init();
    const ctx = makeCtx();
    const result = await def.execute({ url: "https://example.com", format: "text" }, ctx);
    // Should have tags stripped
    expect(result.output).not.toContain("<h1>");
    expect(result.output).toContain("Title");
    expect(result.output).toContain("Hello world");
  });

  it("returns raw content for non-HTML responses", async () => {
    const json = '{"key":"value"}';
    const headers = { "content-type": "application/json" };
    mockFetch.mockResolvedValueOnce(makeResponse(json, { headers }));
    const { WebFetchTool } = await import("../built-in/web-fetch.js");
    const def = await WebFetchTool.init();
    const ctx = makeCtx();
    const result = await def.execute(
      { url: "https://api.example.com/data", format: "markdown" },
      ctx,
    );
    // Non-HTML content is returned as-is regardless of format
    expect(result.output).toBe(json);
  });

  it("htmlToMarkdown converts headings and links correctly", async () => {
    const html = '<h2>Section</h2><h3>Sub</h3><a href="/page">Click</a><code>inline</code>';
    const headers = { "content-type": "text/html" };
    mockFetch.mockResolvedValueOnce(makeResponse(html, { headers }));
    const { WebFetchTool } = await import("../built-in/web-fetch.js");
    const def = await WebFetchTool.init();
    const ctx = makeCtx();
    const result = await def.execute({ url: "https://example.com", format: "markdown" }, ctx);
    expect(result.output).toContain("## Section");
    expect(result.output).toContain("### Sub");
    expect(result.output).toContain("[Click](/page)");
    expect(result.output).toContain("`inline`");
  });
});

// =========================================================================
// QuestionTool
// =========================================================================

describe("QuestionTool", () => {
  let resolveQuestion: (typeof import("../built-in/question.js"))["resolveQuestion"];
  let rejectQuestion: (typeof import("../built-in/question.js"))["rejectQuestion"];
  let QuestionTool: (typeof import("../built-in/question.js"))["QuestionTool"];

  beforeEach(async () => {
    const mod = await import("../built-in/question.js");
    resolveQuestion = mod.resolveQuestion;
    rejectQuestion = mod.rejectQuestion;
    QuestionTool = mod.QuestionTool;
    // Reset the resolved-IDs set so dedup state doesn't bleed across tests.
    mod.clearResolvedIds();
  });

  // -----------------------------------------------------------------------
  // resolveQuestion / rejectQuestion (pure functions)
  // -----------------------------------------------------------------------

  describe("resolveQuestion", () => {
    it("returns false for unknown questionId", () => {
      expect(resolveQuestion("unknown-id", "answer")).toBe(false);
    });

    it("resolves the pending promise", async () => {
      const def = await QuestionTool.init();
      const ctx = makeCtx();

      // Start execute (it will wait for answer)
      const resultPromise = def.execute({ question: "Continue?" }, ctx);

      // Wait a tick for the pending question to be registered
      await new Promise((r) => setTimeout(r, 10));

      // Resolve with known ID (nanoid is mocked to return "test-question-id")
      const found = resolveQuestion("test-question-id", "yes");
      expect(found).toBe(true);

      const result = await resultPromise;
      expect(result.output).toContain("yes");
    });
  });

  describe("rejectQuestion", () => {
    it("returns false for unknown questionId", () => {
      expect(rejectQuestion("unknown-id", "cancelled")).toBe(false);
    });

    it("rejects the pending promise", async () => {
      const def = await QuestionTool.init();
      const ctx = makeCtx();

      const resultPromise = def.execute({ question: "Proceed?" }, ctx);

      await new Promise((r) => setTimeout(r, 10));

      const found = rejectQuestion("test-question-id", "Session ended");
      expect(found).toBe(true);

      await expect(resultPromise).rejects.toThrow("Session ended");
    });
  });

  // -----------------------------------------------------------------------
  // execute
  // -----------------------------------------------------------------------

  describe("execute", () => {
    it("publishes QuestionAsked event and resolves when answered", async () => {
      const { getBus } = await import("../../bus/index.js");
      const mockPublish = vi.fn();
      vi.mocked(getBus).mockReturnValue({ publish: mockPublish } as never);

      const def = await QuestionTool.init();
      const ctx = makeCtx();

      const resultPromise = def.execute({ question: "Continue?" }, ctx);

      await new Promise((r) => setTimeout(r, 10));

      // Verify event was published
      expect(mockPublish).toHaveBeenCalledOnce();
      expect(mockPublish).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          questionId: "test-question-id",
          sessionId: "sess-1",
          question: "Continue?",
        }),
      );

      // Resolve the question
      resolveQuestion("test-question-id", "Yes, go ahead");
      const result = await resultPromise;
      expect(result.title).toContain("Continue?");
      expect(result.output).toContain("Yes, go ahead");
    });
  });
});
