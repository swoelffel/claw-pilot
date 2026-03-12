/**
 * runtime/tool/built-in/read.ts
 *
 * Read tool — reads a file or directory listing.
 * Supports offset/limit for large files.
 */

import { z } from "zod";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { createInterface } from "node:readline";
import { Tool } from "../tool.js";

const DEFAULT_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;
const MAX_BYTES = 50 * 1024; // 50 KB

const BINARY_EXTENSIONS = new Set([
  ".zip",
  ".tar",
  ".gz",
  ".exe",
  ".dll",
  ".so",
  ".class",
  ".jar",
  ".war",
  ".7z",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".odt",
  ".ods",
  ".odp",
  ".bin",
  ".dat",
  ".obj",
  ".o",
  ".a",
  ".lib",
  ".wasm",
  ".pyc",
  ".pyo",
]);

export const ReadTool = Tool.define("read", {
  description:
    "Read a file or directory from the local filesystem. " +
    "Returns file contents with line numbers, or directory entries. " +
    "Use offset and limit to paginate large files.",
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the file or directory to read"),
    offset: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("The line number to start reading from (1-indexed)"),
    limit: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("The maximum number of lines to read (defaults to 2000)"),
  }),
  async execute(params) {
    const filePath = path.isAbsolute(params.filePath)
      ? params.filePath
      : path.resolve(process.cwd(), params.filePath);

    let stat: fsSync.Stats;
    try {
      stat = await fs.stat(filePath);
    } catch {
      // Try to suggest similar files
      const dir = path.dirname(filePath);
      const base = path.basename(filePath).toLowerCase();
      let suggestions: string[] = [];
      try {
        const entries = await fs.readdir(dir);
        suggestions = entries
          .filter((e) => e.toLowerCase().includes(base) || base.includes(e.toLowerCase()))
          .slice(0, 3)
          .map((e) => path.join(dir, e));
      } catch {
        // ignore
      }
      if (suggestions.length > 0) {
        throw new Error(
          `File not found: ${filePath}\n\nDid you mean one of these?\n${suggestions.join("\n")}`,
        );
      }
      throw new Error(`File not found: ${filePath}`);
    }

    const title = filePath;

    // Directory listing
    if (stat.isDirectory()) {
      const dirents = await fs.readdir(filePath, { withFileTypes: true });
      const entries: string[] = [];
      for (const d of dirents) {
        if (d.isDirectory()) {
          entries.push(d.name + "/");
        } else if (d.isSymbolicLink()) {
          const target = await fs.stat(path.join(filePath, d.name)).catch(() => undefined);
          entries.push(d.name + (target?.isDirectory() ? "/" : ""));
        } else {
          entries.push(d.name);
        }
      }
      entries.sort((a, b) => a.localeCompare(b));

      const limit = params.limit ?? DEFAULT_LIMIT;
      const offset = params.offset ?? 1;
      const start = offset - 1;
      const sliced = entries.slice(start, start + limit);
      const truncated = start + sliced.length < entries.length;

      const output = [
        `<path>${filePath}</path>`,
        `<type>directory</type>`,
        `<entries>`,
        sliced.join("\n"),
        truncated
          ? `\n(Showing ${sliced.length} of ${entries.length} entries. Use 'offset' to read beyond entry ${offset + sliced.length})`
          : `\n(${entries.length} entries)`,
        `</entries>`,
      ].join("\n");

      return { title, output, truncated };
    }

    // Binary check
    const ext = path.extname(filePath).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      throw new Error(`Cannot read binary file: ${filePath}`);
    }

    // Text file reading with streaming
    const stream = fsSync.createReadStream(filePath, { encoding: "utf8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    const limit = params.limit ?? DEFAULT_LIMIT;
    const offset = params.offset ?? 1;
    const start = offset - 1;
    const raw: string[] = [];
    let bytes = 0;
    let lines = 0;
    let truncatedByBytes = false;
    let hasMoreLines = false;

    try {
      for await (const text of rl) {
        lines++;
        if (lines <= start) continue;
        if (raw.length >= limit) {
          hasMoreLines = true;
          continue;
        }
        const line =
          text.length > MAX_LINE_LENGTH
            ? text.substring(0, MAX_LINE_LENGTH) +
              `... (line truncated to ${MAX_LINE_LENGTH} chars)`
            : text;
        const size = Buffer.byteLength(line, "utf-8") + (raw.length > 0 ? 1 : 0);
        if (bytes + size > MAX_BYTES) {
          truncatedByBytes = true;
          hasMoreLines = true;
          break;
        }
        raw.push(line);
        bytes += size;
      }
    } finally {
      rl.close();
      stream.destroy();
    }

    if (lines < offset && !(lines === 0 && offset === 1)) {
      throw new Error(`Offset ${offset} is out of range for this file (${lines} lines)`);
    }

    const content = raw.map((line, index) => `${index + offset}: ${line}`);
    const lastReadLine = offset + raw.length - 1;
    const nextOffset = lastReadLine + 1;
    const truncated = hasMoreLines || truncatedByBytes;

    let output = [`<path>${filePath}</path>`, `<type>file</type>`, "<content>"].join("\n");
    output += content.join("\n");

    if (truncatedByBytes) {
      output += `\n\n(Output capped at ${MAX_BYTES / 1024} KB. Showing lines ${offset}-${lastReadLine}. Use offset=${nextOffset} to continue.)`;
    } else if (hasMoreLines) {
      output += `\n\n(Showing lines ${offset}-${lastReadLine} of ${lines}. Use offset=${nextOffset} to continue.)`;
    } else {
      output += `\n\n(End of file - total ${lines} lines)`;
    }
    output += "\n</content>";

    return { title, output, truncated };
  },
});
