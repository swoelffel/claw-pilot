/**
 * runtime/tool/built-in/multiedit.ts
 *
 * MultiEdit tool — applies multiple find-and-replace edits to a single file in one call.
 * Edits are applied sequentially in order.
 */

import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Tool } from "../tool.js";
import { replace } from "./edit.js";

const EditSchema = z.object({
  oldString: z.string().describe("Exact string to find (must be unique in the file)"),
  newString: z.string().describe("Replacement string"),
  replaceAll: z.boolean().optional().describe("Replace all occurrences (default: false)"),
});

export const MultiEditTool = Tool.define("multiedit", {
  ownerOnly: true,
  description:
    "Apply multiple find-and-replace edits to a single file in one call. " +
    "Edits are applied sequentially in order. Each oldString must be unique in the file " +
    "at the time it is applied (accounting for previous edits in the list). " +
    "Use this instead of multiple edit calls on the same file.",
  parameters: z.object({
    filePath: z.string().describe("Absolute path to the file to edit"),
    edits: z.array(EditSchema).min(1).describe("List of edits to apply in order"),
  }),
  async execute(params, ctx) {
    ctx.metadata({
      title: `multiedit ${path.basename(params.filePath)} (${params.edits.length} edits)`,
    });

    const filePath = path.isAbsolute(params.filePath)
      ? params.filePath
      : path.resolve(process.cwd(), params.filePath);

    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch {
      throw new Error(`File not found: ${filePath}`);
    }

    const applied: string[] = [];
    const errors: string[] = [];

    for (const edit of params.edits) {
      try {
        content = replace(content, edit.oldString, edit.newString, edit.replaceAll);
        applied.push(
          `✓ ${edit.oldString.slice(0, 40).replace(/\n/g, "↵")}... → ${edit.newString.slice(0, 40).replace(/\n/g, "↵")}...`,
        );
      } catch (err) {
        errors.push(
          `✗ ${edit.oldString.slice(0, 40).replace(/\n/g, "↵")}...: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (applied.length === 0) {
      return {
        title: `multiedit failed: ${path.basename(filePath)}`,
        output: `All edits failed:\n${errors.join("\n")}`,
        truncated: false,
      };
    }

    await fs.writeFile(filePath, content, "utf-8");

    const lines = [
      `Applied ${applied.length}/${params.edits.length} edits to ${path.basename(filePath)}`,
      ...applied,
      ...(errors.length > 0 ? [`\nFailed edits:`, ...errors] : []),
    ];

    return {
      title: `multiedit ${path.basename(filePath)}`,
      output: lines.join("\n"),
      truncated: false,
    };
  },
});
