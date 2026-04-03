/**
 * ui/src/services/__tests__/auth-state.test.ts
 *
 * Unit tests for the auth-state module.
 * Pure functions — no mocks needed.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { setToken, getToken, clearToken } from "../auth-state.js";

describe("auth-state", () => {
  beforeEach(() => {
    clearToken();
  });

  it("getToken returns empty string when no token is set", () => {
    expect(getToken()).toBe("");
  });

  it("setToken stores a token retrievable by getToken", () => {
    setToken("abc123");
    expect(getToken()).toBe("abc123");
  });

  it("setToken overwrites a previously set token", () => {
    setToken("first");
    setToken("second");
    expect(getToken()).toBe("second");
  });

  it("clearToken resets to empty string", () => {
    setToken("token-to-clear");
    clearToken();
    expect(getToken()).toBe("");
  });

  it("setToken handles empty string", () => {
    setToken("");
    expect(getToken()).toBe("");
  });

  it("setToken handles long tokens", () => {
    const longToken = "x".repeat(512);
    setToken(longToken);
    expect(getToken()).toBe(longToken);
  });
});
