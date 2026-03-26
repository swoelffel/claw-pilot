/**
 * runtime/tool/built-in/create-artifact.ts
 *
 * Artifact tool — allows the LLM to produce structured, identifiable content
 * that the UI renders as a rich card (code block, report, analysis, etc.).
 *
 * The tool flows through the standard tool_call / tool_result pipeline.
 * The UI detects toolName === "create_artifact" and dispatches to a dedicated
 * artifact card component instead of the generic tool block.
 */

import { z } from "zod";
import { Tool } from "../tool.js";

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const CreateArtifactTool = Tool.define("create_artifact", {
  description:
    "Create a structured artifact (code snippet, report, analysis, document). " +
    "Use this when producing substantial content the user may want to copy, " +
    "download, or reference later. Do NOT use this for short inline answers.",
  parameters: z.object({
    title: z.string().describe("Short descriptive title for the artifact"),
    artifactType: z
      .enum(["code", "markdown", "json", "csv", "svg", "html"])
      .describe("Type of artifact content"),
    content: z.string().describe("The full artifact content"),
    language: z
      .string()
      .optional()
      .describe("Programming language for code artifacts (e.g. 'typescript', 'python')"),
  }),
  execute: async (args) => ({
    title: `Artifact: ${args.title}`,
    output: args.content,
    truncated: false,
  }),
});
