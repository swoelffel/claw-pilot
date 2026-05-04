/**
 * lint-discipline-r3-local.ts — local-only wrapper around the R3 gate.
 *
 * The CI script (`scripts/lint-core-modifications.ts`) reads `GITHUB_BASE_REF`
 * to know which ref to diff against. That env var is unset locally, so the
 * underlying tool either falls back to `origin/develop` (correct only for a
 * branch that was actually opened against `develop`) or skips the check
 * entirely. Result: a contributor can amend/push a PR that fails CI on R3
 * after passing every local hook — exactly what happened on
 * `feature/security-sprint-c4-hmac-canonical` during the May 2026 sprint.
 *
 * This wrapper resolves the most likely base ref from the local git state
 * and exports it as `LINT_BASE_REF` before delegating to the existing
 * script. Heuristics, in order:
 *
 *   1. `git rev-parse --abbrev-ref --symbolic-full-name @{upstream}` →
 *      strip the `<remote>/` prefix and use the merge-base of HEAD against
 *      that ref. Matches the natural "I just pushed and want to know if CI
 *      will be green" flow.
 *   2. Fall back to `origin/develop` if no upstream is configured.
 *
 * Usage:
 *
 *   pnpm lint:discipline:r3-local
 *
 * Honours `LINT_BASE_REF` if the caller wants to override. Exits non-zero
 * on any R3 violation, same as the CI gate.
 */
import { execSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CI_SCRIPT = join(__dirname, "lint-core-modifications.ts");

function tryExec(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function resolveLocalBaseRef(): string {
  if (process.env.LINT_BASE_REF) return process.env.LINT_BASE_REF;

  const upstream = tryExec("git rev-parse --abbrev-ref --symbolic-full-name @{upstream}");
  if (upstream && upstream !== "@{upstream}") {
    // Use the merge-base so we only diff what this branch actually added on
    // top of its upstream — avoids dragging in commits that were merged into
    // develop after the branch was cut.
    const mergeBase = tryExec(`git merge-base ${upstream} HEAD`);
    if (mergeBase) return mergeBase;
    return upstream;
  }

  const fallback = tryExec("git merge-base origin/develop HEAD") ?? "origin/develop";
  return fallback;
}

function main(): void {
  const baseRef = resolveLocalBaseRef();
  console.log(`[lint:discipline:r3-local] base ref = ${baseRef}`);
  const result = spawnSync("node", ["--experimental-strip-types", "--no-warnings", CI_SCRIPT], {
    stdio: "inherit",
    env: { ...process.env, LINT_BASE_REF: baseRef },
  });
  process.exit(result.status ?? 1);
}

main();
