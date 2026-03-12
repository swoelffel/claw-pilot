/**
 * runtime/tool/tool.ts
 *
 * Tool.Info interface + Tool.define() factory.
 *
 * Inspired by OpenCode's tool/tool.ts but simplified for claw-runtime V1:
 * - No ask() permission callback (Phase 2)
 * - No messages context (Phase 2)
 * - Simple in-memory truncation (no temp files)
 */

import { z } from "zod";
import type { SessionId, MessageId } from "../types.js";

/** Max output characters before truncation */
const MAX_OUTPUT_CHARS = 32_000;

export namespace Tool {
  /** Execution context passed to every tool */
  export interface Context {
    sessionId: SessionId;
    messageId: MessageId;
    agentId: string;
    abort: AbortSignal;
    /** Callback to update the title/metadata of the in-progress tool part */
    metadata(input: { title?: string }): void;
  }

  /** Execution result of a tool */
  export interface Result {
    title: string;
    output: string;
    /** true if the output was truncated */
    truncated: boolean;
  }

  /** Full tool definition (after init) */
  export interface Definition<P extends z.ZodType = z.ZodType> {
    description: string;
    parameters: P;
    execute(args: z.infer<P>, ctx: Context): Promise<Result>;
  }

  /** Tool descriptor (before init) */
  export interface Info<P extends z.ZodType = z.ZodType> {
    id: string;
    init(): Promise<Definition<P>> | Definition<P>;
  }

  /**
   * Factory for defining a tool with automatic Zod validation and output truncation.
   *
   * Wraps execute() to:
   * 1. Validate args via schema.parse() — throws Error with clear message if invalid
   * 2. Execute the tool
   * 3. Truncate output if > MAX_OUTPUT_CHARS
   */
  export function define<P extends z.ZodType>(
    id: string,
    definition: Definition<P> | (() => Promise<Definition<P>> | Definition<P>),
  ): Info<P> {
    return {
      id,
      init: async () => {
        const def = definition instanceof Function ? await definition() : definition;
        const originalExecute = def.execute;

        def.execute = async (args: z.infer<P>, ctx: Context): Promise<Result> => {
          // Validate args
          try {
            def.parameters.parse(args);
          } catch (error) {
            if (error instanceof z.ZodError) {
              throw new Error(
                `Tool "${id}" called with invalid arguments: ${error.message}.\n` +
                  `Please rewrite the input to match the expected schema.`,
                { cause: error },
              );
            }
            throw error;
          }

          const result = await originalExecute(args, ctx);

          // Truncate output if needed
          if (result.output.length > MAX_OUTPUT_CHARS) {
            const originalLength = result.output.length;
            return {
              ...result,
              output:
                result.output.slice(0, MAX_OUTPUT_CHARS) +
                `\n\n[Output truncated — ${originalLength} chars total]`,
              truncated: true,
            };
          }

          return result;
        };

        return def;
      },
    };
  }
}
