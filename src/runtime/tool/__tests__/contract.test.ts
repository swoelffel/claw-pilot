// src/runtime/tool/__tests__/contract.test.ts
import { describe, it, expect } from "vitest";
import {
  buildContractPrompt,
  parseContractVerdict,
  isContractSatisfied,
  buildRetryFeedback,
  formatContractReport,
  type CriterionVerdict,
} from "../task.js";

// ---------------------------------------------------------------------------
// buildContractPrompt
// ---------------------------------------------------------------------------

describe("buildContractPrompt", () => {
  it("generates numbered criteria with all_pass grading", () => {
    const result = buildContractPrompt(["File exists", "Content matches"], "all_pass");
    expect(result).toContain("ALL criteria must pass");
    expect(result).toContain("1. File exists");
    expect(result).toContain("2. Content matches");
    expect(result).toContain("<contract_verdict>");
    expect(result).toContain('id="1"');
    expect(result).toContain('id="2"');
  });

  it("generates threshold grading description", () => {
    const result = buildContractPrompt(["A", "B", "C"], { threshold: 2 });
    expect(result).toContain("at least 2 criteria must pass");
  });

  it("handles single criterion", () => {
    const result = buildContractPrompt(["Only one"], "all_pass");
    expect(result).toContain("1. Only one");
    expect(result).not.toContain("2.");
  });
});

// ---------------------------------------------------------------------------
// parseContractVerdict
// ---------------------------------------------------------------------------

describe("parseContractVerdict", () => {
  it("parses well-formed verdict block", () => {
    const text = `
Here is my work.
<contract_verdict>
  <criterion id="1" status="PASS">File was created successfully</criterion>
  <criterion id="2" status="FAIL">Content is empty</criterion>
</contract_verdict>
    `;
    const verdicts = parseContractVerdict(text, 2);
    expect(verdicts).toHaveLength(2);
    expect(verdicts[0]).toEqual({
      id: "1",
      status: "PASS",
      explanation: "File was created successfully",
    });
    expect(verdicts[1]).toEqual({
      id: "2",
      status: "FAIL",
      explanation: "Content is empty",
    });
  });

  it("returns all FAIL when no verdict block found", () => {
    const verdicts = parseContractVerdict("No verdict here", 3);
    expect(verdicts).toHaveLength(3);
    expect(verdicts.every((v) => v.status === "FAIL")).toBe(true);
    expect(verdicts[0]!.explanation).toContain("No contract_verdict block");
  });

  it("fills missing criteria as FAIL", () => {
    const text = `
<contract_verdict>
  <criterion id="1" status="PASS">OK</criterion>
</contract_verdict>
    `;
    const verdicts = parseContractVerdict(text, 3);
    expect(verdicts).toHaveLength(3);
    expect(verdicts[0]!.status).toBe("PASS");
    expect(verdicts[1]!.status).toBe("FAIL");
    expect(verdicts[1]!.explanation).toContain("not reported");
    expect(verdicts[2]!.status).toBe("FAIL");
  });

  it("sorts verdicts by criterion id", () => {
    const text = `
<contract_verdict>
  <criterion id="3" status="PASS">Third</criterion>
  <criterion id="1" status="FAIL">First</criterion>
  <criterion id="2" status="PASS">Second</criterion>
</contract_verdict>
    `;
    const verdicts = parseContractVerdict(text, 3);
    expect(verdicts.map((v) => v.id)).toEqual(["1", "2", "3"]);
  });

  it("handles multiline explanations", () => {
    const text = `
<contract_verdict>
  <criterion id="1" status="FAIL">The file exists but
the content does not match the expected format</criterion>
</contract_verdict>
    `;
    const verdicts = parseContractVerdict(text, 1);
    expect(verdicts[0]!.explanation).toContain("content does not match");
  });
});

// ---------------------------------------------------------------------------
// isContractSatisfied
// ---------------------------------------------------------------------------

describe("isContractSatisfied", () => {
  const pass: CriterionVerdict = { id: "1", status: "PASS", explanation: "OK" };
  const fail: CriterionVerdict = { id: "2", status: "FAIL", explanation: "KO" };

  it("all_pass: returns true when all pass", () => {
    expect(isContractSatisfied([pass, { ...pass, id: "2" }], "all_pass")).toBe(true);
  });

  it("all_pass: returns false when any fails", () => {
    expect(isContractSatisfied([pass, fail], "all_pass")).toBe(false);
  });

  it("all_pass: returns false when all fail", () => {
    expect(isContractSatisfied([fail], "all_pass")).toBe(false);
  });

  it("threshold: returns true when enough pass", () => {
    expect(isContractSatisfied([pass, fail, { ...pass, id: "3" }], { threshold: 2 })).toBe(true);
  });

  it("threshold: returns false when not enough pass", () => {
    expect(isContractSatisfied([pass, fail, { ...fail, id: "3" }], { threshold: 2 })).toBe(false);
  });

  it("threshold: exact boundary passes", () => {
    expect(isContractSatisfied([pass], { threshold: 1 })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildRetryFeedback
// ---------------------------------------------------------------------------

describe("buildRetryFeedback", () => {
  it("includes failed criteria with explanations", () => {
    const verdicts: CriterionVerdict[] = [
      { id: "1", status: "PASS", explanation: "OK" },
      { id: "2", status: "FAIL", explanation: "Missing header" },
    ];
    const result = buildRetryFeedback(verdicts, ["Has content", "Has header"], 2, 3);
    expect(result).toContain("Iteration 2/3");
    expect(result).toContain("FAILED criteria");
    expect(result).toContain('"Has header"');
    expect(result).toContain("Missing header");
    expect(result).toContain("PASSED criteria");
    expect(result).toContain('"Has content"');
  });

  it("omits passed section when all failed", () => {
    const verdicts: CriterionVerdict[] = [{ id: "1", status: "FAIL", explanation: "Bad" }];
    const result = buildRetryFeedback(verdicts, ["Criterion 1"], 1, 3);
    expect(result).toContain("FAILED criteria");
    expect(result).not.toContain("PASSED criteria");
  });
});

// ---------------------------------------------------------------------------
// formatContractReport
// ---------------------------------------------------------------------------

describe("formatContractReport", () => {
  it("formats a passing report", () => {
    const verdicts: CriterionVerdict[] = [
      { id: "1", status: "PASS", explanation: "Created" },
      { id: "2", status: "PASS", explanation: "Matches" },
    ];
    const result = formatContractReport(verdicts, ["File exists", "Content OK"], 1, 3, true);
    expect(result).toContain("<contract_report>");
    expect(result).toContain("</contract_report>");
    expect(result).toContain('status="PASS"');
    expect(result).toContain("iterations_used: 1/3");
    expect(result).toContain("final_verdict: PASS");
  });

  it("formats a failing report", () => {
    const verdicts: CriterionVerdict[] = [
      { id: "1", status: "PASS", explanation: "OK" },
      { id: "2", status: "FAIL", explanation: "Wrong" },
    ];
    const result = formatContractReport(verdicts, ["A", "B"], 3, 3, false);
    expect(result).toContain("iterations_used: 3/3");
    expect(result).toContain("final_verdict: FAIL");
  });
});
