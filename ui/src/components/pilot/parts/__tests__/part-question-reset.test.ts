// Tests that willUpdate does NOT reset tab state when the same toolCallId arrives
// via a new PilotPart object reference (simulates polling re-render).
import { describe, it, expect } from "vitest";

// Pure helper extracted from part-question.ts for testability — we import the
// source directly (no DOM needed for this logic test).
import { shouldResetQuestionState } from "../part-question.js";
import type { PilotPart } from "../../../../types.js";

function makePart(toolCallId: string): PilotPart {
  return {
    id: "part-1",
    messageId: "msg-1",
    type: "tool_call",
    toolName: "question",
    metadata: JSON.stringify({ toolCallId, args: { question: "Choose one", options: ["A", "B"] } }),
    content: null,
    createdAt: new Date().toISOString(),
  } as unknown as PilotPart;
}

describe("shouldResetQuestionState", () => {
  it("returns false when toolCallId is unchanged (new object reference)", () => {
    const oldPart = makePart("qid-001");
    const newPart = makePart("qid-001"); // same id, different reference
    expect(shouldResetQuestionState(oldPart, newPart)).toBe(false);
  });

  it("returns true when toolCallId changes", () => {
    const oldPart = makePart("qid-001");
    const newPart = makePart("qid-002");
    expect(shouldResetQuestionState(oldPart, newPart)).toBe(true);
  });

  it("returns true when oldPart is undefined (first render)", () => {
    expect(shouldResetQuestionState(undefined, makePart("qid-001"))).toBe(true);
  });
});
