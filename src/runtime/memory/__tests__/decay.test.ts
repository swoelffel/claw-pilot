// src/runtime/memory/__tests__/decay.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs");
import * as fs from "node:fs";

import { parseMemoryEntry, applyDecayToFile, extractReferencedContents } from "../decay.js";

// ---------------------------------------------------------------------------
// parseMemoryEntry
// ---------------------------------------------------------------------------

describe("parseMemoryEntry", () => {
  it("returns null for empty line", () => {
    expect(parseMemoryEntry("")).toBeNull();
    expect(parseMemoryEntry("   ")).toBeNull();
  });

  it("returns null for non-entry line (no '- ' prefix)", () => {
    expect(parseMemoryEntry("## Header")).toBeNull();
    expect(parseMemoryEntry("Some plain text")).toBeNull();
    expect(parseMemoryEntry("# Title")).toBeNull();
  });

  it("parses scored entry '- [0.8] content'", () => {
    const result = parseMemoryEntry("- [0.8] The project uses TypeScript");
    expect(result).toEqual({
      score: 0.8,
      content: "The project uses TypeScript",
      raw: "- [0.8] The project uses TypeScript",
    });
  });

  it("parses legacy entry (no score) as score 1.0", () => {
    const result = parseMemoryEntry("- The project uses TypeScript");
    expect(result).toEqual({
      score: 1.0,
      content: "The project uses TypeScript",
      raw: "- The project uses TypeScript",
    });
  });

  it("handles whitespace in line", () => {
    const result = parseMemoryEntry("  - [0.5] Indented entry  ");
    expect(result).not.toBeNull();
    expect(result!.score).toBe(0.5);
    expect(result!.content).toBe("Indented entry");
  });
});

// ---------------------------------------------------------------------------
// extractReferencedContents
// ---------------------------------------------------------------------------

describe("extractReferencedContents", () => {
  it("splits on sentence boundaries", () => {
    const result = extractReferencedContents(
      "This is a fairly long first sentence. This is a fairly long second sentence!",
    );
    expect(result.size).toBe(2);
    expect(result.has("This is a fairly long first sentence")).toBe(true);
    expect(result.has("This is a fairly long second sentence")).toBe(true);
  });

  it("filters short sentences (<=20 chars)", () => {
    const result = extractReferencedContents(
      "Short. This is a sentence that is long enough to pass.",
    );
    // "Short" has 5 chars -> filtered out
    expect(result.size).toBe(1);
    expect([...result][0]).toBe("This is a sentence that is long enough to pass");
  });

  it("returns empty set for empty text", () => {
    const result = extractReferencedContents("");
    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// applyDecayToFile
// ---------------------------------------------------------------------------

describe("applyDecayToFile", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns {0,0} for missing file", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const result = applyDecayToFile("/missing.md", new Set());
    expect(result).toEqual({ updated: 0, removed: 0 });
  });

  it("preserves non-entry lines (headers, comments)", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("# Title\n\nSome comment\n");
    applyDecayToFile("/test.md", new Set());
    expect(fs.writeFileSync).toHaveBeenCalledWith("/test.md", "# Title\n\nSome comment\n", "utf-8");
  });

  it("decrements score of unreferenced entries by 0.1", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("- [1.0] Unreferenced fact");
    applyDecayToFile("/test.md", new Set());
    expect(fs.writeFileSync).toHaveBeenCalledWith("/test.md", "- [0.9] Unreferenced fact", "utf-8");
  });

  it("resets referenced entries to score 1.0", () => {
    // The entry snippet (first 40 chars lowercase) must be found in a referenced content
    vi.mocked(fs.readFileSync).mockReturnValue("- [0.5] The project uses typescript strict mode");
    const refs = new Set(["The project uses typescript strict mode is important"]);
    applyDecayToFile("/test.md", refs);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      "/test.md",
      "- [1.0] The project uses typescript strict mode",
      "utf-8",
    );
  });

  it("removes entries below threshold 0.3", () => {
    // Score 0.3 - 0.1 = 0.2 < 0.3 threshold -> removed
    vi.mocked(fs.readFileSync).mockReturnValue("- [0.3] Old fact");
    const result = applyDecayToFile("/test.md", new Set());
    expect(result.removed).toBe(1);
    // Only empty string left (no entry lines)
    expect(fs.writeFileSync).toHaveBeenCalledWith("/test.md", "", "utf-8");
  });

  it("counts updated and removed correctly", () => {
    const content = [
      "# Memory",
      "- [1.0] Fact one",
      "- [0.3] Old fact to remove",
      "- [0.8] Fact two",
    ].join("\n");
    vi.mocked(fs.readFileSync).mockReturnValue(content);

    const result = applyDecayToFile("/test.md", new Set());
    // Fact one: 1.0 -> 0.9 (updated)
    // Old fact: 0.3 -> 0.2 < 0.3 (removed)
    // Fact two: 0.8 -> 0.7 (updated)
    expect(result.updated).toBe(2);
    expect(result.removed).toBe(1);

    const written = vi.mocked(fs.writeFileSync).mock.calls[0]![1] as string;
    expect(written).toContain("- [0.9] Fact one");
    expect(written).toContain("- [0.7] Fact two");
    expect(written).not.toContain("Old fact to remove");
  });
});
