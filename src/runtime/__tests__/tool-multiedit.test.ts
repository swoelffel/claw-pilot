/**
 * runtime/__tests__/tool-multiedit.test.ts
 *
 * Unit tests for MultiEditTool — applies multiple find-and-replace edits
 * to a single file in one call.
 *
 * Tests use real temp files (os.tmpdir()) to avoid mocking the filesystem.
 * No LLM calls — execute() is called directly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { MultiEditTool } from "../tool/built-in/index.js";
import type { Tool } from "../tool/tool.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Tool.Context for direct execute() calls */
function makeCtx(): Tool.Context {
  return {
    sessionId: "s1",
    messageId: "m1",
    agentId: "main",
    abort: new AbortController().signal,
    metadata: vi.fn(),
  };
}

let tmpDir: string;
let tmpFile: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multiedit-test-"));
  tmpFile = path.join(tmpDir, "test.ts");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("MultiEditTool — happy path", () => {
  /**
   * Objective: 3 sequential edits on a file must all be applied in order,
   * and the file on disk must reflect all changes.
   * Positive test: write a file with 3 distinct strings, apply 3 edits,
   * verify the final file content.
   */
  it("[positive] applies 3 sequential edits correctly", async () => {
    // Arrange
    const original = `const a = "foo";\nconst b = "bar";\nconst c = "baz";\n`;
    await fs.writeFile(tmpFile, original, "utf-8");

    const def = await MultiEditTool.init();
    const ctx = makeCtx();

    // Act
    const result = await def.execute(
      {
        filePath: tmpFile,
        edits: [
          { oldString: '"foo"', newString: '"FOO"' },
          { oldString: '"bar"', newString: '"BAR"' },
          { oldString: '"baz"', newString: '"BAZ"' },
        ],
      },
      ctx,
    );

    // Assert: all 3 edits applied
    const content = await fs.readFile(tmpFile, "utf-8");
    expect(content).toContain('"FOO"');
    expect(content).toContain('"BAR"');
    expect(content).toContain('"BAZ"');
    expect(content).not.toContain('"foo"');
    expect(content).not.toContain('"bar"');
    expect(content).not.toContain('"baz"');
    expect(result.output).toContain("Applied 3/3 edits");
  });

  /**
   * Objective: replaceAll: true must replace every occurrence of oldString,
   * not just the first one.
   * Positive test: file with 3 occurrences of "TODO", replaceAll → all replaced.
   */
  it("[positive] replaceAll: true replaces all occurrences", async () => {
    // Arrange
    const original = `// TODO: fix this\n// TODO: fix that\n// TODO: fix other\n`;
    await fs.writeFile(tmpFile, original, "utf-8");

    const def = await MultiEditTool.init();
    const ctx = makeCtx();

    // Act
    await def.execute(
      {
        filePath: tmpFile,
        edits: [{ oldString: "TODO", newString: "DONE", replaceAll: true }],
      },
      ctx,
    );

    // Assert: all 3 occurrences replaced
    const content = await fs.readFile(tmpFile, "utf-8");
    expect(content).not.toContain("TODO");
    const doneCount = (content.match(/DONE/g) ?? []).length;
    expect(doneCount).toBe(3);
  });

  /**
   * Objective: when one edit fails (oldString not found) but others succeed,
   * the successful edits must be applied and the file written.
   * Positive test: 3 edits, middle one fails → 2 applied, file updated.
   */
  it("[positive] partial success: successful edits are applied even if one fails", async () => {
    // Arrange
    const original = `const x = 1;\nconst y = 2;\nconst z = 3;\n`;
    await fs.writeFile(tmpFile, original, "utf-8");

    const def = await MultiEditTool.init();
    const ctx = makeCtx();

    // Act
    const result = await def.execute(
      {
        filePath: tmpFile,
        edits: [
          { oldString: "const x = 1;", newString: "const x = 10;" },
          { oldString: "DOES_NOT_EXIST", newString: "whatever" }, // will fail
          { oldString: "const z = 3;", newString: "const z = 30;" },
        ],
      },
      ctx,
    );

    // Assert: 2 edits applied, 1 failed
    const content = await fs.readFile(tmpFile, "utf-8");
    expect(content).toContain("const x = 10;");
    expect(content).toContain("const z = 30;");
    expect(result.output).toContain("Applied 2/3 edits");
    expect(result.output).toContain("Failed edits:");
  });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe("MultiEditTool — error cases", () => {
  /**
   * Objective: when ALL edits fail, the file must NOT be written (no partial
   * corruption), and the output must describe the failures.
   * Negative test: all oldStrings absent → file unchanged, output reports failures.
   */
  it("[negative] all edits fail → file not modified, output reports failures", async () => {
    // Arrange
    const original = `const a = 1;\n`;
    await fs.writeFile(tmpFile, original, "utf-8");

    const def = await MultiEditTool.init();
    const ctx = makeCtx();

    // Act
    const result = await def.execute(
      {
        filePath: tmpFile,
        edits: [
          { oldString: "MISSING_1", newString: "x" },
          { oldString: "MISSING_2", newString: "y" },
        ],
      },
      ctx,
    );

    // Assert: file unchanged
    const content = await fs.readFile(tmpFile, "utf-8");
    expect(content).toBe(original);
    // Output describes failure
    expect(result.output).toContain("All edits failed");
    expect(result.title).toContain("failed");
  });

  /**
   * Objective: when the target file does not exist, MultiEditTool must throw
   * an Error (not silently fail or return an error result).
   * Negative test: non-existent file path → throws Error.
   */
  it("[negative] file not found → throws Error", async () => {
    // Arrange
    const nonExistentPath = path.join(tmpDir, "does-not-exist.ts");
    const def = await MultiEditTool.init();
    const ctx = makeCtx();

    // Act + Assert: must throw
    await expect(
      def.execute(
        {
          filePath: nonExistentPath,
          edits: [{ oldString: "anything", newString: "something" }],
        },
        ctx,
      ),
    ).rejects.toThrow("File not found");
  });

  /**
   * Objective: a single failing edit must be reported in the output with a
   * useful error message identifying which oldString was not found.
   * Negative test: 1 edit with absent oldString → output contains error info.
   */
  it("[negative] absent oldString is reported in the output", async () => {
    // Arrange
    const original = `const value = 42;\n`;
    await fs.writeFile(tmpFile, original, "utf-8");

    const def = await MultiEditTool.init();
    const ctx = makeCtx();

    // Act
    const result = await def.execute(
      {
        filePath: tmpFile,
        edits: [{ oldString: "NONEXISTENT_STRING", newString: "replacement" }],
      },
      ctx,
    );

    // Assert: output contains the failed edit marker
    expect(result.output).toContain("✗");
    expect(result.output).toContain("NONEXISTENT_STRING");
  });
});
