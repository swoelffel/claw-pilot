// src/runtime/triggers/__tests__/webhook-verifier.test.ts

import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { hashPayload, isIpAllowed, verifyHmacSignature } from "../webhook-verifier.js";

function sign(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

describe("verifyHmacSignature", () => {
  const secret = "shared-secret-value";
  const body = '{"hello":"world"}';

  it("accepts a valid signature", () => {
    expect(verifyHmacSignature(secret, body, sign(secret, body))).toBe(true);
  });

  it("rejects a wrong signature", () => {
    expect(verifyHmacSignature(secret, body, sign("wrong", body))).toBe(false);
  });

  it("rejects a tampered body", () => {
    expect(verifyHmacSignature(secret, body + "x", sign(secret, body))).toBe(false);
  });

  it("rejects when prefix is missing", () => {
    const expected = createHmac("sha256", secret).update(body, "utf8").digest("hex");
    expect(verifyHmacSignature(secret, body, expected)).toBe(false);
  });

  it("rejects malformed hex", () => {
    expect(verifyHmacSignature(secret, body, "sha256=NOT-HEX")).toBe(false);
  });

  it("rejects when header or secret is empty", () => {
    expect(verifyHmacSignature("", body, sign(secret, body))).toBe(false);
    expect(verifyHmacSignature(secret, body, "")).toBe(false);
  });

  it("tolerates uppercase hex digits", () => {
    const expected = createHmac("sha256", secret).update(body, "utf8").digest("hex");
    const sig = "sha256=" + expected.toUpperCase();
    expect(verifyHmacSignature(secret, body, sig)).toBe(true);
  });

  it("rejects when length differs", () => {
    expect(verifyHmacSignature(secret, body, "sha256=abcd")).toBe(false);
  });
});

describe("isIpAllowed", () => {
  it("allows when allowlist is null/empty", () => {
    expect(isIpAllowed("1.2.3.4", null)).toBe(true);
    expect(isIpAllowed("1.2.3.4", [])).toBe(true);
  });

  it("rejects with empty IP and a non-empty allowlist", () => {
    expect(isIpAllowed("", ["1.2.3.4"])).toBe(false);
  });

  it("matches exact IPv4", () => {
    expect(isIpAllowed("10.0.0.1", ["10.0.0.1"])).toBe(true);
    expect(isIpAllowed("10.0.0.2", ["10.0.0.1"])).toBe(false);
  });

  it("matches IPv4 CIDR", () => {
    expect(isIpAllowed("10.0.0.55", ["10.0.0.0/24"])).toBe(true);
    expect(isIpAllowed("10.0.1.1", ["10.0.0.0/24"])).toBe(false);
    expect(isIpAllowed("10.0.0.1", ["10.0.0.0/8"])).toBe(true);
  });

  it("supports /0 (allow any)", () => {
    expect(isIpAllowed("8.8.8.8", ["0.0.0.0/0"])).toBe(true);
  });

  it("matches IPv6 exact and CIDR", () => {
    expect(isIpAllowed("::1", ["::1"])).toBe(true);
    expect(isIpAllowed("2001:db8::1", ["2001:db8::/32"])).toBe(true);
    expect(isIpAllowed("2001:dead::1", ["2001:db8::/32"])).toBe(false);
  });

  it("rejects malformed entries gracefully", () => {
    expect(isIpAllowed("10.0.0.1", ["not-an-ip"])).toBe(false);
    expect(isIpAllowed("10.0.0.1", ["10.0.0.0/abc"])).toBe(false);
    expect(isIpAllowed("10.0.0.1", ["10.0.0.0/40"])).toBe(false);
  });

  it("does not cross-match v4 and v6", () => {
    expect(isIpAllowed("10.0.0.1", ["::1"])).toBe(false);
    expect(isIpAllowed("::1", ["10.0.0.1"])).toBe(false);
  });
});

describe("hashPayload", () => {
  it("is deterministic", () => {
    expect(hashPayload("hello")).toBe(hashPayload("hello"));
  });

  it("differs across inputs", () => {
    expect(hashPayload("a")).not.toBe(hashPayload("b"));
  });

  it("returns 64-char hex", () => {
    expect(hashPayload("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});
