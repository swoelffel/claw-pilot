// src/core/__tests__/self-update-checker.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SelfUpdateChecker } from "../self-update-checker.js";

let checker: SelfUpdateChecker;

beforeEach(() => {
  checker = new SelfUpdateChecker();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// _isNewer() — pure function, no mocks needed
// ---------------------------------------------------------------------------

describe("SelfUpdateChecker._isNewer()", () => {
  it("newer major → true", () => {
    expect(checker._isNewer("1.0.0", "0.10.2")).toBe(true);
  });

  it("older major → false", () => {
    expect(checker._isNewer("0.9.0", "1.0.0")).toBe(false);
  });

  it("same major, newer minor → true", () => {
    expect(checker._isNewer("0.11.0", "0.10.2")).toBe(true);
  });

  it("same major, older minor → false", () => {
    expect(checker._isNewer("0.9.0", "0.10.2")).toBe(false);
  });

  it("same major+minor, newer patch → true", () => {
    expect(checker._isNewer("0.10.3", "0.10.2")).toBe(true);
  });

  it("same major+minor, older patch → false", () => {
    expect(checker._isNewer("0.10.1", "0.10.2")).toBe(false);
  });

  it("identical versions → false", () => {
    expect(checker._isNewer("0.10.2", "0.10.2")).toBe(false);
  });

  it("candidate with v prefix → stripped correctly", () => {
    expect(checker._isNewer("v0.11.0", "0.10.2")).toBe(true);
  });

  it("current with v prefix → stripped correctly", () => {
    expect(checker._isNewer("0.11.0", "v0.10.2")).toBe(true);
  });

  it("pre-release suffix stripped — same base version → false", () => {
    // 0.11.0-beta.1 normalizes to 0.11.0, same as current 0.11.0 → false
    expect(checker._isNewer("0.11.0-beta.1", "0.11.0")).toBe(false);
  });

  it("pre-release suffix stripped — newer base version → true", () => {
    expect(checker._isNewer("0.12.0-beta.1", "0.11.0")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// check() — mock fetch globally
// ---------------------------------------------------------------------------

describe("SelfUpdateChecker.check()", () => {
  it("newer release available → updateAvailable: true, latestTag returned", async () => {
    // On utilise une version majeure tres superieure pour etre independant de la version courante
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ tag_name: "v99.0.0" }),
    }));

    const result = await checker.check();

    expect(result.latestVersion).toBe("99.0.0");
    expect(result.latestTag).toBe("v99.0.0");
    expect(result.updateAvailable).toBe(true);
  });

  it("same version as current → updateAvailable: false", async () => {
    // On mock _getCurrentVersion en injectant la meme version que le tag
    const currentVersion = checker["_getCurrentVersion"]();
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ tag_name: `v${currentVersion}` }),
    }));

    const result = await checker.check();

    expect(result.updateAvailable).toBe(false);
  });

  it("fetch throws → latestVersion: null, updateAvailable: false", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("Network error");
    });

    const result = await checker.check();

    expect(result.latestVersion).toBeNull();
    expect(result.latestTag).toBeNull();
    expect(result.updateAvailable).toBe(false);
  });

  it("fetch returns non-ok status → latestVersion: null", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 403,
      json: async () => ({}),
    }));

    const result = await checker.check();

    expect(result.latestVersion).toBeNull();
    expect(result.updateAvailable).toBe(false);
  });

  it("fetch returns JSON without tag_name → latestVersion: null", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ name: "claw-pilot" }), // no tag_name
    }));

    const result = await checker.check();

    expect(result.latestVersion).toBeNull();
    expect(result.updateAvailable).toBe(false);
  });

  it("tag without v prefix → version parsed correctly", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ tag_name: "0.11.0" }), // sans prefixe v
    }));

    const result = await checker.check();

    expect(result.latestVersion).toBe("0.11.0");
    expect(result.latestTag).toBe("0.11.0");
  });

  it("currentVersion is always a non-null string", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("Network error");
    });

    const result = await checker.check();

    expect(result.currentVersion).toBeTruthy();
    expect(typeof result.currentVersion).toBe("string");
  });

  it("result is cached: second call does not call fetch again", async () => {
    let fetchCount = 0;
    vi.stubGlobal("fetch", async () => {
      fetchCount++;
      return { ok: true, json: async () => ({ tag_name: "v99.0.0" }) };
    });

    await checker.check();
    await checker.check();

    expect(fetchCount).toBe(1); // fetch called only once
  });

  it("invalidateCache() forces a fresh fetch on next check", async () => {
    let fetchCount = 0;
    vi.stubGlobal("fetch", async () => {
      fetchCount++;
      return { ok: true, json: async () => ({ tag_name: "v99.0.0" }) };
    });

    await checker.check();
    checker.invalidateCache();
    await checker.check();

    expect(fetchCount).toBe(2); // fetch called twice after cache invalidation
  });
});
