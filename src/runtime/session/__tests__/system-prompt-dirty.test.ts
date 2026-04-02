import { describe, it, expect, beforeEach } from "vitest";
import {
  markDirty,
  markAllDirty,
  isDirty,
  clearDirty,
  getCachedBasePrompt,
  cacheBasePrompt,
  clearSessionDirtyState,
  _resetForTests,
} from "../system-prompt-dirty.js";

describe("system-prompt-dirty", () => {
  beforeEach(() => {
    _resetForTests();
  });

  // -------------------------------------------------------------------------
  // markDirty / isDirty / clearDirty
  // -------------------------------------------------------------------------

  it("isDirty returns false for unknown session", () => {
    expect(isDirty("session-1")).toBe(false);
  });

  it("markDirty makes session dirty", () => {
    markDirty("session-1", "compaction");
    expect(isDirty("session-1")).toBe(true);
  });

  it("markDirty with multiple reasons stays dirty", () => {
    markDirty("session-1", "compaction");
    markDirty("session-1", "workspace");
    expect(isDirty("session-1")).toBe(true);
  });

  it("clearDirty makes session clean", () => {
    markDirty("session-1", "compaction");
    clearDirty("session-1");
    expect(isDirty("session-1")).toBe(false);
  });

  it("markDirty on one session does not affect another", () => {
    markDirty("session-1", "workspace");
    expect(isDirty("session-2")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // markAllDirty
  // -------------------------------------------------------------------------

  it("markAllDirty makes previously tracked sessions dirty", () => {
    // session-1 was previously tracked and cleared (has a generation stamp)
    markDirty("session-1", "compaction");
    clearDirty("session-1");
    expect(isDirty("session-1")).toBe(false);

    // Global change
    markAllDirty("profile");

    // Tracked session-1 is dirty (its generation < global generation)
    expect(isDirty("session-1")).toBe(true);
    // Untracked session-2 is NOT dirty — but it has no cache either,
    // so the prompt-loop will do a full build regardless
    expect(isDirty("session-2")).toBe(false);
  });

  it("clearDirty after markAllDirty cleans that session", () => {
    // Track session-1 first so markAllDirty affects it
    markDirty("session-1", "compaction");
    clearDirty("session-1");

    markAllDirty("profile");
    expect(isDirty("session-1")).toBe(true);

    clearDirty("session-1");
    expect(isDirty("session-1")).toBe(false);
  });

  it("markAllDirty after clearDirty makes session dirty again", () => {
    markAllDirty("profile");
    clearDirty("session-1");
    expect(isDirty("session-1")).toBe(false);

    markAllDirty("profile");
    expect(isDirty("session-1")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Base prompt cache
  // -------------------------------------------------------------------------

  it("getCachedBasePrompt returns undefined for unknown session", () => {
    expect(getCachedBasePrompt("session-1")).toBeUndefined();
  });

  it("cacheBasePrompt + getCachedBasePrompt round-trip", () => {
    cacheBasePrompt("session-1", "You are a helpful agent.");
    expect(getCachedBasePrompt("session-1")).toBe("You are a helpful agent.");
  });

  it("cacheBasePrompt overwrites previous value", () => {
    cacheBasePrompt("session-1", "v1");
    cacheBasePrompt("session-1", "v2");
    expect(getCachedBasePrompt("session-1")).toBe("v2");
  });

  // -------------------------------------------------------------------------
  // clearSessionDirtyState
  // -------------------------------------------------------------------------

  it("clearSessionDirtyState removes both dirty flags and cache", () => {
    markDirty("session-1", "compaction");
    cacheBasePrompt("session-1", "cached prompt");

    clearSessionDirtyState("session-1");

    expect(isDirty("session-1")).toBe(false);
    expect(getCachedBasePrompt("session-1")).toBeUndefined();
  });

  it("clearSessionDirtyState after markAllDirty resets to clean", () => {
    markAllDirty("profile");
    clearSessionDirtyState("session-1");
    // After clearSessionDirtyState, session generation is removed.
    // isDirty defaults to current globalGeneration → not dirty.
    expect(isDirty("session-1")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Integration scenarios
  // -------------------------------------------------------------------------

  it("cache hit scenario: cache exists + not dirty", () => {
    cacheBasePrompt("session-1", "base prompt");
    // Not dirty → cache should be usable
    expect(getCachedBasePrompt("session-1")).toBe("base prompt");
    expect(isDirty("session-1")).toBe(false);
  });

  it("cache miss scenario: dirty after markDirty", () => {
    cacheBasePrompt("session-1", "base prompt");
    clearDirty("session-1"); // ensure clean first
    markDirty("session-1", "workspace");
    // Cache exists but dirty → should rebuild
    expect(getCachedBasePrompt("session-1")).toBe("base prompt");
    expect(isDirty("session-1")).toBe(true);
  });

  it("cache miss scenario: no cache at all", () => {
    // No cache, not dirty → still a miss (no cached prompt to use)
    expect(getCachedBasePrompt("session-1")).toBeUndefined();
    expect(isDirty("session-1")).toBe(false);
  });

  it("full lifecycle: build → cache → use → dirty → rebuild → cache", () => {
    // 1. First build (no cache)
    expect(getCachedBasePrompt("s1")).toBeUndefined();

    // 2. Cache after build
    cacheBasePrompt("s1", "prompt-v1");
    clearDirty("s1");

    // 3. Second turn — cache hit
    expect(getCachedBasePrompt("s1")).toBe("prompt-v1");
    expect(isDirty("s1")).toBe(false);

    // 4. File edit marks dirty
    markDirty("s1", "workspace");
    expect(isDirty("s1")).toBe(true);

    // 5. Rebuild and re-cache
    cacheBasePrompt("s1", "prompt-v2");
    clearDirty("s1");

    // 6. Third turn — cache hit with new prompt
    expect(getCachedBasePrompt("s1")).toBe("prompt-v2");
    expect(isDirty("s1")).toBe(false);
  });
});
