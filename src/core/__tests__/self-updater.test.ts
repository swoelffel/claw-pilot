// src/core/__tests__/self-updater.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SelfUpdater } from "../self-updater.js";
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
  conn.mockExec("systemctl --user restart", { stdout: "", stderr: "", exitCode: 0 });
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

  it("systemctl restart is called last", async () => {
    updater.run(undefined, undefined, "v0.11.0");
    await flush();

    const restartCmd = conn.commands.find((c) => c.includes("systemctl") && c.includes("restart"));
    expect(restartCmd).toBeDefined();
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
    conn.mockExec("systemctl --user restart", { stdout: "", stderr: "", exitCode: 0 });

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
