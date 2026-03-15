/**
 * runtime/tool/built-in/question.ts
 *
 * Question tool — asks the user a question and waits for their answer.
 * In V1, this emits a bus event and waits for a response via a Promise.
 * The dashboard/channel layer is responsible for resolving the answer.
 */

import { z } from "zod";
import { Tool } from "../tool.js";
import { getBus } from "../../bus/index.js";

// ---------------------------------------------------------------------------
// Pending question registry (in-memory)
// ---------------------------------------------------------------------------

interface PendingQuestion {
  resolve: (answer: string) => void;
  reject: (err: Error) => void;
}

const _pending = new Map<string, PendingQuestion>();

/**
 * Resolve a pending question from the channel layer.
 * Called by the dashboard/channel when the user submits an answer.
 */
export function resolveQuestion(questionId: string, answer: string): boolean {
  const pending = _pending.get(questionId);
  if (!pending) return false;
  _pending.delete(questionId);
  pending.resolve(answer);
  return true;
}

/**
 * Reject a pending question (e.g. session aborted).
 */
export function rejectQuestion(questionId: string, reason: string): boolean {
  const pending = _pending.get(questionId);
  if (!pending) return false;
  _pending.delete(questionId);
  pending.reject(new Error(reason));
  return true;
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const QuestionTool = Tool.define("question", {
  description:
    "Ask the user a question and wait for their answer. " +
    "Use this when you need clarification or approval before proceeding. " +
    "The user will be prompted to answer before the agent continues.",
  parameters: z.object({
    question: z.string().describe("The question to ask the user"),
    options: z
      .array(z.string())
      .optional()
      .describe("Optional list of predefined answer options to present to the user"),
  }),
  async execute(params, ctx) {
    const { nanoid } = await import("nanoid");
    const questionId = nanoid();

    const bus = getBus(ctx.agentId.split(":")[0] ?? "default");

    // Emit event so the channel layer can display the question
    bus.publish(
      { type: "question.asked" } as never,
      {
        questionId,
        sessionId: ctx.sessionId,
        messageId: ctx.messageId,
        question: params.question,
        options: params.options,
      } as never,
    );

    // Wait for answer (or abort)
    const answer = await new Promise<string>((resolve, reject) => {
      _pending.set(questionId, { resolve, reject });

      ctx.abort.addEventListener(
        "abort",
        () => {
          _pending.delete(questionId);
          reject(new Error("Question aborted"));
        },
        { once: true },
      );
    });

    return {
      title: `Question: ${params.question.slice(0, 50)}`,
      output: `User answered: ${answer}`,
      truncated: false,
    };
  },
});
