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
import { QuestionAsked } from "../../bus/events.js";

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
 * @public
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
 * @public
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
    // Defense in depth: the question tool requires a human on the loop.
    // Refuse to execute when the session was initiated by a non-interactive
    // channel (e.g. internal agent-to-agent). Without this guard, a question
    // here would block the agent until timeout since nobody can answer.
    const INTERACTIVE_CHANNELS = new Set(["web", "telegram", "cli"]);
    if (ctx.channel !== undefined && !INTERACTIVE_CHANNELS.has(ctx.channel)) {
      return {
        title: "Question refused (non-interactive session)",
        output:
          `The question tool can only be used in interactive user sessions. ` +
          `This session's channel is "${ctx.channel}" (no human on the loop). ` +
          `Work with the context you already have, or report the missing information in your final answer.`,
        truncated: false,
      };
    }

    // Use the Vercel AI SDK toolCallId as the question ID — this is the same ID
    // stored in the tool_call part metadata and used by the UI to submit answers.
    const questionId = ctx.toolCallId ?? (await import("nanoid")).nanoid();

    const bus = getBus(ctx.instanceSlug ?? "default");

    // Emit event so the channel layer can display the question
    bus.publish(QuestionAsked, {
      questionId,
      sessionId: ctx.sessionId,
      messageId: ctx.messageId,
      agentId: ctx.agentId,
      question: params.question,
      ...(params.options !== undefined ? { options: params.options } : {}),
    });

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
