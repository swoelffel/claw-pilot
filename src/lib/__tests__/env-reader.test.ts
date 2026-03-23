// src/lib/__tests__/env-reader.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("buildResolvedEnv", () => {
  let tmpDir: string;
  let globalDir: string;
  let instanceDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "env-reader-test-"));
    globalDir = path.join(tmpDir, "global");
    instanceDir = path.join(tmpDir, "instance");
    fs.mkdirSync(globalDir, { recursive: true });
    fs.mkdirSync(instanceDir, { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("merges global and instance .env — instance wins", async () => {
    // Mock getDataDir to return our temp global dir
    vi.doMock("../platform.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../platform.js")>();
      return { ...actual, getDataDir: () => globalDir };
    });

    fs.writeFileSync(path.join(globalDir, ".env"), "SHARED_KEY=global\nGLOBAL_ONLY=yes\n");
    fs.writeFileSync(path.join(instanceDir, ".env"), "SHARED_KEY=instance\nINSTANCE_ONLY=yes\n");

    const { buildResolvedEnv } = await import("../env-reader.js");
    const result = buildResolvedEnv(instanceDir);

    expect(result).toEqual({
      SHARED_KEY: "instance",
      GLOBAL_ONLY: "yes",
      INSTANCE_ONLY: "yes",
    });
  });

  it("returns global only when instance .env missing", async () => {
    vi.doMock("../platform.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../platform.js")>();
      return { ...actual, getDataDir: () => globalDir };
    });

    fs.writeFileSync(path.join(globalDir, ".env"), "API_KEY=from-global\n");
    // No instance .env

    const { buildResolvedEnv } = await import("../env-reader.js");
    const result = buildResolvedEnv(instanceDir);

    expect(result).toEqual({ API_KEY: "from-global" });
  });

  it("returns instance only when global .env missing", async () => {
    vi.doMock("../platform.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../platform.js")>();
      return { ...actual, getDataDir: () => path.join(tmpDir, "nonexistent") };
    });

    fs.writeFileSync(path.join(instanceDir, ".env"), "API_KEY=from-instance\n");

    const { buildResolvedEnv } = await import("../env-reader.js");
    const result = buildResolvedEnv(instanceDir);

    expect(result).toEqual({ API_KEY: "from-instance" });
  });

  it("returns empty when both .env files missing", async () => {
    vi.doMock("../platform.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../platform.js")>();
      return { ...actual, getDataDir: () => path.join(tmpDir, "nonexistent") };
    });

    const { buildResolvedEnv } = await import("../env-reader.js");
    const result = buildResolvedEnv(path.join(tmpDir, "also-nonexistent"));

    expect(result).toEqual({});
  });
});
