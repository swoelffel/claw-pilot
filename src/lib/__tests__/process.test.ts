/**
 * lib/__tests__/process.test.ts
 *
 * Unit tests for cross-platform process tree utilities.
 * Mocks os.platform(), execSync, and fs helpers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { getDescendants } from "../process.js";

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, platform: vi.fn() };
});

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return { ...actual, execSync: vi.fn() };
});

const mockPlatform = vi.mocked(os.platform);
const mockExecSync = vi.mocked(execSync);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// macOS (Darwin)
// ---------------------------------------------------------------------------

describe("getDescendants — darwin", () => {
  beforeEach(() => {
    mockPlatform.mockReturnValue("darwin");
  });

  it("returns child PIDs from pgrep", async () => {
    mockExecSync.mockReturnValueOnce("100\n101\n");
    // pgrep for children of 100 and 101 returns nothing
    mockExecSync.mockImplementation(() => {
      throw new Error("exit code 1");
    });

    const result = await getDescendants(42);
    expect(result).toEqual([100, 101]);
    expect(mockExecSync).toHaveBeenCalledWith("pgrep -P 42", expect.any(Object));
  });

  it("returns empty array when pgrep finds no children", async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("exit code 1");
    });

    const result = await getDescendants(42);
    expect(result).toEqual([]);
  });

  it("recurses into children", async () => {
    // First call: children of 42 → [100]
    mockExecSync.mockReturnValueOnce("100\n");
    // Second call: children of 100 → [200]
    mockExecSync.mockReturnValueOnce("200\n");
    // Third call: children of 200 → none
    mockExecSync.mockImplementation(() => {
      throw new Error("exit code 1");
    });

    const result = await getDescendants(42);
    expect(result).toEqual([100, 200]);
  });
});

// ---------------------------------------------------------------------------
// Unsupported platform
// ---------------------------------------------------------------------------

describe("getDescendants — unsupported platform", () => {
  it("returns empty array on Windows", async () => {
    mockPlatform.mockReturnValue("win32");
    const result = await getDescendants(42);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("getDescendants — error handling", () => {
  it("darwin: returns empty array when execSync throws for the root PID", async () => {
    mockPlatform.mockReturnValue("darwin");
    // pgrep throws for every PID
    mockExecSync.mockImplementation(() => {
      throw new Error("exit code 1");
    });
    const result = await getDescendants(99999);
    expect(result).toEqual([]);
  });
});
