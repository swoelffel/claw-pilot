// src/lib/__tests__/shell-errors-platform.test.ts
import * as os from "node:os";
import * as path from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { shellEscape } from "../shell.js";
import {
  CliError,
  ClawPilotError,
  InstanceNotFoundError,
  InstanceAlreadyExistsError,
  GatewayUnhealthyError,
} from "../errors.js";
import {
  getDataDir,
  getDbPath,
  isLinux,
  isDarwin,
  getInstancesDir,
  getRuntimeStateDir,
  getRuntimeConfigPath,
  getRuntimePidPath,
  getRuntimePid,
  deriveWebChatPort,
} from "../platform.js";

// ---------------------------------------------------------------------------
// shellEscape
// ---------------------------------------------------------------------------

describe("shellEscape", () => {
  it("wraps a simple string in single quotes", () => {
    expect(shellEscape("hello")).toBe("'hello'");
  });

  it("escapes embedded single quotes", () => {
    expect(shellEscape("it's")).toBe("'it'\\''s'");
  });

  it("handles empty string", () => {
    expect(shellEscape("")).toBe("''");
  });
});

// ---------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------

describe("CliError", () => {
  it("has default exitCode of 1", () => {
    const err = new CliError("boom");
    expect(err.message).toBe("boom");
    expect(err.exitCode).toBe(1);
    expect(err.name).toBe("CliError");
  });

  it("preserves a custom exitCode", () => {
    const err = new CliError("fatal", 42);
    expect(err.exitCode).toBe(42);
  });
});

describe("ClawPilotError", () => {
  it("has message and code", () => {
    const err = new ClawPilotError("oops", "SOME_CODE");
    expect(err.message).toBe("oops");
    expect(err.code).toBe("SOME_CODE");
    expect(err.name).toBe("ClawPilotError");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("InstanceNotFoundError", () => {
  it("includes slug in message and sets INSTANCE_NOT_FOUND code", () => {
    const err = new InstanceNotFoundError("my-bot");
    expect(err.message).toContain("my-bot");
    expect(err.code).toBe("INSTANCE_NOT_FOUND");
    expect(err).toBeInstanceOf(ClawPilotError);
  });
});

describe("InstanceAlreadyExistsError", () => {
  it("includes slug in message and sets INSTANCE_EXISTS code", () => {
    const err = new InstanceAlreadyExistsError("my-bot");
    expect(err.message).toContain("my-bot");
    expect(err.code).toBe("INSTANCE_EXISTS");
    expect(err).toBeInstanceOf(ClawPilotError);
  });
});

describe("GatewayUnhealthyError", () => {
  it("without detail: message includes slug and port", () => {
    const err = new GatewayUnhealthyError("my-bot", 18800);
    expect(err.message).toContain("my-bot");
    expect(err.message).toContain("18800");
    expect(err.code).toBe("GATEWAY_UNHEALTHY");
  });

  it("with detail: message includes detail after em-dash", () => {
    const err = new GatewayUnhealthyError("my-bot", 18800, "connection refused");
    expect(err.message).toContain("my-bot");
    expect(err.message).toContain("18800");
    expect(err.message).toContain("—");
    expect(err.message).toContain("connection refused");
  });
});

// ---------------------------------------------------------------------------
// platform
// ---------------------------------------------------------------------------

describe("platform", () => {
  it("getDataDir returns path ending in .claw-pilot", () => {
    expect(getDataDir()).toBe(path.join(os.homedir(), ".claw-pilot"));
  });

  it("getDbPath returns path ending in registry.db", () => {
    const dbPath = getDbPath();
    expect(dbPath).toMatch(/registry\.db$/);
    expect(dbPath.startsWith(getDataDir())).toBe(true);
  });

  it("isLinux and isDarwin return booleans matching os.platform()", () => {
    const plat = os.platform();
    expect(typeof isLinux()).toBe("boolean");
    expect(typeof isDarwin()).toBe("boolean");
    expect(isLinux()).toBe(plat === "linux");
    expect(isDarwin()).toBe(plat === "darwin");
  });

  it("getInstancesDir returns path containing /instances", () => {
    const dir = getInstancesDir();
    expect(dir).toContain("/instances");
    expect(dir.startsWith(getDataDir())).toBe(true);
  });

  it("getRuntimeStateDir includes the slug", () => {
    const dir = getRuntimeStateDir("my-bot");
    expect(dir).toContain("my-bot");
    expect(dir.startsWith(getInstancesDir())).toBe(true);
  });

  it("getRuntimeConfigPath ends with runtime.json", () => {
    const p = getRuntimeConfigPath("my-bot");
    expect(p).toMatch(/runtime\.json$/);
    expect(p).toContain("my-bot");
  });

  it("getRuntimePidPath returns <stateDir>/runtime.pid", () => {
    expect(getRuntimePidPath("/tmp/foo")).toBe("/tmp/foo/runtime.pid");
  });

  it("getRuntimePid returns null for missing PID file", () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "cp-test-"));
    try {
      // No PID file exists — should return null
      expect(getRuntimePid(tmpDir)).toBeNull();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("getRuntimePid returns null for a non-existent process", () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "cp-test-"));
    try {
      // Write a PID that (almost certainly) does not exist
      writeFileSync(path.join(tmpDir, "runtime.pid"), "99999999\n");
      expect(getRuntimePid(tmpDir)).toBeNull();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("deriveWebChatPort returns a port in range 19100-19199", () => {
    const port = deriveWebChatPort("test-instance");
    expect(port).toBeGreaterThanOrEqual(19100);
    expect(port).toBeLessThanOrEqual(19199);
  });

  it("deriveWebChatPort is deterministic (same slug → same port)", () => {
    const a = deriveWebChatPort("stable-slug");
    const b = deriveWebChatPort("stable-slug");
    expect(a).toBe(b);
  });
});
