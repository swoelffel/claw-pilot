// src/runtime/flow/__tests__/sitrep-normalizer.test.ts

import { describe, it, expect } from "vitest";
import { normaliseSitrepArgs } from "../_sitrep-normalizer.js";

describe("normaliseSitrepArgs", () => {
  it("passes through a valid object unchanged", () => {
    const input = { outcome: "success", summary: "Done.", keyFindings: [] };
    expect(normaliseSitrepArgs(input)).toEqual(input);
  });

  it("extracts JSON from markdown code fence", () => {
    const raw = '```json\n{"outcome":"success","summary":"Done.","keyFindings":[]}\n```';
    expect(normaliseSitrepArgs(raw)).toMatchObject({ outcome: "success" });
  });

  it("extracts JSON from single backtick fence", () => {
    const raw = '`{"outcome":"failure","summary":"Error.","keyFindings":[]}`';
    expect(normaliseSitrepArgs(raw)).toMatchObject({ outcome: "failure" });
  });

  it("strips XML wrapper and parses inner JSON", () => {
    const raw = '<sitrep>{"outcome":"partial","summary":"Half done.","keyFindings":[]}</sitrep>';
    expect(normaliseSitrepArgs(raw)).toMatchObject({ outcome: "partial" });
  });

  it("normalises outcome to lowercase", () => {
    const input = { outcome: "SUCCESS", summary: "Done.", keyFindings: [] };
    const result = normaliseSitrepArgs(input) as Record<string, unknown>;
    expect(result["outcome"]).toBe("success");
  });

  it("returns input unchanged when it cannot be normalised (Zod will reject)", () => {
    // Garbage input — let Zod handle the rejection
    const raw = "this is not json at all";
    expect(normaliseSitrepArgs(raw)).toBe(raw);
  });
});
