/**
 * ui/src/components/pilot/parts/__tests__/part-question.test.ts
 *
 * Unit tests for PilotPartQuestion — focuses on the fallback path when the
 * tool_call metadata doesn't contain a parseable `questions[]` / `question`
 * shape (malformed LLM output or dropped `input` field from the provider
 * stream). Without the fallback, _hasPendingQuestion in the parent locks the
 * main chat input while the card renders nothing — a soft deadlock.
 *
 * Environment: vitest.ui.config.ts uses environment:"node" with no DOM. Lit
 * is mocked so the module loads; we exercise the instance's methods directly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks -------------------------------------------------------------------

vi.mock("lit", () => {
  class FakeLitElement {
    dispatchEvent(_event: Event): boolean {
      return true;
    }
  }
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) =>
    String.raw({ raw: strings }, ...values);
  return {
    LitElement: FakeLitElement,
    html: tag,
    css: tag,
    nothing: Symbol("nothing"),
  };
});

vi.mock("lit/decorators.js", () => ({
  customElement: () => (cls: unknown) => cls,
  property: () => () => {},
  state: () => () => {},
}));

vi.mock("@lit/localize", () => ({
  localized: () => (cls: unknown) => cls,
  msg: (str: string) => str,
}));

vi.mock("../../../../styles/tokens.js", () => ({
  tokenStyles: "",
}));

vi.mock("../../../../api.js", () => ({
  answerQuestion: vi.fn(),
}));

// --- Import after mocks ------------------------------------------------------

import { answerQuestion } from "../../../../api.js";
import { PilotPartQuestion } from "../part-question.js";

const mockAnswerQuestion = vi.mocked(answerQuestion);

// --- Helpers ----------------------------------------------------------------

interface PartQuestionInternal {
  call: { metadata?: string | undefined; content?: string; state?: string };
  slug: string;
  _fallbackText: string;
  _submitting: boolean;
  _answered: boolean;
  _submitFallback: () => Promise<void>;
  dispatchEvent: (evt: Event) => boolean;
}

function makeEl(metadata: unknown, slug = "my-team"): PartQuestionInternal {
  const el = new PilotPartQuestion() as unknown as PartQuestionInternal;
  el.call = metadata === undefined ? {} : { metadata: JSON.stringify(metadata) };
  el.slug = slug;
  el._fallbackText = "";
  el._submitting = false;
  el._answered = false;
  return el;
}

// --- Tests ------------------------------------------------------------------

describe("PilotPartQuestion — fallback submission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submits fallback text via answerQuestion when metadata has no parseable items", async () => {
    mockAnswerQuestion.mockResolvedValue({ ok: true });
    // Metadata with toolName=question but no `questions[]` / `question` — the
    // exact malformed shape the fallback card is designed to rescue.
    const el = makeEl({ toolCallId: "call-1", toolName: "question", args: {} });
    el._fallbackText = "my free-text answer";

    await el._submitFallback();

    expect(mockAnswerQuestion).toHaveBeenCalledTimes(1);
    expect(mockAnswerQuestion).toHaveBeenCalledWith("my-team", "call-1", "my free-text answer");
    expect(el._answered).toBe(true);
    expect(el._submitting).toBe(false);
  });

  it("trims whitespace before submitting", async () => {
    mockAnswerQuestion.mockResolvedValue({ ok: true });
    const el = makeEl({ toolCallId: "call-2", toolName: "question", args: {} });
    el._fallbackText = "   padded answer   ";

    await el._submitFallback();

    expect(mockAnswerQuestion).toHaveBeenCalledWith("my-team", "call-2", "padded answer");
  });

  it("is a no-op when fallback text is empty or whitespace-only", async () => {
    const el = makeEl({ toolCallId: "call-3", toolName: "question", args: {} });
    el._fallbackText = "   ";

    await el._submitFallback();

    expect(mockAnswerQuestion).not.toHaveBeenCalled();
    expect(el._answered).toBe(false);
  });

  it("is a no-op when already submitting", async () => {
    const el = makeEl({ toolCallId: "call-4", toolName: "question", args: {} });
    el._fallbackText = "hello";
    el._submitting = true;

    await el._submitFallback();

    expect(mockAnswerQuestion).not.toHaveBeenCalled();
  });

  it("is a no-op when already answered", async () => {
    const el = makeEl({ toolCallId: "call-5", toolName: "question", args: {} });
    el._fallbackText = "hello";
    el._answered = true;

    await el._submitFallback();

    expect(mockAnswerQuestion).not.toHaveBeenCalled();
  });

  it("is a no-op when toolCallId is missing from metadata", async () => {
    const el = makeEl({ toolName: "question", args: {} });
    el._fallbackText = "hello";

    await el._submitFallback();

    expect(mockAnswerQuestion).not.toHaveBeenCalled();
    expect(el._answered).toBe(false);
  });

  it("is a no-op when slug is empty", async () => {
    const el = makeEl({ toolCallId: "call-6", toolName: "question", args: {} }, "");
    el._fallbackText = "hello";

    await el._submitFallback();

    expect(mockAnswerQuestion).not.toHaveBeenCalled();
  });

  it("leaves _answered false and clears _submitting when the API rejects", async () => {
    mockAnswerQuestion.mockRejectedValue(new Error("Network timeout"));
    const el = makeEl({ toolCallId: "call-7", toolName: "question", args: {} });
    el._fallbackText = "hello";

    await el._submitFallback();

    expect(mockAnswerQuestion).toHaveBeenCalledTimes(1);
    expect(el._answered).toBe(false);
    expect(el._submitting).toBe(false);
  });

  it("dispatches question-answered event on successful fallback submission", async () => {
    mockAnswerQuestion.mockResolvedValue({ ok: true });
    const el = makeEl({ toolCallId: "call-8", toolName: "question", args: {} });
    el._fallbackText = "hello";

    const dispatched: CustomEvent[] = [];
    vi.spyOn(el, "dispatchEvent").mockImplementation((evt: Event) => {
      dispatched.push(evt as CustomEvent);
      return true;
    });

    await el._submitFallback();

    const answered = dispatched.find((e) => e.type === "question-answered");
    expect(answered).toBeDefined();
    expect((answered as CustomEvent).detail).toEqual({ questionId: "call-8" });
  });
});
