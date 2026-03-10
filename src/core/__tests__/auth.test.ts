// src/core/__tests__/auth.test.ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, generatePassword } from "../auth.js";

describe("hashPassword / verifyPassword", () => {
  it("returns a string in scrypt:<salt>:<hash> format", async () => {
    const hash = await hashPassword("mypassword");
    expect(hash).toMatch(/^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/);
  });

  it("verifyPassword returns true for the correct password", async () => {
    const hash = await hashPassword("mypassword");
    expect(await verifyPassword("mypassword", hash)).toBe(true);
  });

  it("verifyPassword returns false for a wrong password", async () => {
    const hash = await hashPassword("mypassword");
    expect(await verifyPassword("wrongpassword", hash)).toBe(false);
  });

  it("two hashes of the same password are different (random salt)", async () => {
    const hash1 = await hashPassword("same");
    const hash2 = await hashPassword("same");
    expect(hash1).not.toBe(hash2);
    // Both still verify correctly
    expect(await verifyPassword("same", hash1)).toBe(true);
    expect(await verifyPassword("same", hash2)).toBe(true);
  });
});

describe("verifyPassword — invalid formats", () => {
  it("returns false for a non-scrypt string (no throw)", async () => {
    expect(await verifyPassword("x", "not-a-valid-hash")).toBe(false);
  });

  it("returns false for bad hex values (no throw)", async () => {
    expect(await verifyPassword("x", "scrypt:badhex:badhex")).toBe(false);
  });

  it("returns false for an empty string (no throw)", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
  });

  it("returns false for wrong algo prefix (no throw)", async () => {
    expect(await verifyPassword("x", "argon2:abc:def")).toBe(false);
  });
});

describe("generatePassword", () => {
  const AMBIGUOUS = /[0O1lI]/;

  it("returns a string of length 16", () => {
    expect(generatePassword()).toHaveLength(16);
  });

  it("contains no ambiguous characters (0, O, 1, l, I)", () => {
    for (let i = 0; i < 50; i++) {
      expect(generatePassword()).not.toMatch(AMBIGUOUS);
    }
  });

  it("generates unique passwords (100 calls, all different)", () => {
    const passwords = new Set(Array.from({ length: 100 }, () => generatePassword()));
    expect(passwords.size).toBe(100);
  });
});
