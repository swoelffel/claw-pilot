import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const installer = readFileSync(new URL("../../install.sh", import.meta.url), "utf8");
const minimum = installer.match(/^MIN_NODE_(?:MAJOR|MINOR|VERSION)=.+$/gm)!.join("\n");
const check = installer.slice(
  installer.indexOf("# ── 4. Node.js check"),
  installer.indexOf("# ── 5. git check"),
);

describe("installer Node.js compatibility", () => {
  it.each([
    ["20.20.0", false],
    ["22.0.0", false],
    ["22.11.9", false],
    ["22.12.0", true],
    ["22.23.3", true],
    ["22.23.4", true],
    ["24.0.0", true],
  ])("checks %s against the declared minimum", (version, accepted) => {
    // Run only the real installer prerequisite block; no downloads or system changes.
    const result = spawnSync(
      "/bin/sh",
      [
        "-c",
        `${minimum}
error() { printf '%s\\n' "$*" >&2; exit 1; }
log() { printf '%s\\n' "$*"; }
resolve_node_bin() { printf '%s\\n' "$TEST_NODE_BIN"; }
prepend_path_dir() { :; }
node() {
  if [ "$1" = "-v" ]; then printf 'v%s\\n' "$TEST_NODE_VERSION";
  else "$TEST_NODE_BIN" "$@"; fi
}
${check}`,
      ],
      { env: { ...process.env, TEST_NODE_BIN: process.execPath, TEST_NODE_VERSION: version } },
    );
    expect(result.status, result.stderr.toString()).toBe(accepted ? 0 : 1);
    if (accepted) expect(result.stdout.toString()).toContain(`Node.js v${version}`);
    else expect(result.stderr.toString()).toContain("required");
  });
});
