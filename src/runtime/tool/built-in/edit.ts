/**
 * runtime/tool/built-in/edit.ts
 *
 * Edit tool — performs exact string replacements in files.
 * Supports multiple fallback matching strategies (adapted from opencode).
 */

import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Tool } from "../tool.js";

export const EditTool = Tool.define("edit", {
  ownerOnly: true,
  description:
    "Performs exact string replacements in files. " +
    "The edit will FAIL if oldString is not found in the file. " +
    "Use replaceAll to replace every occurrence.",
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the file to modify"),
    oldString: z.string().describe("The text to replace"),
    newString: z
      .string()
      .describe("The text to replace it with (must be different from oldString)"),
    replaceAll: z
      .boolean()
      .optional()
      .describe("Replace all occurrences of oldString (default false)"),
  }),
  async execute(params) {
    if (params.oldString === params.newString) {
      throw new Error("No changes to apply: oldString and newString are identical.");
    }

    const filePath = path.isAbsolute(params.filePath)
      ? params.filePath
      : path.resolve(process.cwd(), params.filePath);

    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch {
      throw new Error(`File not found: ${filePath}`);
    }

    const newContent = replace(content, params.oldString, params.newString, params.replaceAll);

    await fs.writeFile(filePath, newContent, "utf-8");

    return {
      title: path.basename(filePath),
      output: "Edit applied successfully.",
      truncated: false,
    };
  },
});

// ---------------------------------------------------------------------------
// Replace engine (adapted from opencode/tool/edit.ts)
// ---------------------------------------------------------------------------

function normalizeLineEndings(text: string): string {
  return text.replaceAll("\r\n", "\n");
}

function detectLineEnding(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function convertToLineEnding(text: string, ending: "\n" | "\r\n"): string {
  if (ending === "\n") return text;
  return text.replaceAll("\n", "\r\n");
}

type Replacer = (content: string, find: string) => Generator<string, void, unknown>;

const SimpleReplacer: Replacer = function* (_content, find) {
  yield find;
};

const LineTrimmedReplacer: Replacer = function* (content, find) {
  const originalLines = content.split("\n");
  const searchLines = find.split("\n");
  if (searchLines[searchLines.length - 1] === "") searchLines.pop();

  for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
    let matches = true;
    for (let j = 0; j < searchLines.length; j++) {
      if ((originalLines[i + j] ?? "").trim() !== (searchLines[j] ?? "").trim()) {
        matches = false;
        break;
      }
    }
    if (matches) {
      let start = 0;
      for (let k = 0; k < i; k++) start += (originalLines[k] ?? "").length + 1;
      let end = start;
      for (let k = 0; k < searchLines.length; k++) {
        end += (originalLines[i + k] ?? "").length;
        if (k < searchLines.length - 1) end++;
      }
      yield content.substring(start, end);
    }
  }
};

const TrimmedBoundaryReplacer: Replacer = function* (content, find) {
  const trimmed = find.trim();
  if (trimmed === find) return;
  if (content.includes(trimmed)) yield trimmed;
};

export function replace(
  content: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): string {
  if (oldString === newString) {
    throw new Error("No changes to apply: oldString and newString are identical.");
  }

  const ending = detectLineEnding(content);
  const old = convertToLineEnding(normalizeLineEndings(oldString), ending);
  const next = convertToLineEnding(normalizeLineEndings(newString), ending);

  let notFound = true;

  for (const replacer of [SimpleReplacer, LineTrimmedReplacer, TrimmedBoundaryReplacer]) {
    for (const search of replacer(content, old)) {
      const index = content.indexOf(search);
      if (index === -1) continue;
      notFound = false;
      if (replaceAll) return content.replaceAll(search, next);
      const lastIndex = content.lastIndexOf(search);
      if (index !== lastIndex) continue;
      return content.substring(0, index) + next + content.substring(index + search.length);
    }
  }

  if (notFound) {
    throw new Error(
      "Could not find oldString in the file. It must match exactly, including whitespace, indentation, and line endings.",
    );
  }
  throw new Error(
    "Found multiple matches for oldString. Provide more surrounding context to make the match unique.",
  );
}
