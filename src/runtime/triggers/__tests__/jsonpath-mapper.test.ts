// src/runtime/triggers/__tests__/jsonpath-mapper.test.ts

import { describe, it, expect } from "vitest";
import { applyInputMapping } from "../jsonpath-mapper.js";

describe("applyInputMapping", () => {
  it("returns {} for null mapping", () => {
    expect(applyInputMapping({ a: 1 }, null)).toEqual({});
  });

  it("returns {} for empty mapping", () => {
    expect(applyInputMapping({ a: 1 }, [])).toEqual({});
  });

  it("resolves top-level paths", () => {
    expect(applyInputMapping({ a: 1, b: 2 }, [{ from: "$.a", to: "x" }])).toEqual({ x: 1 });
  });

  it("resolves nested paths", () => {
    const payload = { pull_request: { number: 42 }, repository: { full_name: "foo/bar" } };
    expect(
      applyInputMapping(payload, [
        { from: "$.pull_request.number", to: "pr" },
        { from: "$.repository.full_name", to: "repo" },
      ]),
    ).toEqual({ pr: 42, repo: "foo/bar" });
  });

  it("returns null for missing paths", () => {
    expect(applyInputMapping({ a: 1 }, [{ from: "$.missing", to: "x" }])).toEqual({ x: null });
  });

  it("handles arrays via JSONPath bracket notation", () => {
    expect(
      applyInputMapping({ items: [10, 20, 30] }, [{ from: "$.items[1]", to: "second" }]),
    ).toEqual({ second: 20 });
  });

  it("ignores malformed entries", () => {
    expect(
      applyInputMapping({ a: 1 }, [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { from: 123 as any, to: "x" },
        { from: "$.a", to: "y" },
      ]),
    ).toEqual({ y: 1 });
  });

  it("returns null on JSONPath errors instead of throwing", () => {
    // Empty/invalid path
    expect(applyInputMapping({ a: 1 }, [{ from: "", to: "x" }])).toEqual({ x: null });
  });
});
