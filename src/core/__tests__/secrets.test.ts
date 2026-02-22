// src/core/__tests__/secrets.test.ts
import { describe, it, expect } from "vitest";
import { generateGatewayToken, generateDashboardToken, maskSecret } from "../secrets.js";

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

  it("maskSecret shows first 8 chars and ***", () => {
    const secret = "abcdefghijklmnop";
    expect(maskSecret(secret)).toBe("abcdefgh***");
  });

  it("maskSecret with short secret returns ***", () => {
    expect(maskSecret("short")).toBe("***");
  });
});
