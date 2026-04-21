/**
 * lint-core-modifications.ts — discipline gate R3.
 *
 * If any commit in `BASE..HEAD` touches a frozen path (src/core/, src/runtime/,
 * src/db/, src/dashboard/routes/, src/server/), at least one commit in the
 * range must carry an `Extension-Point: <name>` trailer in its body.
 *
 * Escape hatch: label `core-modification-approved` on the PR → skip the check.
 *
 * CI-only (needs full git log + gh CLI for the PR label). Not wired into the
 * lefthook pre-commit/pre-push chain.
 */
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const FROZEN_PATH_PREFIXES = [
  "src/core/",
  "src/runtime/",
  "src/db/",
  "src/dashboard/routes/",
  "src/server/",
];

const EXTENSION_POINT_TRAILER = /^Extension-Point:\s*\S+/m;
const BYPASS_LABEL = "core-modification-approved";

export function filesTouchFrozenPaths(files: string[]): string[] {
  return files.filter((f) => FROZEN_PATH_PREFIXES.some((p) => f.startsWith(p)));
}

export function commitsCarryExtensionPoint(commitBodies: string[]): boolean {
  return commitBodies.some((body) => EXTENSION_POINT_TRAILER.test(body));
}

function resolveBaseRef(): string {
  if (process.env.GITHUB_BASE_REF) return `origin/${process.env.GITHUB_BASE_REF}`;
  if (process.env.LINT_BASE_REF) return process.env.LINT_BASE_REF;
  return "origin/develop";
}

function getChangedFiles(baseRef: string): string[] {
  const out = execSync(`git diff --name-only ${baseRef}..HEAD`, {
    encoding: "utf8",
  });
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

function getCommitBodies(baseRef: string): string[] {
  // `%B` = subject + body; use NUL delimiter to survive multi-line bodies.
  const out = execSync(`git log --format=%B%x00 ${baseRef}..HEAD`, {
    encoding: "utf8",
  });
  return out.split("\0").map((s) => s.trim()).filter(Boolean);
}

function hasBypassLabel(): boolean {
  if (!process.env.GITHUB_TOKEN) return false;
  try {
    const out = execSync("gh pr view --json labels --jq '.labels[].name'", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const labels = out.split("\n").map((s) => s.trim()).filter(Boolean);
    return labels.includes(BYPASS_LABEL);
  } catch {
    // Not inside a PR context, or gh CLI unavailable — fail-closed (no bypass).
    return false;
  }
}

function main(): void {
  const baseRef = resolveBaseRef();
  const files = getChangedFiles(baseRef);
  const frozen = filesTouchFrozenPaths(files);
  if (frozen.length === 0) {
    console.log("[lint:core-modifications] OK — no frozen path touched.");
    return;
  }
  if (hasBypassLabel()) {
    console.log(
      `[lint:core-modifications] Bypassed via PR label "${BYPASS_LABEL}". Frozen files: ${frozen.length}.`,
    );
    return;
  }
  const bodies = getCommitBodies(baseRef);
  if (commitsCarryExtensionPoint(bodies)) {
    console.log(
      `[lint:core-modifications] OK — Extension-Point trailer present (${frozen.length} frozen file(s) touched).`,
    );
    return;
  }
  console.error("");
  console.error("R3 violation — frozen paths modified without an `Extension-Point:` trailer.");
  console.error("");
  console.error("Frozen files touched:");
  for (const f of frozen) console.error(`  - ${f}`);
  console.error("");
  console.error("Fix: add a trailer to at least one commit in this PR, for example:");
  console.error("");
  console.error("    feat(core): add MFA check hook");
  console.error("");
  console.error("    Extension-Point: mfa-hook");
  console.error("");
  console.error(`Escape hatch (hotfixes only): add the \`${BYPASS_LABEL}\` label on the PR.`);
  process.exit(1);
}

const invoked = fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "");
if (invoked) main();
