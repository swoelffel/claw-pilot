// src/runtime/flow/__tests__/sitrep.test.ts
import { describe, it, expect } from "vitest";
import { extractSitrep, formatSitrepsForBriefing } from "../sitrep.js";

describe("extractSitrep", () => {
  it("extracts structured SITREP from well-formatted response", () => {
    const text = [
      "I completed the analysis.",
      "",
      "OUTCOME: success",
      "SUMMARY: All data was reconciled with 98% match rate.",
      "KEY FINDINGS:",
      "- 3 orphan transactions detected",
      "- Vendor X has consistent 2-day delay",
      "- No critical anomalies found",
    ].join("\n");

    const sitrep = extractSitrep(text);
    expect(sitrep.outcome).toBe("success");
    expect(sitrep.summary).toBe("All data was reconciled with 98% match rate.");
    expect(sitrep.keyFindings).toHaveLength(3);
    expect(sitrep.keyFindings[0]).toBe("3 orphan transactions detected");
  });

  it("handles failure outcome", () => {
    const text = "OUTCOME: failure\nSUMMARY: Could not connect to the database.";
    const sitrep = extractSitrep(text);
    expect(sitrep.outcome).toBe("failure");
    expect(sitrep.summary).toBe("Could not connect to the database.");
    expect(sitrep.keyFindings).toHaveLength(0);
  });

  it("handles partial outcome", () => {
    const text = "OUTCOME: partial\nSUMMARY: Only 60% of data was processed.";
    const sitrep = extractSitrep(text);
    expect(sitrep.outcome).toBe("partial");
  });

  it("falls back to partial when no structured format found", () => {
    const text = "I did some work but did not follow the format.";
    const sitrep = extractSitrep(text);
    expect(sitrep.outcome).toBe("partial");
    expect(sitrep.summary).toBe(text);
    expect(sitrep.keyFindings).toHaveLength(0);
  });

  it("truncates long unformatted responses to 500 chars", () => {
    const text = "A".repeat(1000);
    const sitrep = extractSitrep(text);
    expect(sitrep.summary.length).toBeLessThanOrEqual(500);
  });

  it("handles bullet points with various markers", () => {
    const text = [
      "OUTCOME: success",
      "SUMMARY: Done.",
      "KEY FINDINGS:",
      "* Item one",
      "• Item two",
      "- Item three",
    ].join("\n");
    const sitrep = extractSitrep(text);
    expect(sitrep.keyFindings).toEqual(["Item one", "Item two", "Item three"]);
  });

  it("is case-insensitive for outcome labels", () => {
    const text = "outcome: SUCCESS\nsummary: It worked.";
    const sitrep = extractSitrep(text);
    expect(sitrep.outcome).toBe("success");
    expect(sitrep.summary).toBe("It worked.");
  });

  it("extracts from markdown-decorated labels (## **OUTCOME**:)", () => {
    const text = [
      "Some preamble text.",
      "",
      "## **OUTCOME**: success",
      "",
      "## **SUMMARY**: Score 74/100 with critical risk detected.",
      "",
      "## **KEY FINDINGS**:",
      "- Score 74/100",
      "- Critical: ops-audit activity anomaly",
      "- PATH configuration broken",
    ].join("\n");

    const sitrep = extractSitrep(text);
    expect(sitrep.outcome).toBe("success");
    expect(sitrep.summary).toBe("Score 74/100 with critical risk detected.");
    expect(sitrep.keyFindings).toHaveLength(3);
    expect(sitrep.keyFindings[0]).toBe("Score 74/100");
  });

  it("extracts from bold-only labels (**OUTCOME**:)", () => {
    const text = [
      "**OUTCOME**: partial",
      "**SUMMARY**: Partial results obtained.",
      "**KEY FINDINGS**:",
      "- Finding A",
    ].join("\n");

    const sitrep = extractSitrep(text);
    expect(sitrep.outcome).toBe("partial");
    expect(sitrep.summary).toBe("Partial results obtained.");
    expect(sitrep.keyFindings).toEqual(["Finding A"]);
  });
});

describe("formatSitrepsForBriefing", () => {
  it("returns empty string when no SITREPs", () => {
    expect(formatSitrepsForBriefing([])).toBe("");
  });

  it("formats multiple SITREPs for briefing", () => {
    const result = formatSitrepsForBriefing([
      {
        stepId: "extract",
        sitrep: {
          outcome: "success",
          summary: "Data extracted successfully.",
          keyFindings: ["100 records found"],
        },
      },
      {
        stepId: "validate",
        sitrep: {
          outcome: "partial",
          summary: "80% validated.",
          keyFindings: [],
        },
      },
    ]);
    expect(result).toContain("### Previous step results");
    expect(result).toContain('Step "extract"');
    expect(result).toContain("Data extracted successfully.");
    expect(result).toContain("100 records found");
    expect(result).toContain('Step "validate"');
    expect(result).toContain("80% validated.");
  });
});
