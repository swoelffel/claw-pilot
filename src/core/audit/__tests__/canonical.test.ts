// src/core/audit/__tests__/canonical.test.ts
import { describe, it, expect } from "vitest";
import { canonicalize, hashArgs } from "../canonical.js";

describe("canonicalize", () => {
  it("sorts keys lexicographically at every level", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize({ b: { y: 2, x: 1 }, a: 0 })).toBe('{"a":0,"b":{"x":1,"y":2}}');
  });

  it("produces identical output for structurally-equal inputs in different orders", () => {
    const a = canonicalize({ query: "foo", limit: 10, offset: 0 });
    const b = canonicalize({ offset: 0, limit: 10, query: "foo" });
    expect(a).toBe(b);
  });

  it("preserves array order", () => {
    expect(canonicalize({ items: [3, 1, 2] })).toBe('{"items":[3,1,2]}');
  });

  it("sorts keys inside arrays of objects", () => {
    expect(canonicalize([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });

  it("handles primitives and null", () => {
    expect(canonicalize(42)).toBe("42");
    expect(canonicalize("x")).toBe('"x"');
    expect(canonicalize(null)).toBe("null");
  });
});

describe("hashArgs", () => {
  it("returns a 64-char hex SHA-256 digest", () => {
    const h = hashArgs({ a: 1 });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("collides only for canonically-equal inputs", () => {
    expect(hashArgs({ a: 1, b: 2 })).toBe(hashArgs({ b: 2, a: 1 }));
    expect(hashArgs({ a: 1, b: 2 })).not.toBe(hashArgs({ a: 1, b: 3 }));
  });
});
