// src/lib/__tests__/constants.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("constants.GITHUB_REPO", () => {
  const originalEnv = process.env.CLAWPILOT_GITHUB_REPO;

  beforeEach(() => {
    delete process.env.CLAWPILOT_GITHUB_REPO;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.CLAWPILOT_GITHUB_REPO;
    else process.env.CLAWPILOT_GITHUB_REPO = originalEnv;
  });

  it("defaults to swoelffel/claw-pilot when no env override is set", async () => {
    const { constants } = await import("../constants.js");
    expect(constants.GITHUB_REPO).toBe("swoelffel/claw-pilot");
  });

  it("honors CLAWPILOT_GITHUB_REPO override", async () => {
    process.env.CLAWPILOT_GITHUB_REPO = "acme/claw-pilot-fork";
    const { constants } = await import("../constants.js");
    expect(constants.GITHUB_REPO).toBe("acme/claw-pilot-fork");
  });
});
