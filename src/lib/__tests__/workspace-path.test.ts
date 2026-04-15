// src/lib/__tests__/workspace-path.test.ts
import { describe, it, expect } from "vitest";
import {
  validateWorkspaceRelativePath,
  isIgnoredWorkspaceSegment,
  hasAllowedWorkspaceExtension,
  InvalidWorkspacePathError,
} from "../workspace-path.js";

describe("validateWorkspaceRelativePath", () => {
  describe("accepts", () => {
    it.each([
      ["SOUL.md", "SOUL.md"],
      ["memory/facts.md", "memory/facts.md"],
      ["notes/2026-01.md", "notes/2026-01.md"],
      ["config.yaml", "config.yaml"],
      ["data.json", "data.json"],
      ["a/b/c/d.md", "a/b/c/d.md"],
      ["with_underscore.md", "with_underscore.md"],
      ["with-dash.txt", "with-dash.txt"],
    ])("%s → %s", (input, expected) => {
      expect(validateWorkspaceRelativePath(input)).toBe(expected);
    });

    it("normalizes duplicate slashes", () => {
      expect(validateWorkspaceRelativePath("memory//facts.md")).toBe("memory/facts.md");
    });
  });

  describe("rejects", () => {
    it.each([
      ["", "empty"],
      ["/absolute.md", "absolute"],
      ["../escape.md", "traversal"],
      ["memory/../escape.md", "traversal"],
      ["./current.md", "relative traversal"],
      ["backslash\\name.md", "backslash"],
      ["null\0byte.md", "null byte"],
      ["no-extension", "extension"],
      ["script.sh", "extension"],
      ["malware.exe", "extension"],
      ["script.js", "extension"],
      [".git/config.md", "reserved"],
      ["node_modules/foo.md", "reserved"],
      ["C:/windows.md", "absolute"],
      ["file with space.md", "invalid characters"],
      ["file:colon.md", "invalid characters"],
    ])("%s → throws (%s)", (input) => {
      expect(() => validateWorkspaceRelativePath(input)).toThrow(InvalidWorkspacePathError);
    });

    it("rejects paths exceeding 255 chars", () => {
      const long = "a".repeat(252) + ".md";
      expect(() => validateWorkspaceRelativePath(long)).toThrow(InvalidWorkspacePathError);
    });

    it("rejects a segment exceeding 100 chars", () => {
      const okSegment = "a".repeat(97) + ".md"; // 100 chars exactly
      expect(() => validateWorkspaceRelativePath(`dir/${okSegment}`)).not.toThrow();
      const tooLong = "a".repeat(98) + ".md"; // 101 chars
      expect(() => validateWorkspaceRelativePath(`dir/${tooLong}`)).toThrow(
        InvalidWorkspacePathError,
      );
    });
  });
});

describe("isIgnoredWorkspaceSegment", () => {
  it.each([
    [".git", true],
    ["node_modules", true],
    [".DS_Store", true],
    [".claude", true],
    [".anything", true],
    ["SOUL.md", false],
    ["memory", false],
  ])("%s → %s", (name, expected) => {
    expect(isIgnoredWorkspaceSegment(name)).toBe(expected);
  });
});

describe("hasAllowedWorkspaceExtension", () => {
  it.each([
    ["SOUL.md", true],
    ["facts.txt", true],
    ["config.YAML", true],
    ["script.sh", false],
    ["binary", false],
    [".hidden", false],
  ])("%s → %s", (name, expected) => {
    expect(hasAllowedWorkspaceExtension(name)).toBe(expected);
  });
});
