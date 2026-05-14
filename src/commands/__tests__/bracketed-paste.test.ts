import { describe, it, expect } from "vitest";
import { parseBracketedPaste } from "../_bracketed-paste.js";

describe("parseBracketedPaste", () => {
  it("detects start marker", () => {
    const result = parseBracketedPaste("\x1b[200~hello\nworld\x1b[201~", {
      inPaste: false,
      buffer: "",
    });
    expect(result.complete).toBe(true);
    expect(result.text).toBe("hello\nworld");
    expect(result.state.inPaste).toBe(false);
  });

  it("handles split chunks — start chunk", () => {
    const r1 = parseBracketedPaste("\x1b[200~line1\n", { inPaste: false, buffer: "" });
    expect(r1.complete).toBe(false);
    expect(r1.state.inPaste).toBe(true);
    expect(r1.state.buffer).toBe("line1\n");
  });

  it("handles split chunks — end chunk", () => {
    const r2 = parseBracketedPaste("line2\x1b[201~", { inPaste: true, buffer: "line1\n" });
    expect(r2.complete).toBe(true);
    expect(r2.text).toBe("line1\nline2");
  });

  it("returns null for normal (non-paste) input", () => {
    const r = parseBracketedPaste("hello", { inPaste: false, buffer: "" });
    expect(r.complete).toBe(false);
    expect(r.state.inPaste).toBe(false);
  });
});
