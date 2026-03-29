/**
 * runtime/session/__tests__/skill-ranker.test.ts
 *
 * Unit tests for the TF-IDF skill ranking function.
 */

import { describe, it, expect } from "vitest";
import { rankSkills } from "../skill-ranker.js";
import type { SkillEntry } from "../../tool/built-in/skill.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function skill(name: string, description?: string): SkillEntry {
  return {
    name,
    dir: `/skills/${name}`,
    path: `/skills/${name}/SKILL.md`,
    ...(description !== undefined ? { description } : {}),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("rankSkills", () => {
  it("returns empty array for empty user text", () => {
    const skills = [skill("web-search", "Search the web")];
    expect(rankSkills("", skills, 5)).toEqual([]);
    expect(rankSkills("   ", skills, 5)).toEqual([]);
  });

  it("returns empty array for empty skills list", () => {
    expect(rankSkills("search the web", [], 5)).toEqual([]);
  });

  it("returns empty array when no skill matches", () => {
    const skills = [
      skill("pdf-reader", "Read and extract text from PDF files"),
      skill("docx-generator", "Generate Word documents"),
    ];
    expect(rankSkills("deploy cloud cluster", skills, 5)).toEqual([]);
  });

  it("ranks exact name match first", () => {
    const skills = [
      skill("pdf-reader", "Read PDF files"),
      skill("web-search", "Search the internet for information"),
      skill("image-analysis", "Analyze images"),
    ];
    const result = rankSkills("web search query", skills, 5);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.name).toBe("web-search");
  });

  it("ranks by description relevance", () => {
    const skills = [
      skill("tool-a", "Generate beautiful charts and graphs from data"),
      skill("tool-b", "Manage database connections and queries"),
      skill("tool-c", "Create charts from CSV files"),
    ];
    const result = rankSkills("create charts from data", skills, 5);
    expect(result.length).toBeGreaterThan(0);
    // Both tool-a and tool-c mention charts, but tool-a has more matching terms
    expect(result.map((s) => s.name)).toContain("tool-a");
  });

  it("respects topN limit", () => {
    const skills = Array.from({ length: 20 }, (_, i) =>
      skill(`skill-${i}`, `Skill number ${i} for testing search`),
    );
    const result = rankSkills("testing search skill", skills, 3);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("excludes skills with zero score", () => {
    const skills = [
      skill("matching-skill", "Handle file uploads and downloads"),
      skill("unrelated-skill", "xyz abc qrs"),
    ];
    const result = rankSkills("file uploads", skills, 10);
    expect(result.every((s) => s.name !== "unrelated-skill")).toBe(true);
  });

  it("handles special characters in user text without crashing", () => {
    const skills = [skill("test-skill", "A test skill for validation")];
    expect(() => rankSkills("hello! @#$% (test) <>&", skills, 5)).not.toThrow();
    expect(() => rankSkills("accents and special chars", skills, 5)).not.toThrow();
  });

  it("handles skills without description", () => {
    const skills = [skill("web-search"), skill("pdf-reader", "Read PDF documents")];
    const result = rankSkills("web search", skills, 5);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.name).toBe("web-search");
  });

  it("treats kebab-case skill names as separate words", () => {
    const skills = [
      skill("image-analysis", "Analyze visual content"),
      skill("text-processing", "Process text data"),
    ];
    const result = rankSkills("analyze image", skills, 5);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.name).toBe("image-analysis");
  });
});
