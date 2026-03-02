// src/core/__tests__/update-checker.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { UpdateChecker } from "../update-checker.js";
import { MockConnection } from "./mock-connection.js";

let conn: MockConnection;
let checker: UpdateChecker;

beforeEach(() => {
  conn = new MockConnection();
  checker = new UpdateChecker(conn);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// _isNewer() — pure function, no mocks needed
// ---------------------------------------------------------------------------

describe("UpdateChecker._isNewer()", () => {
  it("newer year → true", () => {
    expect(checker._isNewer("2027.1.1", "2026.1.1")).toBe(true);
  });

  it("older year → false", () => {
    expect(checker._isNewer("2025.1.1", "2026.1.1")).toBe(false);
  });

  it("same year, newer month → true", () => {
    expect(checker._isNewer("2026.3.1", "2026.2.1")).toBe(true);
  });

  it("same year, older month → false", () => {
    expect(checker._isNewer("2026.1.1", "2026.2.1")).toBe(false);
  });

  it("same year+month, newer day → true", () => {
    expect(checker._isNewer("2026.2.28", "2026.2.26")).toBe(true);
  });

  it("same year+month, older day → false", () => {
    expect(checker._isNewer("2026.2.24", "2026.2.26")).toBe(false);
  });

  it("identical versions → false", () => {
    expect(checker._isNewer("2026.2.26", "2026.2.26")).toBe(false);
  });

  it("pre-release suffix stripped — candidate with suffix same as current → false", () => {
    // 2026.3.1-beta.1 normalizes to 2026.3.1, same as current 2026.3.1 → false
    expect(checker._isNewer("2026.3.1-beta.1", "2026.3.1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// check() — mock fetch globally
// ---------------------------------------------------------------------------

describe("UpdateChecker.check()", () => {
  it("both succeed → returns correct versions, updateAvailable: true when newer", async () => {
    conn.mockExec("openclaw --version", { stdout: "2026.2.26", stderr: "", exitCode: 0 });
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ version: "2026.3.1" }),
    }));

    const result = await checker.check();

    expect(result.currentVersion).toBe("2026.2.26");
    expect(result.latestVersion).toBe("2026.3.1");
    expect(result.updateAvailable).toBe(true);
  });

  it("both succeed → updateAvailable: false when same version", async () => {
    conn.mockExec("openclaw --version", { stdout: "2026.3.1", stderr: "", exitCode: 0 });
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ version: "2026.3.1" }),
    }));

    const result = await checker.check();

    expect(result.currentVersion).toBe("2026.3.1");
    expect(result.latestVersion).toBe("2026.3.1");
    expect(result.updateAvailable).toBe(false);
  });

  it("openclaw --version fails (exitCode 1) → currentVersion: null, updateAvailable: false", async () => {
    conn.mockExec("openclaw --version", { stdout: "error", stderr: "", exitCode: 1 });
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ version: "2026.3.1" }),
    }));

    const result = await checker.check();

    expect(result.currentVersion).toBeNull();
    expect(result.latestVersion).toBe("2026.3.1");
    expect(result.updateAvailable).toBe(false);
  });

  it("openclaw --version returns empty string → currentVersion: null", async () => {
    conn.mockExec("openclaw --version", { stdout: "", stderr: "", exitCode: 0 });
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ version: "2026.3.1" }),
    }));

    const result = await checker.check();

    expect(result.currentVersion).toBeNull();
    expect(result.updateAvailable).toBe(false);
  });

  it("fetch throws → latestVersion: null, updateAvailable: false", async () => {
    conn.mockExec("openclaw --version", { stdout: "2026.2.26", stderr: "", exitCode: 0 });
    vi.stubGlobal("fetch", async () => {
      throw new Error("Network error");
    });

    const result = await checker.check();

    expect(result.currentVersion).toBe("2026.2.26");
    expect(result.latestVersion).toBeNull();
    expect(result.updateAvailable).toBe(false);
  });

  it("fetch returns non-ok status → latestVersion: null", async () => {
    conn.mockExec("openclaw --version", { stdout: "2026.2.26", stderr: "", exitCode: 0 });
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }));

    const result = await checker.check();

    expect(result.latestVersion).toBeNull();
    expect(result.updateAvailable).toBe(false);
  });

  it("fetch returns JSON without version field → latestVersion: null", async () => {
    conn.mockExec("openclaw --version", { stdout: "2026.2.26", stderr: "", exitCode: 0 });
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ name: "openclaw" }), // no version field
    }));

    const result = await checker.check();

    expect(result.latestVersion).toBeNull();
    expect(result.updateAvailable).toBe(false);
  });
});
