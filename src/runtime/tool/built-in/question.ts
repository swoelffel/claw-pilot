/**
 * runtime/tool/built-in/question.ts
 *
 * Question tool — asks the user one or more questions and waits for their
 * answer(s). Inspired by the AskUserQuestion pattern: a single tool call can
 * bundle 1..4 questions, each with its own answer type (single / multi / free)
 * and optional "Other…" free-text affordance. All answers are returned
 * atomically to the agent.
 *
 * The dashboard/channel layer is responsible for resolving the answer
 * (see UI `part-question.ts`, web route `runtime-tools.ts`, Telegram channel).
 */

import { z } from "zod";
import { Tool } from "../tool.js";
import { getBus } from "../../bus/index.js";
import { QuestionAsked } from "../../bus/events.js";
import type { QuestionItem } from "../../bus/events.js";
import { logger } from "../../../lib/logger.js";

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
// Bundled-question detection (applied per-item)
// ---------------------------------------------------------------------------

/**
 * Detect when a single `question` string bundles multiple questions together.
 * Applied per-item: within a single tab, the question must be atomic.
 * Returns true if the text looks like a bundle.
 */
export function isBundledQuestion(raw: string): boolean {
  // Remove URLs so their "?" and punctuation don't trigger false positives
  const stripped = raw.replace(/https?:\/\/\S+/g, "");

  // Multiple question marks → almost always multiple questions
  const questionMarks = (stripped.match(/\?/g) ?? []).length;
  if (questionMarks >= 2) return true;

  // Numbered list item at line start: "1." / "1)" / "2." etc.
  if (/^\s*\d+[.)]\s/m.test(stripped)) return true;

  // Bullet list item at line start: "- " / "* " / "• "
  if (/^\s*[-*•]\s/m.test(stripped)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Per-answer payload parsing (from UI / Telegram)
// ---------------------------------------------------------------------------

/**
 * Per-question answer payload written by the UI / Telegram layer.
 * - `selected`: options chosen (single → 1 item, multi → 1+ items, free → []).
 * - `otherText`: optional "Other…" free-text when allowOther is true, OR the
 *   full free-text body when answerType is "free".
 */
export interface QuestionAnswerPayload {
  selected: string[];
  otherText?: string;
}

/**
 * Format the atomic answer payload into a human-readable string injected into
 * the tool's output (seen by the agent in the next turn's context).
 */
export function formatAnswers(items: QuestionItem[], answers: QuestionAnswerPayload[]): string {
  if (items.length === 1) {
    const item = items[0]!;
    const a: QuestionAnswerPayload = answers[0] ?? { selected: [] };
    return `User answered: ${renderAnswer(item, a)}`;
  }
  const lines = items.map((item, idx) => {
    const a: QuestionAnswerPayload = answers[idx] ?? { selected: [] };
    const label = item.header || item.question.slice(0, 40);
    return `${idx + 1}. [${label}] → ${renderAnswer(item, a)}`;
  });
  return `User answered:\n${lines.join("\n")}`;
}

function renderAnswer(item: QuestionItem, a: QuestionAnswerPayload): string {
  const parts: string[] = [...a.selected];
  if (a.otherText !== undefined && a.otherText.length > 0) {
    if (item.answerType === "free") return a.otherText;
    parts.push(`Other: ${a.otherText}`);
  }
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Tool schema
// ---------------------------------------------------------------------------

const QuestionItemSchema = z.object({
  header: z
    .string()
    .max(32)
    .describe("Short tab label shown to the user (max 32 chars). Required — keep it concise."),
  question: z.string().min(1).describe("The question text shown to the user."),
  answerType: z
    .enum(["single", "multi", "free"])
    .default("single")
    .describe(
      'Answer shape. "single" = exactly one option; "multi" = one or more options; "free" = open text only (no options).',
    ),
  options: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Predefined options for "single" / "multi". Required when answerType !== "free". Ignored when answerType === "free".',
    ),
  allowOther: z
    .boolean()
    .default(false)
    .describe(
      'When true, adds an "Other…" free-text field alongside options. Ignored when answerType === "free".',
    ),
});

/**
 * Flat schema accepted by the tool. For backward-compat we accept both the
 * legacy shape `{question, options}` and the new shape `{questions: [...]}`.
 * The two are merged at `execute()` time.
 */
const QuestionInputSchema = z.object({
  // New shape — preferred
  questions: z.array(QuestionItemSchema).min(1).max(4).optional(),
  // Legacy shape — auto-wrapped into a single-item questions[] when present
  question: z.string().optional(),
  options: z.array(z.string()).optional(),
});

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const QuestionTool = Tool.define("question", {
  description:
    "Ask the user one or more questions and wait for their atomic answer(s). " +
    "Use `questions: [{header, question, answerType, options?, allowOther?}]` — up to 4 items rendered as tabs. " +
    'Types: "single" = pick one option (default when `options` is provided); "multi" = pick one or more options; "free" = open text. ' +
    "Use `allowOther: true` to let the user type a custom answer alongside options. " +
    "Never bundle multiple questions inside a single `question` string — use separate items in `questions[]` instead.",
  parameters: QuestionInputSchema,
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

    // Resolve to the structured list — wrap legacy flat shape.
    const items = normalizeItems(params);
    if (items.length === 0) {
      return {
        title: "Question refused (empty)",
        output: `The question tool requires at least one item in \`questions\` or a legacy \`question\` string.`,
        truncated: false,
      };
    }

    // Per-item validation (complement zod).
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      // Each question.question must itself be atomic — no nested bundling.
      if (isBundledQuestion(item.question)) {
        return {
          title: "Question refused (bundled inside item)",
          output:
            `Question item #${i + 1} appears to contain multiple sub-questions. ` +
            `Each item in \`questions[]\` must be a single atomic question. ` +
            `Split sub-questions into separate items in the same tool call.`,
          truncated: false,
        };
      }
      if (item.answerType === "multi" && (!item.options || item.options.length < 2)) {
        return {
          title: "Question refused (multi requires 2+ options)",
          output:
            `Item #${i + 1} has answerType="multi" but fewer than 2 options. ` +
            `Provide at least two options, or use "single" / "free".`,
          truncated: false,
        };
      }
      if (item.answerType === "single" && item.options && item.options.length < 1) {
        return {
          title: "Question refused (single requires options)",
          output:
            `Item #${i + 1} has answerType="single" but empty options. ` +
            `Provide options or switch to answerType="free".`,
          truncated: false,
        };
      }
    }

    // Use the Vercel AI SDK toolCallId as the question ID — this is the same ID
    // stored in the tool_call part metadata and used by the UI / Telegram to
    // submit answers.
    const questionId = ctx.toolCallId ?? (await import("nanoid")).nanoid();

    const bus = getBus(ctx.instanceSlug ?? "default");

    // Emit event so the channel layer can display the question(s).
    // Populate legacy `question` / `options` fields for pre-v0.72 subscribers.
    const firstItem = items[0]!;
    bus.publish(QuestionAsked, {
      questionId,
      sessionId: ctx.sessionId,
      messageId: ctx.messageId,
      agentId: ctx.agentId,
      questions: items,
      question: firstItem.question,
      ...(firstItem.options !== undefined ? { options: firstItem.options } : {}),
    });

    // Wait for answer (or abort). Wrap in onLongWait so the prompt-loop
    // watchdogs don't fire while we wait for the human to respond.
    const waitForAnswer = (): Promise<string> =>
      new Promise<string>((resolve, reject) => {
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

    const rawAnswer = ctx.onLongWait ? await ctx.onLongWait(waitForAnswer) : await waitForAnswer();

    // Parse the payload. The UI / Telegram layers send a JSON array of
    // per-item answers. For single-legacy callers we fall back to treating
    // the raw string as a `free` answer or as the unique selected option.
    const parsed = parseAnswerPayload(rawAnswer, items);

    return {
      title: `Question: ${firstItem.question.slice(0, 50)}`,
      output: formatAnswers(items, parsed),
      truncated: false,
    };
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize the input params into a list of QuestionItem.
 * Accepts either the new `questions[]` shape or the legacy `{question, options}` pair.
 */
export function normalizeItems(params: z.infer<typeof QuestionInputSchema>): QuestionItem[] {
  if (params.questions && params.questions.length > 0) {
    return params.questions.map((q) => ({
      header: q.header,
      question: q.question,
      answerType: q.answerType ?? "single",
      ...(q.options !== undefined ? { options: q.options } : {}),
      allowOther: q.allowOther ?? false,
    }));
  }
  if (params.question !== undefined) {
    // Legacy single-question shape — auto-wrap.
    // When `options` is provided we treat it as "single" (existing semantics).
    // When no options → "free".
    const answerType: "single" | "free" =
      params.options && params.options.length > 0 ? "single" : "free";
    return [
      {
        header: "",
        question: params.question,
        answerType,
        ...(params.options !== undefined ? { options: params.options } : {}),
        allowOther: false,
      },
    ];
  }
  return [];
}

/**
 * Parse the answer payload written by the UI / Telegram layer.
 *
 * Expected formats:
 * - New (JSON array): `[{selected: ["opt1"], otherText?: "..."}, ...]` — one entry per item.
 * - Legacy (plain string): treated as the single-item answer (selected[0] for
 *   options-based, otherText for free).
 */
export function parseAnswerPayload(raw: string, items: QuestionItem[]): QuestionAnswerPayload[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return items.map((_, i) => {
        const entry = parsed[i] as { selected?: unknown; otherText?: unknown } | undefined;
        const selected = Array.isArray(entry?.selected)
          ? (entry.selected.filter((s): s is string => typeof s === "string") as string[])
          : [];
        const result: QuestionAnswerPayload = { selected };
        if (typeof entry?.otherText === "string" && entry.otherText.length > 0) {
          result.otherText = entry.otherText;
        }
        return result;
      });
    }
  } catch (err) {
    logger.debug("[question] parseAnswerPayload JSON.parse failed, using legacy fallback", {
      error: String(err),
    });
  }
  // Legacy: a single plain-string answer applies to the first (and only) item.
  const first = items[0];
  if (!first) return [];
  if (first.answerType === "free") {
    return [{ selected: [], otherText: raw }];
  }
  return [{ selected: [raw] }];
}
