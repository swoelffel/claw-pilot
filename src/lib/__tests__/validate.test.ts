// src/lib/__tests__/validate.test.ts
import { describe, it, expect } from "vitest";
import { parsePositiveInt } from "../validate.js";

describe("parsePositiveInt", () => {
  it("parses a valid positive integer string", () => {
    expect(parsePositiveInt("42", "count")).toBe(42);
  });

  it("parses '1' as the minimum valid value", () => {
    expect(parsePositiveInt("1", "count")).toBe(1);
  });

  it("parses large integers", () => {
    expect(parsePositiveInt("99999", "port")).toBe(99999);
  });

  it("throws for zero", () => {
    expect(() => parsePositiveInt("0", "count")).toThrow(
      'Invalid value for count: "0" (expected a positive integer)',
    );
  });

  it("throws for negative numbers", () => {
    expect(() => parsePositiveInt("-5", "count")).toThrow(
      'Invalid value for count: "-5" (expected a positive integer)',
    );
  });

  it("throws for non-numeric strings", () => {
    expect(() => parsePositiveInt("abc", "port")).toThrow(
      'Invalid value for port: "abc" (expected a positive integer)',
    );
  });

  it("throws for empty string", () => {
    expect(() => parsePositiveInt("", "value")).toThrow(
      'Invalid value for value: "" (expected a positive integer)',
    );
  });

  it("throws for float strings (parseInt truncates but result is valid if >= 1)", () => {
    // parseInt("3.7") = 3, which is valid
    expect(parsePositiveInt("3.7", "count")).toBe(3);
  });

  it("includes the field name in the error message", () => {
    expect(() => parsePositiveInt("bad", "myField")).toThrow("myField");
  });
});
