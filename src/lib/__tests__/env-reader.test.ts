// src/lib/__tests__/env-reader.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// Mutable value changed per test — vi.mock factory captures the reference.
let mockedDataDir = "";

vi.mock("../platform.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../platform.js")>();
  return { ...actual, getDataDir: () => mockedDataDir };
});

// Import AFTER vi.mock so the mock is in place.
const { buildResolvedEnv } = await import("../env-reader.js");

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
    mockedDataDir = globalDir;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("merges global and instance .env — instance wins", () => {
    fs.writeFileSync(path.join(globalDir, ".env"), "SHARED_KEY=global\nGLOBAL_ONLY=yes\n");
    fs.writeFileSync(path.join(instanceDir, ".env"), "SHARED_KEY=instance\nINSTANCE_ONLY=yes\n");

    const result = buildResolvedEnv(instanceDir);
    expect(result).toEqual({
      SHARED_KEY: "instance",
      GLOBAL_ONLY: "yes",
      INSTANCE_ONLY: "yes",
    });
  });

  it("returns global only when instance .env missing", () => {
    fs.writeFileSync(path.join(globalDir, ".env"), "API_KEY=from-global\n");

    const result = buildResolvedEnv(instanceDir);
    expect(result).toEqual({ API_KEY: "from-global" });
  });

  it("returns instance only when global .env missing", () => {
    mockedDataDir = path.join(tmpDir, "nonexistent");
    fs.writeFileSync(path.join(instanceDir, ".env"), "API_KEY=from-instance\n");

    const result = buildResolvedEnv(instanceDir);
    expect(result).toEqual({ API_KEY: "from-instance" });
  });

  it("returns empty when both .env files missing", () => {
    mockedDataDir = path.join(tmpDir, "nonexistent");

    const result = buildResolvedEnv(path.join(tmpDir, "also-nonexistent"));
    expect(result).toEqual({});
  });
});
