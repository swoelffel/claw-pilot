// src/runtime/memory/__tests__/writer.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs");
vi.mock("ai");

import fs from "node:fs";
import { generateText } from "ai";
import { appendToMemoryFile, consolidateMemoryFileIfNeeded } from "../writer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stub ResolvedModel for consolidation tests */
function fakeResolvedModel() {
  return { languageModel: {} } as Parameters<typeof consolidateMemoryFileIfNeeded>[2];
}

// ---------------------------------------------------------------------------
// appendToMemoryFile
// ---------------------------------------------------------------------------

describe("appendToMemoryFile", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: file does not exist yet
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
  });

  it("does nothing for empty entries", () => {
    appendToMemoryFile("/workspace", "facts.md", []);
    expect(fs.mkdirSync).not.toHaveBeenCalled();
    expect(fs.appendFileSync).not.toHaveBeenCalled();
  });

  it("creates memory dir if needed", () => {
    appendToMemoryFile("/workspace", "facts.md", ["A new fact"]);
    expect(fs.mkdirSync).toHaveBeenCalledWith("/workspace/memory", { recursive: true });
  });

  it("appends entries with [1.0] prefix and date header", () => {
    appendToMemoryFile("/workspace", "facts.md", ["Fact A", "Fact B"]);
    expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
    const written = vi.mocked(fs.appendFileSync).mock.calls[0]![1] as string;
    // Should contain date header
    expect(written).toMatch(/## \d{4}-\d{2}-\d{2}/);
    // Should contain prefixed entries
    expect(written).toContain("- [1.0] Fact A");
    expect(written).toContain("- [1.0] Fact B");
  });

  it("deduplicates existing entries (case-insensitive)", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("- [1.0] existing fact\n");
    appendToMemoryFile("/workspace", "facts.md", ["Existing Fact", "Brand new fact"]);
    const written = vi.mocked(fs.appendFileSync).mock.calls[0]![1] as string;
    // "Existing Fact" matches "existing fact" (case-insensitive) -> filtered
    expect(written).not.toContain("Existing Fact");
    expect(written).toContain("- [1.0] Brand new fact");
  });

  it("creates file when it doesn't exist (appendFileSync on missing file)", () => {
    // readFileSync throws (file absent), but appendFileSync should still be called
    appendToMemoryFile("/workspace", "facts.md", ["New entry"]);
    expect(fs.appendFileSync).toHaveBeenCalledWith(
      "/workspace/memory/facts.md",
      expect.stringContaining("- [1.0] New entry"),
      "utf-8",
    );
  });
});

// ---------------------------------------------------------------------------
// consolidateMemoryFileIfNeeded
// ---------------------------------------------------------------------------

describe("consolidateMemoryFileIfNeeded", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns false when file doesn't exist", async () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const result = await consolidateMemoryFileIfNeeded("/ws", "facts.md", fakeResolvedModel());
    expect(result).toBe(false);
  });

  it("returns false when line count <= 150", async () => {
    // 10 lines -> no consolidation
    vi.mocked(fs.readFileSync).mockReturnValue("line\n".repeat(10));
    const result = await consolidateMemoryFileIfNeeded("/ws", "facts.md", fakeResolvedModel());
    expect(result).toBe(false);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("calls generateText and rewrites file when > 150 lines", async () => {
    const longContent = Array.from({ length: 200 }, (_, i) => `- [1.0] Fact ${i}`).join("\n");
    vi.mocked(fs.readFileSync).mockReturnValue(longContent);
    vi.mocked(generateText).mockResolvedValue({
      text: "Consolidated content that is definitely longer than fifty characters for the check",
    } as Awaited<ReturnType<typeof generateText>>);

    const result = await consolidateMemoryFileIfNeeded("/ws", "facts.md", fakeResolvedModel());
    expect(result).toBe(true);
    expect(generateText).toHaveBeenCalledTimes(1);
    // Should backup, write consolidated, then delete backup
    expect(fs.copyFileSync).toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalled();
    expect(fs.unlinkSync).toHaveBeenCalled();
    const written = vi.mocked(fs.writeFileSync).mock.calls[0]![1] as string;
    expect(written).toContain("Consolidated content");
  });

  it("preserves original on LLM failure", async () => {
    const longContent = Array.from({ length: 200 }, (_, i) => `- [1.0] Fact ${i}`).join("\n");
    vi.mocked(fs.readFileSync).mockReturnValue(longContent);
    vi.mocked(generateText).mockRejectedValue(new Error("API error"));

    const result = await consolidateMemoryFileIfNeeded("/ws", "facts.md", fakeResolvedModel());
    expect(result).toBe(false);
    // Should NOT write anything on failure
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("returns false when LLM response is too short (<=50 chars)", async () => {
    const longContent = Array.from({ length: 200 }, (_, i) => `- [1.0] Fact ${i}`).join("\n");
    vi.mocked(fs.readFileSync).mockReturnValue(longContent);
    vi.mocked(generateText).mockResolvedValue({
      text: "Too short",
    } as Awaited<ReturnType<typeof generateText>>);

    const result = await consolidateMemoryFileIfNeeded("/ws", "facts.md", fakeResolvedModel());
    expect(result).toBe(false);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
});
