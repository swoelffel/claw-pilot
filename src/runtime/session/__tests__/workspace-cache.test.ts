/**
 * runtime/session/__tests__/workspace-cache.test.ts
 *
 * Unit tests for the workspace file cache.
 * Uses vi.mock("node:fs") to control filesystem behavior.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const mod = await importOriginal<typeof import("node:fs")>();
  return {
    ...mod,
    readFileSync: vi.fn(),
    statSync: vi.fn(),
  };
});

import { readFileSync, statSync } from "node:fs";
import {
  readWorkspaceFileCached,
  invalidateWorkspaceCache,
  clearWorkspaceCache,
} from "../workspace-cache.js";

const mockReadFileSync = vi.mocked(readFileSync);
const mockStatSync = vi.mocked(statSync);

function mockFile(content: string, mtimeMs = 1000): void {
  mockStatSync.mockReturnValue({ mtimeMs } as any);
  mockReadFileSync.mockReturnValue(content);
}

beforeEach(() => {
  clearWorkspaceCache();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readWorkspaceFileCached", () => {
  it("reads from disk on first call (cache miss)", () => {
    mockFile("hello world", 1000);
    const result = readWorkspaceFileCached("/tmp/SOUL.md");
    expect(result).toBe("hello world");
    expect(mockReadFileSync).toHaveBeenCalledOnce();
  });

  it("returns cached content on second call with same mtime", () => {
    mockFile("cached content", 1000);
    readWorkspaceFileCached("/tmp/SOUL.md");

    // Second call — statSync returns same mtime, readFileSync should NOT be called again
    mockReadFileSync.mockClear();
    const result = readWorkspaceFileCached("/tmp/SOUL.md");
    expect(result).toBe("cached content");
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it("re-reads when file mtime changes", () => {
    mockFile("v1", 1000);
    readWorkspaceFileCached("/tmp/SOUL.md");

    // File changed — new mtime
    mockFile("v2", 2000);
    const result = readWorkspaceFileCached("/tmp/SOUL.md");
    expect(result).toBe("v2");
  });

  it("returns undefined when file does not exist", () => {
    mockStatSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const result = readWorkspaceFileCached("/tmp/nonexistent.md");
    expect(result).toBeUndefined();
  });

  it("removes cache entry when file disappears after caching", () => {
    mockFile("data", 1000);
    readWorkspaceFileCached("/tmp/SOUL.md");

    // File is now gone
    mockStatSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const result = readWorkspaceFileCached("/tmp/SOUL.md");
    expect(result).toBeUndefined();
  });

  it("invalidates cache entry after TTL expires", () => {
    mockFile("old", 1000);
    readWorkspaceFileCached("/tmp/SOUL.md");

    // Advance time beyond 30s TTL
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31_000);
    mockFile("new", 1000);
    const result = readWorkspaceFileCached("/tmp/SOUL.md");
    expect(result).toBe("new");
    expect(mockReadFileSync).toHaveBeenCalledTimes(2); // original + re-read
  });

  it("evicts oldest entry when cache is at MAX_ENTRIES (200)", () => {
    // Fill cache with 200 entries
    for (let i = 0; i < 200; i++) {
      mockFile(`content-${i}`, 1000 + i);
      readWorkspaceFileCached(`/tmp/file-${i}.md`);
    }

    // Adding one more should evict the oldest (file-0)
    mockFile("new-content", 2000);
    readWorkspaceFileCached("/tmp/file-new.md");

    // file-0 was evicted, so reading it causes a fresh disk read
    mockReadFileSync.mockClear();
    mockFile("re-read", 1000);
    readWorkspaceFileCached("/tmp/file-0.md");
    expect(mockReadFileSync).toHaveBeenCalledOnce();
  });
});

describe("invalidateWorkspaceCache", () => {
  it("forces next read to hit disk", () => {
    mockFile("cached", 1000);
    readWorkspaceFileCached("/tmp/X.md");

    invalidateWorkspaceCache("/tmp/X.md");

    mockReadFileSync.mockClear();
    mockFile("fresh", 1000);
    const result = readWorkspaceFileCached("/tmp/X.md");
    expect(result).toBe("fresh");
    expect(mockReadFileSync).toHaveBeenCalledOnce();
  });
});

describe("clearWorkspaceCache", () => {
  it("empties the entire cache", () => {
    mockFile("a", 1000);
    readWorkspaceFileCached("/tmp/A.md");
    mockFile("b", 1000);
    readWorkspaceFileCached("/tmp/B.md");

    clearWorkspaceCache();

    mockReadFileSync.mockClear();
    mockFile("a-new", 1000);
    readWorkspaceFileCached("/tmp/A.md");
    expect(mockReadFileSync).toHaveBeenCalledOnce();
  });
});
