// src/lib/__tests__/dotenv.test.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { readEnvVar, writeEnvVar, removeEnvVar, maskSecret } from "../dotenv.js";

describe("dotenv helpers", () => {
  let testDir: string;
  let envPath: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "dotenv-test-"));
    envPath = path.join(testDir, ".env");
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("readEnvVar", () => {
    it("reads an existing variable", async () => {
      await fs.writeFile(envPath, "API_KEY=secret123\nOTHER=value\n");
      expect(readEnvVar(envPath, "API_KEY")).toBe("secret123");
    });

    it("returns null for missing variable", async () => {
      await fs.writeFile(envPath, "OTHER=value\n");
      expect(readEnvVar(envPath, "API_KEY")).toBeNull();
    });

    it("returns null for non-existent file", () => {
      expect(readEnvVar(path.join(testDir, "missing.env"), "API_KEY")).toBeNull();
    });

    it("ignores comments and empty lines", async () => {
      await fs.writeFile(envPath, "# comment\n\nAPI_KEY=secret123\n# another\nOTHER=value\n\n");
      expect(readEnvVar(envPath, "API_KEY")).toBe("secret123");
      expect(readEnvVar(envPath, "OTHER")).toBe("value");
    });

    it("trims values", async () => {
      await fs.writeFile(envPath, "API_KEY=  secret123  \n");
      expect(readEnvVar(envPath, "API_KEY")).toBe("secret123");
    });

    it("handles special regex characters in var names", async () => {
      await fs.writeFile(envPath, "MY.VAR=value\nMY_VAR=other\n");
      expect(readEnvVar(envPath, "MY.VAR")).toBe("value");
      expect(readEnvVar(envPath, "MY_VAR")).toBe("other");
    });
  });

  describe("writeEnvVar", () => {
    it("creates a new file with a variable", async () => {
      await writeEnvVar(envPath, "API_KEY", "secret123");
      expect(readEnvVar(envPath, "API_KEY")).toBe("secret123");
    });

    it("writes with mode 0o600", async () => {
      await writeEnvVar(envPath, "API_KEY", "secret123");
      const stat = await fs.stat(envPath);
      expect(stat.mode & 0o777).toBe(0o600);
    });

    it("overwrites existing variable", async () => {
      await fs.writeFile(envPath, "API_KEY=old\nOTHER=value\n");
      await writeEnvVar(envPath, "API_KEY", "new");
      expect(readEnvVar(envPath, "API_KEY")).toBe("new");
      expect(readEnvVar(envPath, "OTHER")).toBe("value");
    });

    it("preserves other variables when adding new", async () => {
      await fs.writeFile(envPath, "EXISTING=value1\n");
      await writeEnvVar(envPath, "NEW_VAR", "value2");
      expect(readEnvVar(envPath, "EXISTING")).toBe("value1");
      expect(readEnvVar(envPath, "NEW_VAR")).toBe("value2");
    });

    it("creates parent directories", async () => {
      const nestedPath = path.join(testDir, "nested", "deep", ".env");
      await writeEnvVar(nestedPath, "API_KEY", "secret");
      expect(readEnvVar(nestedPath, "API_KEY")).toBe("secret");
    });

    it("handles empty values", async () => {
      await writeEnvVar(envPath, "EMPTY", "");
      expect(readEnvVar(envPath, "EMPTY")).toBe("");
    });

    it("handles values with special characters", async () => {
      const special = "abc/def:123@host#comment";
      await writeEnvVar(envPath, "URL", special);
      expect(readEnvVar(envPath, "URL")).toBe(special);
    });
  });

  describe("removeEnvVar", () => {
    it("removes an existing variable", async () => {
      await fs.writeFile(envPath, "API_KEY=secret\nOTHER=value\n");
      await removeEnvVar(envPath, "API_KEY");
      expect(readEnvVar(envPath, "API_KEY")).toBeNull();
      expect(readEnvVar(envPath, "OTHER")).toBe("value");
    });

    it("is a no-op for missing variable", async () => {
      await fs.writeFile(envPath, "OTHER=value\n");
      await removeEnvVar(envPath, "MISSING");
      expect(readEnvVar(envPath, "OTHER")).toBe("value");
    });

    it("is a no-op for non-existent file", async () => {
      await removeEnvVar(path.join(testDir, "missing.env"), "API_KEY");
      // No error should be thrown
    });

    it("removes trailing newlines properly", async () => {
      await fs.writeFile(envPath, "ONLY_VAR=value\n");
      await removeEnvVar(envPath, "ONLY_VAR");
      const content = await fs.readFile(envPath, "utf-8");
      expect(content.length).toBe(0);
    });

    it("removes variable and consolidates whitespace", async () => {
      await fs.writeFile(envPath, "VAR1=val1\n\nVAR2=val2\n\nVAR3=val3\n");
      await removeEnvVar(envPath, "VAR2");
      expect(readEnvVar(envPath, "VAR1")).toBe("val1");
      expect(readEnvVar(envPath, "VAR2")).toBeNull();
      expect(readEnvVar(envPath, "VAR3")).toBe("val3");
    });
  });

  describe("maskSecret", () => {
    it("masks long secrets showing last 4 chars", () => {
      // "some-long-secret" = 16 chars, last 4 = "cret", so 12 bullets
      expect(maskSecret("some-long-secret")).toBe("••••••••••••cret");
    });

    it("shows last 4 characters by default", () => {
      // "secretkey" = 9 chars, last 4 = "tkey", so 5 bullets
      expect(maskSecret("secretkey")).toBe("•••••tkey");
    });

    it("uses custom visibleChars", () => {
      expect(maskSecret("secretkey", 3)).toBe("••••••key");
    });

    it("returns bullets only for short strings", () => {
      expect(maskSecret("abc")).toBe("••••");
      expect(maskSecret("")).toBe("••••");
      expect(maskSecret("1234")).toBe("••••");
    });

    it("caps bullet count at 20", () => {
      const long = "a".repeat(100);
      const result = maskSecret(long);
      const bulletCount = result.match(/•/g)?.length ?? 0;
      expect(bulletCount).toBeLessThanOrEqual(20);
      expect(result.endsWith("aaaa")).toBe(true);
    });

    it("handles single character", () => {
      expect(maskSecret("a")).toBe("••••");
    });
  });
});
