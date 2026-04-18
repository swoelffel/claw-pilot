// src/core/__tests__/self-updater.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SelfUpdater } from "../self-updater.js";
import type { Lifecycle } from "../lifecycle.js";
import type { Registry } from "../registry.js";
import type { InstanceRecord } from "../registry-types.js";
import { MockConnection } from "./mock-connection.js";

/** Wait for all pending microtasks / macrotasks to flush */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let conn: MockConnection;
let updater: SelfUpdater;

function mockSuccessSequence(conn: MockConnection) {
  conn.mockExec("git fetch", { stdout: "", stderr: "", exitCode: 0 });
  conn.mockExec(`git -C`, { stdout: "", stderr: "", exitCode: 0 });
  // test -w checks return 0 (writable) → no sudo needed
  conn.mockExec("test -w", { stdout: "", stderr: "", exitCode: 0 });
  conn.mockExec("pnpm --dir", { stdout: "", stderr: "", exitCode: 0 });
  // Linux system service detection: test -f returns 1 (not found) → user service fallback
  conn.mockExec("test -f /etc/systemd/system/", { stdout: "", stderr: "", exitCode: 1 });
  // Linux restart (user service fallback)
  conn.mockExec("systemctl --user restart", { stdout: "", stderr: "", exitCode: 0 });
  // macOS restart: nohup sh -c 'sleep 3 && launchctl start ...' & launchctl stop ...
  conn.mockExec("nohup sh -c", { stdout: "", stderr: "", exitCode: 0 });
  conn.mockExec("launchctl stop", { stdout: "", stderr: "", exitCode: 0 });
}

