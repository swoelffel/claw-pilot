/**
 * runtime/tool/built-in/send-file.ts
 *
 * Send-file tool — allows the LLM to deliver a workspace file to the user
 * as a downloadable document. Works across all channels (web UI, Telegram).
 *
 * The tool validates the file exists within the instance workspace and returns
 * JSON metadata that the UI renders as a download card and the Telegram channel
 * sends as a document attachment.
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import { z } from "zod";
import { Tool } from "../tool.js";
import { mimeFromExtension } from "../../../lib/mime.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum file size for delivery (50 MB) */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const SendFileTool = Tool.define("send_file", {
  description:
    "Send a file from the workspace to the user as a downloadable document. " +
    "Use this when the user needs to download a file you created or found " +
    "(DOCX, PDF, images, archives, etc.). The file must exist on disk.",
  parameters: z.object({
    path: z.string().describe("Absolute path to the file to send"),
    title: z.string().optional().describe("Display title for the file (defaults to the filename)"),
  }),
  execute: async (args, ctx) => {
    const filePath = args.path;

    // 1. Validate workspace context
    const workDir = ctx.workDir;
    if (!workDir) {
      throw new Error("No workspace directory available — cannot validate file path.");
    }

    // 2. Resolve and validate the file is within the instance workspace
    const resolved = path.resolve(filePath);
    let real: string;
    try {
      real = await fs.realpath(resolved);
    } catch {
      throw new Error(`File not found: ${filePath}`);
    }

    // Security: file must be under the instance state directory (parent of workspaces/)
    // workDir is the stateDir (e.g. ~/.claw-pilot/instances/<slug>/)
    if (!real.startsWith(workDir + path.sep) && real !== workDir) {
      throw new Error("File must be within the instance workspace directory.");
    }

    // 3. Check file exists + get stats
    const stat = await fs.stat(real);
    if (!stat.isFile()) {
      throw new Error(`Path is not a file: ${filePath}`);
    }
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error(`File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Maximum: 50MB.`);
    }

    // 4. Derive metadata
    const filename = path.basename(real);
    const mimeType = mimeFromExtension(path.extname(filename));
    const title = args.title ?? filename;

    // 5. Return metadata as JSON — channels and UI read this to deliver/render the file
    const metadata = { path: real, filename, title, mimeType, sizeBytes: stat.size };
    return {
      title: `File: ${title}`,
      output: JSON.stringify(metadata),
      truncated: false,
    };
  },
});
