// src/core/__tests__/secrets.test.ts
import { describe, it, expect } from "vitest";
import { generateGatewayToken, generateDashboardToken } from "../secrets.js";
import { maskSecret } from "../config-helpers.js";

describe("secrets", () => {
  it("generateGatewayToken returns 48-char hex string", () => {
    const token = generateGatewayToken();
    expect(token).toHaveLength(48);
    expect(token).toMatch(/^[0-9a-f]+$/);
  });

  it("generateGatewayToken generates unique tokens", () => {
    const a = generateGatewayToken();
    const b = generateGatewayToken();
    expect(a).not.toBe(b);
  });

  it("generateDashboardToken returns 64-char hex string", () => {
    const token = generateDashboardToken();
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]+$/);
  });

  it("maskSecret shows first 8 chars + *** + last 4 chars", () => {
    // "abcdefghijklmnop" is 16 chars (> 12), so: first8 + *** + last4
    const secret = "abcdefghijklmnop";
    expect(maskSecret(secret)).toBe("abcdefgh***mnop");
  });

  it("maskSecret with short secret (<=12 chars) returns ****", () => {
    expect(maskSecret("short")).toBe("****");
  });

  it("maskSecret with undefined returns null", () => {
    expect(maskSecret(undefined)).toBeNull();
  });
});
