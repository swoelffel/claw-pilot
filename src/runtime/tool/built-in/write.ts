/**
 * runtime/tool/built-in/write.ts
 *
 * Write tool — writes content to a file (creates or overwrites).
 */

import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Tool } from "../tool.js";

export const WriteTool = Tool.define("write", {
  ownerOnly: true,
  description:
    "Writes a file to the local filesystem. " +
    "This tool will overwrite the existing file if there is one at the provided path. " +
    "ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.",
  parameters: z.object({
    filePath: z
      .string()
      .describe("The absolute path to the file to write (must be absolute, not relative)"),
    content: z.string().describe("The content to write to the file"),
  }),
  async execute(params, ctx) {
    const instanceRoot = ctx.workDir ?? process.cwd();
    const filePath = path.isAbsolute(params.filePath)
      ? params.filePath
      : path.resolve(instanceRoot, params.filePath);

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // Try exclusive create first; on EEXIST, fall back to overwrite.
    // This turns the "existed?" check into a single atomic operation —
    // no TOCTOU window between the check and the write.
    let existed = false;
    try {
      await fs.writeFile(filePath, params.content, { encoding: "utf-8", flag: "wx" });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      existed = true;
      await fs.writeFile(filePath, params.content, "utf-8");
    }

    const title = path.basename(filePath);
    const output = existed ? "Wrote file successfully." : "Created file successfully.";

    return { title, output, truncated: false };
  },
});
