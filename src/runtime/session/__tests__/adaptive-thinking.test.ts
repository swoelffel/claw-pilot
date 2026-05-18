// src/runtime/session/__tests__/adaptive-thinking.test.ts

import { describe, it, expect } from "vitest";
import { isAdaptiveThinkingModel } from "../prompt-loop.js";

describe("isAdaptiveThinkingModel", () => {
  it("returns true for claude-opus-4-x models", () => {
    expect(isAdaptiveThinkingModel("claude-opus-4-5")).toBe(true);
    expect(isAdaptiveThinkingModel("claude-opus-4-6")).toBe(true);
    expect(isAdaptiveThinkingModel("claude-opus-4-7")).toBe(true);
  });

  it("returns true for claude-sonnet-4-x models", () => {
    expect(isAdaptiveThinkingModel("claude-sonnet-4-5")).toBe(true);
    expect(isAdaptiveThinkingModel("claude-sonnet-4-6")).toBe(true);
  });

  it("returns true for claude-haiku-4-x models", () => {
    expect(isAdaptiveThinkingModel("claude-haiku-4-5")).toBe(true);
  });

  it("returns false for claude-3-x models", () => {
    expect(isAdaptiveThinkingModel("claude-3-5-sonnet-20241022")).toBe(false);
    expect(isAdaptiveThinkingModel("claude-3-7-sonnet-20250219")).toBe(false);
    expect(isAdaptiveThinkingModel("claude-3-opus-20240229")).toBe(false);
    expect(isAdaptiveThinkingModel("claude-haiku-3-5")).toBe(false);
  });

  it("returns false for unknown or non-anthropic model IDs", () => {
    expect(isAdaptiveThinkingModel("gpt-4o")).toBe(false);
    expect(isAdaptiveThinkingModel("gemini-2-0-flash")).toBe(false);
    expect(isAdaptiveThinkingModel("")).toBe(false);
  });
});
