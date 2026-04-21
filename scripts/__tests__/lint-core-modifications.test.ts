import { describe, it, expect } from "vitest";
import {
  FROZEN_PATH_PREFIXES,
  filesTouchFrozenPaths,
  commitsCarryExtensionPoint,
} from "../lint-core-modifications.js";

describe("FROZEN_PATH_PREFIXES", () => {
  it("covers the 5 enforced roots", () => {
    expect(FROZEN_PATH_PREFIXES).toEqual([
      "src/core/",
      "src/runtime/",
      "src/db/",
      "src/dashboard/routes/",
      "src/server/",
    ]);
  });
});

describe("filesTouchFrozenPaths", () => {
  it("returns only the files that match a frozen prefix", () => {
    const files = [
      "src/core/auth/index.ts",
      "src/lib/logger.ts",
      "docs/README.md",
      "src/runtime/plugin/types.ts",
      "src/dashboard/routes/login.ts",
      "src/dashboard/components/button.ts",
    ];
    expect(filesTouchFrozenPaths(files)).toEqual([
      "src/core/auth/index.ts",
      "src/runtime/plugin/types.ts",
      "src/dashboard/routes/login.ts",
    ]);
  });

  it("returns [] when nothing frozen is touched", () => {
    expect(
      filesTouchFrozenPaths(["docs/foo.md", "src/lib/util.ts"]),
    ).toEqual([]);
  });
});

describe("commitsCarryExtensionPoint", () => {
  it("accepts a trailer on its own line", () => {
    const bodies = [
      "feat(core): add MFA hook\n\nBody here\n\nExtension-Point: mfa-hook\n",
    ];
    expect(commitsCarryExtensionPoint(bodies)).toBe(true);
  });

  it("accepts when the trailer appears in one of many commits", () => {
    const bodies = [
      "chore: rename var",
      "feat(core): tweak\n\nExtension-Point: foo",
      "docs: update README",
    ];
    expect(commitsCarryExtensionPoint(bodies)).toBe(true);
  });

  it("rejects when no commit carries the trailer", () => {
    const bodies = [
      "feat(core): tweak auth flow\n\nNo trailer here",
      "chore: bump",
    ];
    expect(commitsCarryExtensionPoint(bodies)).toBe(false);
  });

  it("rejects a trailer-looking substring buried in prose", () => {
    const bodies = [
      "feat: mention Extension-Point: foo inside a sentence but not as a trailer line — indented\n   Extension-Point: foo",
    ];
    // Regex is `^Extension-Point:` on a line — leading whitespace disqualifies.
    expect(commitsCarryExtensionPoint(bodies)).toBe(false);
  });
});
