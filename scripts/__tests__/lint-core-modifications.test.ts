import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it, expect } from "vitest";
import {
  FROZEN_PATH_PREFIXES,
  filesTouchFrozenPaths,
  commitsCarryExtensionPoint,
} from "../lint-core-modifications.js";

const gateScript = fileURLToPath(new URL("../lint-core-modifications.ts", import.meta.url));
const tempRepos: string[] = [];

afterEach(() => {
  for (const repo of tempRepos.splice(0)) rmSync(repo, { recursive: true, force: true });
});

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

function createRepo(): { path: string; base: string } {
  const path = mkdtempSync(join(tmpdir(), "claw-pilot-r3-"));
  tempRepos.push(path);
  git(path, "init", "-q", "-b", "main");
  git(path, "config", "user.name", "Test User");
  git(path, "config", "user.email", "test@example.invalid");
  commitFile(path, "README.md", "initial\n", "chore: initial");
  return { path, base: git(path, "rev-parse", "HEAD") };
}

function commitFile(repo: string, file: string, content: string, message: string): string {
  const path = join(repo, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  git(repo, "add", file);
  git(repo, "commit", "-q", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

function runGate(repo: string, env: Record<string, string>) {
  return spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", gateScript], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_TOKEN: "",
      GITHUB_BASE_REF: "",
      GITHUB_EVENT_NAME: "",
      GITHUB_EVENT_BEFORE: "",
      LINT_BASE_REF: "",
      ...env,
    },
  });
}

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
    expect(filesTouchFrozenPaths(["docs/foo.md", "src/lib/util.ts"])).toEqual([]);
  });
});

describe("commitsCarryExtensionPoint", () => {
  it("accepts a trailer on its own line", () => {
    const bodies = ["feat(core): add MFA hook\n\nBody here\n\nExtension-Point: mfa-hook\n"];
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
    const bodies = ["feat(core): tweak auth flow\n\nNo trailer here", "chore: bump"];
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

describe("R3 gate against Git history", () => {
  it("ignores develop-only frozen changes on a main push", () => {
    const repo = createRepo();
    git(repo.path, "checkout", "-q", "-b", "develop");
    const develop = commitFile(
      repo.path,
      "src/runtime/provider.ts",
      "export const provider = true;\n",
      "feat(runtime): add provider\n\nExtension-Point: provider-hook",
    );
    git(repo.path, "update-ref", "refs/remotes/origin/develop", develop);
    git(repo.path, "checkout", "-q", "main");
    commitFile(repo.path, "package.json", '{"version":"1.0.1"}\n', "chore: release");

    const result = runGate(repo.path, {
      GITHUB_EVENT_NAME: "push",
      GITHUB_EVENT_BEFORE: repo.base,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("no frozen path touched");
  });

  it("still rejects a push that changes a frozen file without a trailer", () => {
    const repo = createRepo();
    git(repo.path, "update-ref", "refs/remotes/origin/develop", repo.base);
    commitFile(
      repo.path,
      "src/runtime/provider.ts",
      "export const provider = true;\n",
      "fix: change provider",
    );

    const result = runGate(repo.path, {
      GITHUB_EVENT_NAME: "push",
      GITHUB_EVENT_BEFORE: repo.base,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("R3 violation");
  });

  it("accepts a push that changes a frozen file with a trailer", () => {
    const repo = createRepo();
    git(repo.path, "update-ref", "refs/remotes/origin/develop", repo.base);
    commitFile(
      repo.path,
      "src/runtime/provider.ts",
      "export const provider = true;\n",
      "feat(runtime): add provider\n\nExtension-Point: provider-hook",
    );

    const result = runGate(repo.path, {
      GITHUB_EVENT_NAME: "push",
      GITHUB_EVENT_BEFORE: repo.base,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Extension-Point trailer present");
  });

  it("fails closed when a push has no previous commit", () => {
    const repo = createRepo();
    git(repo.path, "update-ref", "refs/remotes/origin/develop", repo.base);
    commitFile(repo.path, "docs/guide.md", "guide\n", "docs: add guide");

    const result = runGate(repo.path, { GITHUB_EVENT_NAME: "push" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("previous commit");
  });

  it("ignores base-only frozen changes on a pull request", () => {
    const repo = createRepo();
    git(repo.path, "checkout", "-q", "-b", "feature/docs");
    commitFile(repo.path, "docs/guide.md", "guide\n", "docs: add guide");
    git(repo.path, "checkout", "-q", "-b", "develop", repo.base);
    const develop = commitFile(
      repo.path,
      "src/runtime/provider.ts",
      "export const provider = true;\n",
      "feat(runtime): add provider\n\nExtension-Point: provider-hook",
    );
    git(repo.path, "update-ref", "refs/remotes/origin/develop", develop);
    git(repo.path, "checkout", "-q", "feature/docs");

    const result = runGate(repo.path, {
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_BASE_REF: "develop",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("no frozen path touched");
  });

  it("still rejects a pull request that changes a frozen file without a trailer", () => {
    const repo = createRepo();
    git(repo.path, "update-ref", "refs/remotes/origin/develop", repo.base);
    git(repo.path, "checkout", "-q", "-b", "feature/provider");
    commitFile(
      repo.path,
      "src/runtime/provider.ts",
      "export const provider = true;\n",
      "fix: change provider",
    );

    const result = runGate(repo.path, {
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_BASE_REF: "develop",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("R3 violation");
  });
});
