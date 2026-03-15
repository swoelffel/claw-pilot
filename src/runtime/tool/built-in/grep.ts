/**
 * runtime/tool/built-in/grep.ts
 *
 * Grep tool — searches file contents using regular expressions.
 * Uses ripgrep (rg) if available, falls back to Node.js native search.
 */

import { z } from "zod";
import * as path from "node:path";
import * as fs from "node:fs";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { Tool } from "../tool.js";

const RESULT_LIMIT = 100;
const MAX_LINE_LENGTH = 2000;

export const GrepTool = Tool.define("grep", {
  description:
    "Fast content search tool that works with any codebase size. " +
    "Searches file contents using regular expressions. " +
    "Supports full regex syntax (eg. 'log.*Error', 'function\\s+\\w+', etc.). " +
    "Filter files by pattern with the include parameter (eg. '*.js', '*.{ts,tsx}'). " +
    "Returns file paths and line numbers with at least one match sorted by modification time.",
  parameters: z.object({
    pattern: z.string().describe("The regex pattern to search for in file contents"),
    path: z
      .string()
      .optional()
      .describe("The directory to search in. Defaults to the current working directory."),
    include: z
      .string()
      .optional()
      .describe('File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")'),
  }),
  async execute(params, ctx) {
    if (!params.pattern) throw new Error("pattern is required");

    const searchPath = params.path
      ? path.isAbsolute(params.path)
        ? params.path
        : path.resolve(process.cwd(), params.path)
      : process.cwd();

    // Try ripgrep first
    const rgResult = await tryRipgrep(params.pattern, searchPath, params.include, ctx.abort);
    if (rgResult !== null) return rgResult;

    // Fallback: Node.js native search
    return nativeGrep(params.pattern, searchPath, params.include, ctx.abort);
  },
});

// ---------------------------------------------------------------------------
// Ripgrep implementation
// ---------------------------------------------------------------------------

async function tryRipgrep(
  pattern: string,
  searchPath: string,
  include: string | undefined,
  abort: AbortSignal,
): Promise<{ title: string; output: string; truncated: boolean } | null> {
  return new Promise((resolve) => {
    const args = [
      "-nH",
      "--hidden",
      "--no-messages",
      "--field-match-separator=|",
      "--regexp",
      pattern,
    ];
    if (include) args.push("--glob", include);
    args.push(searchPath);

    const proc = spawn("rg", args, { stdio: ["ignore", "pipe", "pipe"] });

    // If rg not found, fall back
    proc.once("error", () => resolve(null));

    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (c: Buffer) => (stdout += c.toString()));
    proc.stderr?.on("data", (c: Buffer) => (stderr += c.toString()));

    const abortHandler = () => proc.kill();
    abort.addEventListener("abort", abortHandler, { once: true });

    proc.once("exit", (code) => {
      abort.removeEventListener("abort", abortHandler);

      if (code === null) {
        // killed
        resolve({ title: pattern, output: "Search aborted", truncated: false });
        return;
      }

      // rg exit codes: 0=matches, 1=no matches, 2=errors
      if (code === 1 || (code === 2 && !stdout.trim())) {
        resolve({ title: pattern, output: "No files found", truncated: false });
        return;
      }

      if (code !== 0 && code !== 2) {
        resolve(null); // fall back to native
        return;
      }

      resolve(formatRgOutput(pattern, stdout));
    });
  });
}

function formatRgOutput(
  pattern: string,
  output: string,
): { title: string; output: string; truncated: boolean } {
  const lines = output.trim().split(/\r?\n/);
  const matches: Array<{ path: string; mtime: number; lineNum: number; lineText: string }> = [];

  for (const line of lines) {
    if (!line) continue;
    const [filePath, lineNumStr, ...rest] = line.split("|");
    if (!filePath || !lineNumStr || rest.length === 0) continue;
    const lineNum = parseInt(lineNumStr, 10);
    const lineText = rest.join("|");
    const stat = fs.statSync(filePath, { throwIfNoEntry: false });
    matches.push({ path: filePath, mtime: stat?.mtimeMs ?? 0, lineNum, lineText });
  }

  return buildOutput(pattern, matches);
}

// ---------------------------------------------------------------------------
// Native Node.js grep fallback
// ---------------------------------------------------------------------------

async function nativeGrep(
  pattern: string,
  searchPath: string,
  include: string | undefined,
  abort: AbortSignal,
): Promise<{ title: string; output: string; truncated: boolean }> {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    throw new Error(`Invalid regex pattern: ${pattern}`);
  }

  const matches: Array<{ path: string; mtime: number; lineNum: number; lineText: string }> = [];

  await walkDir(searchPath, include, abort, async (filePath) => {
    if (matches.length >= RESULT_LIMIT * 10) return; // cap total scan
    const stat = fs.statSync(filePath, { throwIfNoEntry: false });
    const mtime = stat?.mtimeMs ?? 0;

    const stream = fs.createReadStream(filePath, { encoding: "utf8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    let lineNum = 0;

    try {
      for await (const line of rl) {
        lineNum++;
        if (regex.test(line)) {
          matches.push({ path: filePath, mtime, lineNum, lineText: line });
        }
      }
    } catch {
      // skip unreadable files
    } finally {
      rl.close();
      stream.destroy();
    }
  });

  if (matches.length === 0) {
    return { title: pattern, output: "No files found", truncated: false };
  }

  return buildOutput(pattern, matches);
}

async function walkDir(
  dir: string,
  include: string | undefined,
  abort: AbortSignal,
  callback: (filePath: string) => Promise<void>,
): Promise<void> {
  if (abort.aborted) return;

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (abort.aborted) return;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      await walkDir(full, include, abort, callback);
    } else if (entry.isFile()) {
      if (include && !matchGlob(entry.name, include)) continue;
      await callback(full);
    }
  }
}

function matchGlob(name: string, pattern: string): boolean {
  // Simple glob: support *.ext and *.{ext1,ext2}
  const braceMatch = pattern.match(/^\*\.\{(.+)\}$/);
  if (braceMatch?.[1]) {
    const exts = braceMatch[1].split(",").map((e) => "." + e.trim());
    return exts.some((ext) => name.endsWith(ext));
  }
  if (pattern.startsWith("*.")) {
    return name.endsWith(pattern.slice(1));
  }
  return name.includes(pattern.replace(/\*/g, ""));
}

function buildOutput(
  pattern: string,
  matches: Array<{ path: string; mtime: number; lineNum: number; lineText: string }>,
): { title: string; output: string; truncated: boolean } {
  matches.sort((a, b) => b.mtime - a.mtime);

  const truncated = matches.length > RESULT_LIMIT;
  const final = truncated ? matches.slice(0, RESULT_LIMIT) : matches;

  const lines = [
    `Found ${matches.length} matches${truncated ? ` (showing first ${RESULT_LIMIT})` : ""}`,
  ];
  let currentFile = "";

  for (const m of final) {
    if (currentFile !== m.path) {
      if (currentFile !== "") lines.push("");
      currentFile = m.path;
      lines.push(`${m.path}:`);
    }
    const text =
      m.lineText.length > MAX_LINE_LENGTH
        ? m.lineText.substring(0, MAX_LINE_LENGTH) + "..."
        : m.lineText;
    lines.push(`  Line ${m.lineNum}: ${text}`);
  }

  if (truncated) {
    lines.push(
      "",
      `(Results truncated: showing ${RESULT_LIMIT} of ${matches.length} matches. Consider using a more specific path or pattern.)`,
    );
  }

  return { title: pattern, output: lines.join("\n"), truncated };
}
