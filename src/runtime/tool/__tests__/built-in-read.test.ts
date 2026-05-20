/**
 * runtime/tool/__tests__/built-in-read.test.ts
 *
 * Unit tests for ReadTool and WriteTool built-in tools.
 * Uses real filesystem with temp directories for isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, symlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { Tool } from "../tool.js";
import { ReadTool } from "../built-in/read.js";
import { WriteTool } from "../built-in/write.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "read-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function makeCtx(overrides?: Partial<Tool.Context>): Tool.Context {
  return {
    sessionId: "sess-1" as Tool.Context["sessionId"],
    messageId: "msg-1" as Tool.Context["messageId"],
    agentId: "main",
    abort: new AbortController().signal,
    metadata: vi.fn(),
    workDir: tempDir,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ReadTool — file reading
// ---------------------------------------------------------------------------

describe("ReadTool", () => {
  describe("file reading", () => {
    it("reads a simple text file with line numbers", async () => {
      const filePath = path.join(tempDir, "hello.txt");
      await writeFile(filePath, "line one\nline two\nline three\n");

      const def = await ReadTool.init();
      const result = await def.execute({ filePath }, makeCtx());

      expect(result.output).toContain("<type>file</type>");
      expect(result.output).toContain("1: line one");
      expect(result.output).toContain("2: line two");
      expect(result.output).toContain("3: line three");
      expect(result.output).toContain("(End of file - total 3 lines)");
      expect(result.truncated).toBe(false);
    });

    it("respects offset parameter (skips lines)", async () => {
      const filePath = path.join(tempDir, "offset.txt");
      await writeFile(filePath, "a\nb\nc\nd\ne\n");

      const def = await ReadTool.init();
      const result = await def.execute({ filePath, offset: 3 }, makeCtx());

      expect(result.output).toContain("3: c");
      expect(result.output).toContain("4: d");
      expect(result.output).not.toContain("1: a");
      expect(result.output).not.toContain("2: b");
    });

    it("respects limit parameter (truncates)", async () => {
      const filePath = path.join(tempDir, "limit.txt");
      await writeFile(filePath, "a\nb\nc\nd\ne\n");

      const def = await ReadTool.init();
      const result = await def.execute({ filePath, limit: 2 }, makeCtx());

      expect(result.output).toContain("1: a");
      expect(result.output).toContain("2: b");
      expect(result.output).not.toContain("3: c");
      expect(result.truncated).toBe(true);
    });

    it("offset + limit together work correctly", async () => {
      const filePath = path.join(tempDir, "both.txt");
      await writeFile(filePath, "a\nb\nc\nd\ne\n");

      const def = await ReadTool.init();
      const result = await def.execute({ filePath, offset: 2, limit: 2 }, makeCtx());

      expect(result.output).toContain("2: b");
      expect(result.output).toContain("3: c");
      expect(result.output).not.toContain("1: a");
      expect(result.output).not.toContain("4: d");
      expect(result.output).toContain("Use offset=4 to continue");
      expect(result.truncated).toBe(true);
    });

    it("throws error for non-existent file", async () => {
      const filePath = path.join(tempDir, "does-not-exist.txt");

      const def = await ReadTool.init();
      await expect(def.execute({ filePath }, makeCtx())).rejects.toThrow("File not found");
    });

    it("suggests similar filenames when file not found", async () => {
      // Create a file with a similar name
      await writeFile(path.join(tempDir, "config.json"), "{}");

      const def = await ReadTool.init();
      await expect(
        def.execute({ filePath: path.join(tempDir, "config") }, makeCtx()),
      ).rejects.toThrow(/Did you mean one of these/);
    });

    it("throws error for binary file extension (.zip)", async () => {
      const filePath = path.join(tempDir, "archive.zip");
      await writeFile(filePath, "fake binary content");

      const def = await ReadTool.init();
      await expect(def.execute({ filePath }, makeCtx())).rejects.toThrow("Cannot read binary file");
    });

    it("truncates long lines (> MAX_LINE_LENGTH=2000 chars)", async () => {
      const filePath = path.join(tempDir, "long.txt");
      const longLine = "x".repeat(3000);
      await writeFile(filePath, longLine);

      const def = await ReadTool.init();
      const result = await def.execute({ filePath }, makeCtx());

      expect(result.output).toContain("line truncated to 2000 chars");
      // The truncated line should have exactly 2000 chars of x before the truncation notice
      expect(result.output).toContain("x".repeat(2000) + "... (line truncated to 2000 chars)");
    });
  });

  // ---------------------------------------------------------------------------
  // ReadTool — directory listing
  // ---------------------------------------------------------------------------

  describe("directory listing", () => {
    it("lists directory entries sorted alphabetically", async () => {
      await writeFile(path.join(tempDir, "zebra.txt"), "z");
      await writeFile(path.join(tempDir, "alpha.txt"), "a");
      await mkdir(path.join(tempDir, "middle-dir"));

      const def = await ReadTool.init();
      const result = await def.execute({ filePath: tempDir }, makeCtx());

      expect(result.output).toContain("<type>directory</type>");
      expect(result.output).toContain("<entries>");

      // Verify sorted: alpha.txt < middle-dir/ < zebra.txt
      const entriesMatch = result.output.match(/<entries>\n([\s\S]*?)\n\(/);
      expect(entriesMatch).toBeTruthy();
      const entries = entriesMatch![1]!.split("\n").filter(Boolean);
      expect(entries).toEqual(["alpha.txt", "middle-dir/", "zebra.txt"]);
    });

    it("directories get '/' suffix", async () => {
      await mkdir(path.join(tempDir, "subdir"));
      await writeFile(path.join(tempDir, "file.txt"), "data");

      const def = await ReadTool.init();
      const result = await def.execute({ filePath: tempDir }, makeCtx());

      expect(result.output).toContain("subdir/");
      expect(result.output).not.toContain("file.txt/");
    });

    it("respects offset/limit for directory listing", async () => {
      await writeFile(path.join(tempDir, "a.txt"), "");
      await writeFile(path.join(tempDir, "b.txt"), "");
      await writeFile(path.join(tempDir, "c.txt"), "");
      await writeFile(path.join(tempDir, "d.txt"), "");

      const def = await ReadTool.init();
      const result = await def.execute({ filePath: tempDir, offset: 2, limit: 2 }, makeCtx());

      expect(result.output).toContain("b.txt");
      expect(result.output).toContain("c.txt");
      expect(result.output).not.toContain("a.txt");
    });

    it("reports truncated when more entries exist", async () => {
      await writeFile(path.join(tempDir, "a.txt"), "");
      await writeFile(path.join(tempDir, "b.txt"), "");
      await writeFile(path.join(tempDir, "c.txt"), "");

      const def = await ReadTool.init();
      const result = await def.execute({ filePath: tempDir, limit: 2 }, makeCtx());

      expect(result.truncated).toBe(true);
      expect(result.output).toContain("Showing 2 of 3 entries");
    });
  });

  // ---------------------------------------------------------------------------
  // ReadTool — edge cases
  // ---------------------------------------------------------------------------

  describe("edge cases", () => {
    it("resolves relative path from workDir", async () => {
      await writeFile(path.join(tempDir, "relative.txt"), "hello relative");

      const def = await ReadTool.init();
      const result = await def.execute({ filePath: "relative.txt" }, makeCtx());

      expect(result.output).toContain("hello relative");
      expect(result.output).toContain(`<path>${path.join(tempDir, "relative.txt")}</path>`);
    });

    it("empty file returns no content lines", async () => {
      const filePath = path.join(tempDir, "empty.txt");
      await writeFile(filePath, "");

      const def = await ReadTool.init();
      const result = await def.execute({ filePath }, makeCtx());

      expect(result.output).toContain("<type>file</type>");
      expect(result.output).toContain("(End of file - total 0 lines)");
      expect(result.truncated).toBe(false);
    });

    it("offset beyond file length throws error", async () => {
      const filePath = path.join(tempDir, "short.txt");
      await writeFile(filePath, "one\ntwo\n");

      const def = await ReadTool.init();
      await expect(def.execute({ filePath, offset: 100 }, makeCtx())).rejects.toThrow(
        /Offset 100 is out of range/,
      );
    });

    it.skipIf(process.platform === "win32")("resolves symlink directory entries", async () => {
      const targetDir = path.join(tempDir, "target-dir");
      await mkdir(targetDir);
      await symlink(targetDir, path.join(tempDir, "link-to-dir"));

      const def = await ReadTool.init();
      const result = await def.execute({ filePath: tempDir }, makeCtx());

      // Symlink pointing to a directory should get "/" suffix
      expect(result.output).toContain("link-to-dir/");
      expect(result.output).toContain("target-dir/");
    });
  });
});

// ---------------------------------------------------------------------------
// WriteTool
// ---------------------------------------------------------------------------

describe("WriteTool", () => {
  it("creates a new file and returns 'Created file successfully.'", async () => {
    const filePath = path.join(tempDir, "new-file.txt");

    const def = await WriteTool.init();
    const result = await def.execute({ filePath, content: "hello world" }, makeCtx());

    expect(result.output).toBe("Created file successfully.");
    expect(result.title).toBe("new-file.txt");

    const content = await readFile(filePath, "utf-8");
    expect(content).toBe("hello world");
  });

  it("overwrites existing file and returns 'Wrote file successfully.'", async () => {
    const filePath = path.join(tempDir, "existing.txt");
    await writeFile(filePath, "old content");

    const def = await WriteTool.init();
    const result = await def.execute({ filePath, content: "new content" }, makeCtx());

    expect(result.output).toBe("Wrote file successfully.");

    const content = await readFile(filePath, "utf-8");
    expect(content).toBe("new content");
  });

  it("creates parent directories automatically", async () => {
    const filePath = path.join(tempDir, "deep", "nested", "dir", "file.txt");

    const def = await WriteTool.init();
    const result = await def.execute({ filePath, content: "deep content" }, makeCtx());

    expect(result.output).toBe("Created file successfully.");

    const content = await readFile(filePath, "utf-8");
    expect(content).toBe("deep content");
  });

  it("resolves relative path from workDir", async () => {
    const def = await WriteTool.init();
    const result = await def.execute(
      { filePath: "relative-write.txt", content: "relative" },
      makeCtx(),
    );

    expect(result.output).toBe("Created file successfully.");

    const content = await readFile(path.join(tempDir, "relative-write.txt"), "utf-8");
    expect(content).toBe("relative");
  });

  it("tool is marked ownerOnly", async () => {
    const def = await WriteTool.init();
    expect(def.ownerOnly).toBe(true);
  });
});
