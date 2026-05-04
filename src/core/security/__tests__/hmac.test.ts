// src/core/security/__tests__/hmac.test.ts
import { describe, it, expect } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { DEFAULT_HMAC_ALGO, HMAC_ALGOS, signPayload, verifySignature } from "../hmac.js";

const SECRET = "tres-secret-shh";

describe("signPayload", () => {
  it("produces a `sha256=<hex>` header by default", () => {
    const sig = signPayload(SECRET, "hello world");
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);

    // The hex must match the raw createHmac output, byte for byte.
    const expected = createHmac("sha256", SECRET).update("hello world", "utf8").digest("hex");
    expect(sig).toBe(`sha256=${expected}`);
  });

  it("supports the wider algo allowlist when caller opts in", () => {
    const sig384 = signPayload(SECRET, "x", "sha384");
    expect(sig384).toMatch(/^sha384=[0-9a-f]{96}$/);
    const sig512 = signPayload(SECRET, "x", "sha512");
    expect(sig512).toMatch(/^sha512=[0-9a-f]{128}$/);
  });

  it("accepts a Buffer payload (binary-safe, no UTF-8 reinterpretation)", () => {
    const buf = Buffer.from([0x00, 0xff, 0xa5, 0x10]);
    const sigBuf = signPayload(SECRET, buf);
    const sigStr = signPayload(SECRET, buf.toString("binary"));
    // Buffer + utf8 reinterpretation differ for non-UTF-8 bytes — that's
    // the whole point of accepting Buffer in the API.
    expect(sigBuf).not.toBe(sigStr);
  });

  it("throws on an unknown algorithm", () => {
    expect(() =>
      // @ts-expect-error — this is exactly the runtime guard we are testing
      signPayload(SECRET, "x", "md5"),
    ).toThrow(/Unsupported HMAC algorithm/);
  });
});

describe("verifySignature — happy path", () => {
  it("round-trips sign + verify for sha256 (the default)", () => {
    const sig = signPayload(SECRET, "payload");
    expect(verifySignature(SECRET, "payload", sig)).toBe(true);
  });

  it("round-trips for every algorithm when the caller opts into it", () => {
    for (const algo of HMAC_ALGOS) {
      const sig = signPayload(SECRET, "payload", algo);
      expect(verifySignature(SECRET, "payload", sig, { allowedAlgos: [algo] })).toBe(true);
    }
  });

  it("treats the algo prefix case-insensitively", () => {
    const sig = signPayload(SECRET, "payload");
    const upper = sig.replace(/^sha256/, "SHA256");
    expect(verifySignature(SECRET, "payload", upper)).toBe(true);
  });
});

describe("verifySignature — rejection paths (returns false, never throws)", () => {
  it("rejects a flipped byte in the signature", () => {
    const sig = signPayload(SECRET, "payload");
    const tampered = sig.slice(0, -1) + (sig.slice(-1) === "0" ? "1" : "0");
    expect(verifySignature(SECRET, "payload", tampered)).toBe(false);
  });

  it("rejects a flipped byte in the payload", () => {
    const sig = signPayload(SECRET, "payload");
    expect(verifySignature(SECRET, "payloaD", sig)).toBe(false);
  });

  it("rejects an empty header", () => {
    expect(verifySignature(SECRET, "payload", "")).toBe(false);
  });

  it("rejects an empty secret", () => {
    const sig = signPayload(SECRET, "payload");
    expect(verifySignature("", "payload", sig)).toBe(false);
  });

  it("rejects a header missing the algo prefix", () => {
    const expected = createHmac("sha256", SECRET).update("payload", "utf8").digest("hex");
    expect(verifySignature(SECRET, "payload", expected)).toBe(false);
  });

  it("rejects a header with an unknown algo prefix", () => {
    expect(verifySignature(SECRET, "payload", "md5=abcdef")).toBe(false);
  });

  it("rejects sha384 when allowedAlgos is the default sha256-only set", () => {
    const sig384 = signPayload(SECRET, "payload", "sha384");
    expect(verifySignature(SECRET, "payload", sig384)).toBe(false);
  });

  it("rejects an `=` in position zero (empty algo)", () => {
    expect(verifySignature(SECRET, "payload", "=abcdef")).toBe(false);
  });

  it("rejects non-hex characters in the digest", () => {
    expect(verifySignature(SECRET, "payload", "sha256=NOT-HEX")).toBe(false);
  });

  it("rejects a digest of the wrong length (hex truncated)", () => {
    const sig = signPayload(SECRET, "payload");
    expect(verifySignature(SECRET, "payload", sig.slice(0, -2))).toBe(false);
  });

  it("rejects when the caller forgets to opt into a stronger algo", () => {
    const sig = signPayload(SECRET, "payload", "sha512");
    expect(verifySignature(SECRET, "payload", sig)).toBe(false);
    expect(verifySignature(SECRET, "payload", sig, { allowedAlgos: ["sha512"] })).toBe(true);
  });
});

describe("verifySignature — UTF-8 + binary payloads", () => {
  it("handles UTF-8 multi-byte characters in the secret and the payload", () => {
    const utf8Secret = "🔐-très-secret-€";
    const utf8Payload = '{"emoji":"🚀","accent":"être"}';
    const sig = signPayload(utf8Secret, utf8Payload);
    expect(verifySignature(utf8Secret, utf8Payload, sig)).toBe(true);
  });

  it("verifies a Buffer payload signed as a Buffer", () => {
    const buf = Buffer.from([0x00, 0xff, 0xa5, 0x10, 0x7f, 0x80]);
    const sig = signPayload(SECRET, buf);
    expect(verifySignature(SECRET, buf, sig)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fuzz — 1000 iterations of random payloads + secrets, asserting that the
// verifier never throws on arbitrary input and only returns true on the
// payload it actually signed.
// ---------------------------------------------------------------------------

describe("verifySignature — fuzz", () => {
  it("never throws and stays correct over 1000 randomized inputs", () => {
    for (let i = 0; i < 1000; i++) {
      const secret = randomBytes(1 + Math.floor(Math.random() * 64)).toString("hex");
      const payload = randomBytes(Math.floor(Math.random() * 256)).toString("base64");

      const sig = signPayload(secret, payload);

      // 1. Honest sign+verify must succeed every time.
      expect(verifySignature(secret, payload, sig)).toBe(true);

      // 2. A different secret must never validate.
      const otherSecret = secret + "x";
      expect(verifySignature(otherSecret, payload, sig)).toBe(false);

      // 3. A flipped payload byte must never validate.
      if (payload.length > 0) {
        const flipped = payload.slice(0, -1) + (payload.slice(-1) === "A" ? "B" : "A");
        if (flipped !== payload) {
          expect(verifySignature(secret, flipped, sig)).toBe(false);
        }
      }

      // 4. A garbled header must return false (never throw).
      const garbage = randomBytes(20).toString("hex");
      expect(verifySignature(secret, payload, garbage)).toBe(false);

      // 5. A truncated header must return false.
      expect(verifySignature(secret, payload, sig.slice(0, sig.length - 1))).toBe(false);
    }
  });

  it("default algo constant matches sha256", () => {
    expect(DEFAULT_HMAC_ALGO).toBe("sha256");
  });
});
