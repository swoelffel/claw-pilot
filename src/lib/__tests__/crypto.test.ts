import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encrypt, decrypt, isCryptoAvailable } from "../crypto.js";

describe("crypto", () => {
  const MASTER_KEY = "a".repeat(64); // 32 bytes hex

  beforeEach(() => {
    process.env.MASTER_ENCRYPTION_KEY = MASTER_KEY;
  });

  afterEach(() => {
    delete process.env.MASTER_ENCRYPTION_KEY;
  });

  describe("isCryptoAvailable", () => {
    it("returns true when MASTER_ENCRYPTION_KEY is set", () => {
      expect(isCryptoAvailable()).toBe(true);
    });

    it("returns false when MASTER_ENCRYPTION_KEY is not set", () => {
      delete process.env.MASTER_ENCRYPTION_KEY;
      expect(isCryptoAvailable()).toBe(false);
    });
  });

  describe("encrypt / decrypt", () => {
    it("round-trips a plaintext string", () => {
      const plaintext = "sk-ant-api03-secret-key-value";
      const ciphertext = encrypt(plaintext);
      expect(ciphertext).not.toBe(plaintext);
      expect(ciphertext).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
      expect(decrypt(ciphertext)).toBe(plaintext);
    });

    it("produces different ciphertexts for same plaintext (random IV)", () => {
      const plaintext = "sk-ant-api03-secret-key-value";
      const c1 = encrypt(plaintext);
      const c2 = encrypt(plaintext);
      expect(c1).not.toBe(c2);
    });

    it("throws when MASTER_ENCRYPTION_KEY is missing", () => {
      delete process.env.MASTER_ENCRYPTION_KEY;
      expect(() => encrypt("test")).toThrow("MASTER_ENCRYPTION_KEY");
    });

    it("throws on tampered ciphertext", () => {
      const ciphertext = encrypt("test");
      const parts = ciphertext.split(":");
      parts[2] = "00" + parts[2]!.slice(2); // tamper — parts[2] always exists (iv:auth:ciphertext format)
      expect(() => decrypt(parts.join(":"))).toThrow();
    });
  });
});