beforeEach(() => {
  conn = new MockConnection();
  updater = new SelfUpdater(conn);
  mockSuccessSequence(conn);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// getJob() — initial state
// ---------------------------------------------------------------------------

describe("SelfUpdater.getJob()", () => {
  it("initial state → { status: 'idle', jobId: '' }", () => {
    const job = updater.getJob();
    expect(job.status).toBe("idle");
    expect(job.jobId).toBe("");
  });
});

// ---------------------------------------------------------------------------
// run() — fire-and-forget behaviour
// ---------------------------------------------------------------------------

describe("SelfUpdater.run()", () => {
  it("sets status to 'running' immediately after call", () => {
    updater.run();
    expect(updater.getJob().status).toBe("running");
  });

  it("is a no-op if already running (second call ignored)", () => {
    updater.run();
    const firstJobId = updater.getJob().jobId;
    updater.run(); // second call — should be ignored
    expect(updater.getJob().jobId).toBe(firstJobId);
  });

  it("stores fromVersion, toVersion in the job", () => {
    updater.run("0.10.2", "0.11.0", "v0.11.0");
    const job = updater.getJob();
    expect(job.fromVersion).toBe("0.10.2");
    expect(job.toVersion).toBe("0.11.0");
  });

  it("generates a unique jobId on each run", () => {
    updater.run();
    const id1 = updater.getJob().jobId;
    // Reset to idle to allow a second run
    (updater as unknown as { _job: { status: string } })._job.status = "idle";
    updater.run();
    const id2 = updater.getJob().jobId;
    expect(id1).not.toBe(id2);
  });
});

// ---------------------------------------------------------------------------
// _execute() — successful update
// ---------------------------------------------------------------------------

describe("SelfUpdater — successful update", () => {
  it("status becomes 'done' after successful sequence", async () => {
    updater.run("0.10.2", "0.11.0", "v0.11.0");
    await flush();

    const job = updater.getJob();
    expect(job.status).toBe("done");
    expect(job.finishedAt).toBeDefined();
  });

  it("message contains the target tag", async () => {
    updater.run(undefined, undefined, "v0.11.0");
    await flush();

    const job = updater.getJob();
    expect(job.message).toContain("v0.11.0");
  });

  it("git fetch is called with the install dir", async () => {
    updater.run(undefined, undefined, "v0.11.0");
    await flush();

    const fetchCmd = conn.commands.find((c) => c.includes("git") && c.includes("fetch"));
    expect(fetchCmd).toBeDefined();
  });

  it("git checkout is called with the tag", async () => {
    updater.run(undefined, undefined, "v0.11.0");
    await flush();

    const checkoutCmd = conn.commands.find((c) => c.includes("checkout") && c.includes("v0.11.0"));
    expect(checkoutCmd).toBeDefined();
  });

  it.each([
    "v1.2.3; rm -rf /",
    "v1.2.3 && curl evil",
    "v1.2.3`whoami`",
    "$(id)",
    "../main",
    "v1.2",
    "release/1.0",
    "",
  ])("refuses to check out unsafe ref %s", async (badRef) => {
    updater.run(undefined, undefined, badRef);
    await flush();

    const job = updater.getJob();
    expect(job.status).toBe("error");
    expect(job.message).toContain("unsafe ref");
    const checkoutCmd = conn.commands.find((c) => c.includes("git") && c.includes("checkout"));
    expect(checkoutCmd).toBeUndefined();
  });

  it.each(["v0.77.1", "v10.20.30", "v1.2.3-beta.4", "main"])(
    "accepts safe ref %s",
    async (goodRef) => {
      updater.run(undefined, undefined, goodRef);
      await flush();

      const job = updater.getJob();
      expect(job.status).toBe("done");
    },
  );

  it("restart service command is called last (systemctl or launchctl)", async () => {
    updater.run(undefined, undefined, "v0.11.0");
    await flush();

    // Sur Linux : systemctl --user restart
    // Sur macOS : nohup sh -c 'sleep 3 && launchctl start ...' & launchctl stop ...
    const restartCmd = conn.commands.find(
      (c) =>
        (c.includes("systemctl") && c.includes("restart")) ||
        c.includes("launchctl") ||
        c.includes("nohup"),
    );
    expect(restartCmd).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// _bootstrapPackageManager — corepack bootstrap from packageManager field
// ---------------------------------------------------------------------------

describe("SelfUpdater — packageManager bootstrap via corepack", () => {
  it("invokes 'corepack prepare <pm> --activate' when packageManager field is present", async () => {
    conn = new MockConnection();
    mockSuccessSequence(conn);
    updater = new SelfUpdater(conn);

    // Seed package.json at the resolved install dir
    const installDir = updater._resolveInstallDir();
    conn.files.set(
      `${installDir}/package.json`,
      JSON.stringify({ packageManager: "pnpm@10.17.0" }),
    );

    // Mock corepack success
    conn.mockExec("corepack prepare", { stdout: "", stderr: "", exitCode: 0 });

    updater.run(undefined, undefined, "v1.0.0");
    await flush();

    const corepackCmd = conn.commands.find(
      (c) =>
        c.includes("corepack prepare") && c.includes("pnpm@10.17.0") && c.includes("--activate"),
    );
    expect(corepackCmd).toBeDefined();
    expect(updater.getJob().status).toBe("done");
  });

  it("skips corepack call when packageManager field is missing", async () => {
    conn = new MockConnection();
    mockSuccessSequence(conn);
    updater = new SelfUpdater(conn);

    // Seed package.json with NO packageManager field
    const installDir = updater._resolveInstallDir();
    conn.files.set(`${installDir}/package.json`, JSON.stringify({ name: "claw-pilot" }));

    updater.run(undefined, undefined, "v1.0.0");
    await flush();

    const corepackCmd = conn.commands.find((c) => c.includes("corepack prepare"));
    expect(corepackCmd).toBeUndefined();
    expect(updater.getJob().status).toBe("done");
  });

  it("skips corepack call when packageManager value is not pnpm", async () => {
    conn = new MockConnection();
    mockSuccessSequence(conn);
    updater = new SelfUpdater(conn);

    const installDir = updater._resolveInstallDir();
    conn.files.set(`${installDir}/package.json`, JSON.stringify({ packageManager: "yarn@4.5.0" }));

    updater.run(undefined, undefined, "v1.0.0");
    await flush();

    const corepackCmd = conn.commands.find((c) => c.includes("corepack prepare"));
    expect(corepackCmd).toBeUndefined();
    expect(updater.getJob().status).toBe("done");
  });

  it("continues update when corepack prepare fails (non-fatal)", async () => {
    conn = new MockConnection();
    mockSuccessSequence(conn);
    updater = new SelfUpdater(conn);

    const installDir = updater._resolveInstallDir();
    conn.files.set(`${installDir}/package.json`, JSON.stringify({ packageManager: "pnpm@11.0.0" }));
    conn.mockExec("corepack prepare", {
      stdout: "",
      stderr: "corepack: not installed",
      exitCode: 1,
    });

    updater.run(undefined, undefined, "v1.0.0");
    await flush();

    // Update still completes — corepack failure is non-fatal
    expect(updater.getJob().status).toBe("done");
  });

  it("skips corepack call when package.json cannot be read", async () => {
    conn = new MockConnection();
    mockSuccessSequence(conn);
    updater = new SelfUpdater(conn);

    // Do NOT seed package.json — readFile will throw

    updater.run(undefined, undefined, "v1.0.0");
    await flush();

    const corepackCmd = conn.commands.find((c) => c.includes("corepack prepare"));
    expect(corepackCmd).toBeUndefined();
    expect(updater.getJob().status).toBe("done");
  });
});

// ---------------------------------------------------------------------------
// _execute() — failure scenarios
// ---------------------------------------------------------------------------

describe("SelfUpdater — git fetch failure", () => {
  it("git fetch fails → status 'error', message contains error output", async () => {
    // Reinitialiser la connexion sans aucun mock de succes
    conn = new MockConnection();
    updater = new SelfUpdater(conn);
    // Seul le fetch echoue — les autres commandes retournent exitCode 1 par defaut
    // (MockConnection retourne exitCode 0 par defaut, donc on mock explicitement l'echec)
    conn.mockExec("fetch --tags", {
      stdout: "",
      stderr: "fatal: repository not found",
      exitCode: 1,
    });

    updater.run();
    await flush();

    const job = updater.getJob();
    expect(job.status).toBe("error");
    expect(job.message).toContain("repository not found");
  });
});

describe("SelfUpdater — pnpm build failure", () => {
  it("pnpm build fails → status 'error'", async () => {
    // Override: build fails
    conn.mockExec("pnpm --dir", {
      stdout: "Build error: type mismatch",
      stderr: "",
      exitCode: 1,
    });

    updater.run();
    await flush();

    const job = updater.getJob();
    expect(job.status).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// getJob() returns a copy
// ---------------------------------------------------------------------------

describe("SelfUpdater.getJob() — returns a copy", () => {
  it("mutating the returned object does not affect internal state", async () => {
    updater.run();
    await flush();

    const job = updater.getJob();
    expect(job.status).toBe("done");

    (job as { status: string }).status = "idle";
    expect(updater.getJob().status).toBe("done");
  });
});

// ---------------------------------------------------------------------------
// _resolveInstallDir()
// ---------------------------------------------------------------------------

describe("SelfUpdater._resolveInstallDir()", () => {
  it("returns a non-empty string", () => {
    const dir = updater._resolveInstallDir();
    expect(typeof dir).toBe("string");
    expect(dir.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// sudo fallback when dist/ or node_modules/ is not writable
// ---------------------------------------------------------------------------

describe("SelfUpdater — sudo fallback on EACCES", () => {
  it("uses sudo for build and install when dirs are not writable", async () => {
    conn = new MockConnection();
    updater = new SelfUpdater(conn);
    // git steps succeed
    conn.mockExec("git fetch", { stdout: "", stderr: "", exitCode: 0 });
    conn.mockExec("git -C", { stdout: "", stderr: "", exitCode: 0 });
    // All test -w checks return 1 (not writable) → sudo needed for both install and build
    conn.mockExec("test -w", { stdout: "", stderr: "", exitCode: 1 });
    // sudo commands succeed
    conn.mockExec("sudo -E env", { stdout: "", stderr: "", exitCode: 0 });
    // Linux system service detection: not found → user service fallback
    conn.mockExec("test -f /etc/systemd/system/", { stdout: "", stderr: "", exitCode: 1 });
    conn.mockExec("systemctl --user restart", { stdout: "", stderr: "", exitCode: 0 });
    conn.mockExec("nohup sh -c", { stdout: "", stderr: "", exitCode: 0 });
    conn.mockExec("launchctl stop", { stdout: "", stderr: "", exitCode: 0 });

    updater.run();
    await flush();

    const sudoBuild = conn.commands.find((c) => c.includes("sudo -E env") && c.includes("build"));
    const sudoInstall = conn.commands.find(
      (c) => c.includes("sudo -E env") && c.includes("install"),
    );
    expect(sudoBuild).toBeDefined();
    expect(sudoInstall).toBeDefined();
    expect(updater.getJob().status).toBe("done");
  });

  it("does NOT use sudo when dirs are writable (normal path)", async () => {
    // Default MockConnection returns exitCode: 0 for all commands (writable)
    updater.run();
    await flush();

    const sudoCmd = conn.commands.find((c) => c.includes("sudo -E env"));
    expect(sudoCmd).toBeUndefined();
    expect(updater.getJob().status).toBe("done");
  });
});

// ---------------------------------------------------------------------------
// Linux restart: system service vs user service detection
// ---------------------------------------------------------------------------

describe("SelfUpdater — Linux system service restart", () => {
  it("uses 'sudo systemctl restart' when system service file exists", async () => {
    // Skip on macOS — this test is Linux-specific
    if (process.platform === "darwin") return;

    conn = new MockConnection();
    updater = new SelfUpdater(conn);
    conn.mockExec("git fetch", { stdout: "", stderr: "", exitCode: 0 });
    conn.mockExec("git -C", { stdout: "", stderr: "", exitCode: 0 });
    conn.mockExec("test -w", { stdout: "", stderr: "", exitCode: 0 });
    conn.mockExec("pnpm --dir", { stdout: "", stderr: "", exitCode: 0 });
    // System service file exists → exitCode 0
    conn.mockExec("test -f /etc/systemd/system/", { stdout: "", stderr: "", exitCode: 0 });
    conn.mockExec("nohup sh -c", { stdout: "", stderr: "", exitCode: 0 });

    updater.run(undefined, undefined, "v1.0.0");
    await flush();

    const restartCmd = conn.commands.find(
      (c) => c.includes("sudo systemctl restart") && c.includes("claw-pilot-dashboard"),
    );
    expect(restartCmd).toBeDefined();
    expect(updater.getJob().status).toBe("done");
  });

  it("uses 'systemctl --user restart' when no system service file", async () => {
    // Skip on macOS — this test is Linux-specific
    if (process.platform === "darwin") return;

    conn = new MockConnection();
    updater = new SelfUpdater(conn);
    conn.mockExec("git fetch", { stdout: "", stderr: "", exitCode: 0 });
    conn.mockExec("git -C", { stdout: "", stderr: "", exitCode: 0 });
    conn.mockExec("test -w", { stdout: "", stderr: "", exitCode: 0 });
    conn.mockExec("pnpm --dir", { stdout: "", stderr: "", exitCode: 0 });
    // System service file NOT found → exitCode 1 → user service fallback
    conn.mockExec("test -f /etc/systemd/system/", { stdout: "", stderr: "", exitCode: 1 });
    conn.mockExec("systemctl --user restart", { stdout: "", stderr: "", exitCode: 0 });

    updater.run(undefined, undefined, "v1.0.0");
    await flush();

    const restartCmd = conn.commands.find((c) => c.includes("systemctl --user restart"));
    expect(restartCmd).toBeDefined();
    expect(updater.getJob().status).toBe("done");
  });
});

// ---------------------------------------------------------------------------
// Runtime restart after update
// ---------------------------------------------------------------------------

function makeInstance(slug: string, state: InstanceRecord["state"]): InstanceRecord {
  return {
    id: 1,
    server_id: 1,
    slug,
    display_name: slug,
    port: 19100,
    state,
    config_path: `/home/test/.claw-pilot/instances/${slug}/runtime.json`,
    state_dir: `/home/test/.claw-pilot/instances/${slug}`,
    systemd_unit: `claw-runtime-${slug}`,
    telegram_bot: null,
    default_model: null,
    discovered: 0,
    instance_type: "claw-runtime",
    runtime_config_json: null,
    is_system: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function mockLifecycle(restartFn?: Lifecycle["restart"]): Lifecycle {
  return { restart: restartFn ?? vi.fn().mockResolvedValue(undefined) } as unknown as Lifecycle;
}

function mockRegistry(instances: InstanceRecord[]): Registry {
  return { listInstances: vi.fn().mockReturnValue(instances) } as unknown as Registry;
}

describe("SelfUpdater — runtime restart after update", () => {
  it("restarts all running runtimes after successful build", async () => {
    const instances = [makeInstance("alpha", "running"), makeInstance("beta", "running")];
    const lifecycle = mockLifecycle();
    const registry = mockRegistry(instances);

    conn = new MockConnection();
    mockSuccessSequence(conn);
    updater = new SelfUpdater(conn, lifecycle, registry);

    updater.run(undefined, undefined, "v1.0.0");
    await flush();

    expect(lifecycle.restart).toHaveBeenCalledTimes(2);
    expect(lifecycle.restart).toHaveBeenCalledWith("alpha");
    expect(lifecycle.restart).toHaveBeenCalledWith("beta");
    expect(updater.getJob().status).toBe("done");
    expect(updater.getJob().message).toContain("Restarted 2 runtime(s).");
  });

  it("skips stopped instances", async () => {
    const instances = [makeInstance("alpha", "running"), makeInstance("beta", "stopped")];
    const lifecycle = mockLifecycle();
    const registry = mockRegistry(instances);

    conn = new MockConnection();
    mockSuccessSequence(conn);
    updater = new SelfUpdater(conn, lifecycle, registry);

    updater.run(undefined, undefined, "v1.0.0");
    await flush();

    expect(lifecycle.restart).toHaveBeenCalledTimes(1);
    expect(lifecycle.restart).toHaveBeenCalledWith("alpha");
  });

  it("continues if one runtime restart fails", async () => {
    const instances = [makeInstance("alpha", "running"), makeInstance("beta", "running")];
    const restartFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("alpha timeout"))
      .mockResolvedValueOnce(undefined);
    const lifecycle = mockLifecycle(restartFn);
    const registry = mockRegistry(instances);

    conn = new MockConnection();
    mockSuccessSequence(conn);
    updater = new SelfUpdater(conn, lifecycle, registry);

    updater.run(undefined, undefined, "v1.0.0");
    await flush();

    expect(restartFn).toHaveBeenCalledTimes(2);
    expect(updater.getJob().status).toBe("done");
    expect(updater.getJob().message).toContain("1/2");
    expect(updater.getJob().message).toContain("1 failed");
  });

  it("skips runtime restart when no lifecycle provided (CLI mode)", async () => {
    conn = new MockConnection();
    mockSuccessSequence(conn);
    updater = new SelfUpdater(conn);

    updater.run(undefined, undefined, "v1.0.0");
    await flush();

    expect(updater.getJob().status).toBe("done");
    expect(updater.getJob().message).toContain("CLI mode");
  });

  it("handles zero running runtimes gracefully", async () => {
    const instances = [makeInstance("alpha", "stopped")];
    const lifecycle = mockLifecycle();
    const registry = mockRegistry(instances);

    conn = new MockConnection();
    mockSuccessSequence(conn);
    updater = new SelfUpdater(conn, lifecycle, registry);

    updater.run(undefined, undefined, "v1.0.0");
    await flush();

    expect(lifecycle.restart).not.toHaveBeenCalled();
    expect(updater.getJob().status).toBe("done");
    expect(updater.getJob().message).toContain("No running runtimes");
  });
});
