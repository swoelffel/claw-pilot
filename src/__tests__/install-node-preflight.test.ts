import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const installer = readFileSync(new URL("../../install.sh", import.meta.url), "utf8");
const preflightEnd = installer.indexOf("\nif ! command -v git >/dev/null 2>&1; then");
if (preflightEnd < 0) throw new Error("Installer preflight boundary not found");

const fixtures: string[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

function runPreflight(options: { shell: string; nodePath?: string; nodeVersion?: string }) {
  const fixture = mkdtempSync(join(tmpdir(), "claw-pilot-node-preflight-"));
  fixtures.push(fixture);
  const home = join(fixture, "home");
  const bin = join(fixture, "bin");
  mkdirSync(home);
  mkdirSync(bin);

  for (const tool of ["grep", "head", "sed", "tr", "dirname", "cut"]) {
    symlinkSync(`/usr/bin/${tool}`, join(bin, tool));
  }
  writeFileSync(join(bin, "curl"), "#!/bin/sh\nprintf '%s\\n' '{\"version\":\"0.84.5\"}'\n", {
    mode: 0o755,
  });
  writeFileSync(join(bin, "id"), "#!/bin/sh\nprintf '0\\n'\n", { mode: 0o755 });
  writeFileSync(join(bin, "uname"), "#!/bin/sh\nprintf 'Linux\\n'\n", { mode: 0o755 });

  if (options.nodePath) {
    const nodePath = options.nodePath.replace("$HOME", home).replace("$BIN", bin);
    mkdirSync(dirname(nodePath), { recursive: true });
    writeFileSync(nodePath, `#!/bin/sh\nprintf '%s\\n' 'v${options.nodeVersion ?? "22.12.0"}'\n`, {
      mode: 0o755,
    });
  }

  // The two system fallback paths are redirected only in this disposable copy.
  // This keeps the missing-Node scenario deterministic even on CI hosts with Node installed.
  const preflight = installer
    .slice(0, preflightEnd)
    .replaceAll("/usr/local/bin/node", join(fixture, "system/local/node"))
    .replaceAll("/usr/bin/node", join(fixture, "system/bin/node"));
  return spawnSync(options.shell, [], {
    input: `${preflight}\nprintf 'PREFLIGHT_OK\\n'\n`,
    encoding: "utf8",
    env: { HOME: home, PATH: bin, CLAW_PILOT_REPO_BRANCH: "test" },
  });
}

describe("install.sh Node.js preflight", () => {
  for (const shell of ["/bin/sh", "/bin/dash"].filter(existsSync)) {
    it(`explains missing Node.js under ${shell} and exits nonzero`, () => {
      const result = runPreflight({ shell });
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).toContain("Node.js >= 22.12.0");
      expect(result.stdout + result.stderr).toContain("https://nodejs.org/en/download");
      expect(result.stdout + result.stderr).toMatch(/re-run (the )?installer/i);
      expect(result.stdout).not.toContain("PREFLIGHT_OK");
    });
  }

  it("accepts the minimum compatible Node.js in PATH", () => {
    const result = runPreflight({ shell: "/bin/sh", nodePath: "$BIN/node" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Node.js v22.12.0");
    expect(result.stdout).toContain("PREFLIGHT_OK");
  });

  it("rejects Node.js 22 below the required minor version", () => {
    const result = runPreflight({
      shell: "/bin/sh",
      nodePath: "$BIN/node",
      nodeVersion: "22.11.0",
    });
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain("Node.js >= 22.12.0");
    expect(result.stdout).not.toContain("PREFLIGHT_OK");
  });

  for (const nodePath of [
    "$HOME/.nvm/versions/node/v22.12.0/bin/node",
    "$HOME/.volta/bin/node",
    "$HOME/.fnm/node-versions/v22.12.0/installation/bin/node",
  ]) {
    it(`finds Node.js at ${nodePath} when PATH lacks it`, () => {
      const result = runPreflight({ shell: "/bin/sh", nodePath });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Node.js v22.12.0");
      expect(result.stdout).toContain("PREFLIGHT_OK");
    });
  }
});
