import { describe, it, expect } from "vitest";

// We test the deduplication guard on the question registry.
// Import the exported helpers — if they don't exist yet, this test will fail.
import { createQuestionRegistry, type QuestionRegistry } from "../question.js";

describe("QuestionRegistry deduplication", () => {
  it("resolves the first call and ignores a second call for the same id", async () => {
    const registry: QuestionRegistry = createQuestionRegistry();
    const answeredValues: string[] = [];

    // Register a pending question
    const promise = registry.register("qid-001", () => {
      answeredValues.push("resolved");
    });

    // First resolution
    registry.resolve("qid-001", "answer-1");
    await promise;
    expect(answeredValues).toEqual(["resolved"]);

    // Second resolution for same id — must be a no-op
    expect(() => registry.resolve("qid-001", "answer-2")).not.toThrow();
    expect(answeredValues).toEqual(["resolved"]); // unchanged
  });

  it("returns false from resolve() when id is unknown", () => {
    const registry = createQuestionRegistry();
    const resolved = registry.resolve("unknown-id", "answer");
    expect(resolved).toBe(false);
  });
});
