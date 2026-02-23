// src/core/__tests__/provisioner-providers.test.ts
import { describe, it, expect } from "vitest";
import { resolveApiKey } from "../provisioner.js";

// Minimal mock connection
const makeConn = (files: Record<string, string>) => ({
  readFile: async (p: string) => {
    if (p in files) return files[p]!;
    throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
  },
  writeFile: async () => {},
  mkdir: async () => {},
  exec: async () => ({ stdout: "", stderr: "", code: 0 }),
});

// Minimal mock registry
const makeRegistry = (instances: Array<{ slug: string; state_dir: string }>) => ({
  listInstances: () => instances,
});

describe("resolveApiKey", () => {
  describe("anthropic provider", () => {
    it("returns apiKey directly when not 'reuse'", async () => {
      const conn = makeConn({});
      const registry = makeRegistry([]);
      const result = await resolveApiKey(
        { provider: "anthropic", apiKey: "sk-ant-direct" },
        registry as any,
        conn as any,
      );
      expect(result).toBe("sk-ant-direct");
    });

    it("reads ANTHROPIC_API_KEY from source .env when apiKey === 'reuse'", async () => {
      const conn = makeConn({ "/state/source/.env": "ANTHROPIC_API_KEY=sk-ant-real\nOPENCLAW_GW_AUTH_TOKEN=tok\n" });
      const registry = makeRegistry([{ slug: "source", state_dir: "/state/source" }]);
      const result = await resolveApiKey(
        { provider: "anthropic", apiKey: "reuse" },
        registry as any,
        conn as any,
      );
      expect(result).toBe("sk-ant-real");
    });

    it("throws ENV_READ_FAILED when .env is unreadable", async () => {
      const conn = makeConn({});
      const registry = makeRegistry([{ slug: "source", state_dir: "/state/source" }]);
      await expect(
        resolveApiKey({ provider: "anthropic", apiKey: "reuse" }, registry as any, conn as any)
      ).rejects.toMatchObject({ code: "ENV_READ_FAILED" });
    });

    it("throws API_KEY_READ_FAILED when ANTHROPIC_API_KEY missing from .env", async () => {
      const conn = makeConn({ "/state/source/.env": "OPENCLAW_GW_AUTH_TOKEN=tok\n" });
      const registry = makeRegistry([{ slug: "source", state_dir: "/state/source" }]);
      await expect(
        resolveApiKey({ provider: "anthropic", apiKey: "reuse" }, registry as any, conn as any)
      ).rejects.toMatchObject({ code: "API_KEY_READ_FAILED" });
    });

    it("throws NO_EXISTING_INSTANCE when registry is empty", async () => {
      const conn = makeConn({});
      const registry = makeRegistry([]);
      await expect(
        resolveApiKey({ provider: "anthropic", apiKey: "reuse" }, registry as any, conn as any)
      ).rejects.toMatchObject({ code: "NO_EXISTING_INSTANCE" });
    });
  });

  describe("opencode provider", () => {
    it("returns '' when apiKey === 'reuse' (no env var needed)", async () => {
      const conn = makeConn({});
      const registry = makeRegistry([{ slug: "source", state_dir: "/state/source" }]);
      const result = await resolveApiKey(
        { provider: "opencode", apiKey: "reuse" },
        registry as any,
        conn as any,
      );
      expect(result).toBe("");
    });

    it("returns '' when apiKey is empty string", async () => {
      const conn = makeConn({});
      const registry = makeRegistry([]);
      const result = await resolveApiKey(
        { provider: "opencode", apiKey: "" },
        registry as any,
        conn as any,
      );
      expect(result).toBe("");
    });
  });

  describe("openai provider", () => {
    it("reads OPENAI_API_KEY from source .env when apiKey === 'reuse'", async () => {
      const conn = makeConn({ "/state/source/.env": "OPENAI_API_KEY=sk-openai-real\nOPENCLAW_GW_AUTH_TOKEN=tok\n" });
      const registry = makeRegistry([{ slug: "source", state_dir: "/state/source" }]);
      const result = await resolveApiKey(
        { provider: "openai", apiKey: "reuse" },
        registry as any,
        conn as any,
      );
      expect(result).toBe("sk-openai-real");
    });
  });
});
