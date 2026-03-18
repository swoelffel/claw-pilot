/**
 * runtime/tool/built-in/glob.ts
 *
 * Glob tool — finds files matching a glob pattern.
 * Uses Node.js 22 native glob API.
 */

import { z } from "zod";
import * as path from "node:path";
import * as fs from "node:fs";
import { glob } from "node:fs/promises";
import { Tool } from "../tool.js";

const RESULT_LIMIT = 100;

export const GlobTool = Tool.define("glob", {
  description:
    "Fast file pattern matching tool that works with any codebase size. " +
    "Supports glob patterns like '**/*.js' or 'src/**/*.ts'. " +
    "Returns matching file paths sorted by modification time.",
  parameters: z.object({
    pattern: z.string().describe("The glob pattern to match files against"),
    path: z
      .string()
      .optional()
      .describe(
        "The directory to search in. If not specified, the current working directory will be used. " +
          "IMPORTANT: Omit this field to use the default directory. DO NOT enter 'undefined' or 'null'.",
      ),
  }),
  async execute(params, ctx) {
    const instanceRoot = ctx.workDir ?? process.cwd();
    const searchDir = params.path
      ? path.isAbsolute(params.path)
        ? params.path
        : path.resolve(instanceRoot, params.path)
      : instanceRoot;

    const files: Array<{ path: string; mtime: number }> = [];
    let truncated = false;

    try {
      for await (const entry of glob(params.pattern, { cwd: searchDir })) {
        if (files.length >= RESULT_LIMIT) {
          truncated = true;
          break;
        }
        const entryStr = String(entry);
        const full = path.resolve(searchDir, entryStr);
        const stat = fs.statSync(full, { throwIfNoEntry: false });
        files.push({ path: full, mtime: stat?.mtimeMs ?? 0 });
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { title: params.pattern, output: "No files found", truncated: false };
      }
      throw err;
    }

    files.sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) {
      return { title: params.pattern, output: "No files found", truncated: false };
    }

    const lines = files.map((f) => f.path);
    if (truncated) {
      lines.push(
        "",
        `(Results are truncated: showing first ${RESULT_LIMIT} results. Consider using a more specific path or pattern.)`,
      );
    }

    return {
      title: params.pattern,
      output: lines.join("\n"),
      truncated,
    };
  },
});
