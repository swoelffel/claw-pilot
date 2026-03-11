// src/core/__tests__/updater.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Updater } from "../updater.js";
import type { Registry } from "../registry.js";
import type { Lifecycle } from "../lifecycle.js";
import { MockConnection } from "./mock-connection.js";

/** Wait for all pending microtasks / macrotasks to flush */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let conn: MockConnection;
let listInstancesFn: ReturnType<typeof vi.fn>;
let restartFn: ReturnType<typeof vi.fn>;
let mockRegistry: Registry;
let mockLifecycle: Lifecycle;
let updater: Updater;

beforeEach(() => {
  conn = new MockConnection();

  listInstancesFn = vi.fn(() => []);
  restartFn = vi.fn(async () => {});

  // Minimal mock for Registry — only listInstances is used by Updater
  mockRegistry = {
    listInstances: listInstancesFn,
  } as unknown as Registry;

  // Minimal mock for Lifecycle — only restart is used by Updater
  mockLifecycle = {
    restart: restartFn,
  } as unknown as Lifecycle;

  updater = new Updater(conn, mockRegistry, mockLifecycle);

  // Default: npm install succeeds
  conn.mockExec("npm install -g openclaw@latest", {
    stdout: "added 1 package",
    stderr: "",
    exitCode: 0,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// getJob() — initial state
// ---------------------------------------------------------------------------

describe("Updater.getJob()", () => {
  it("initial state → { status: 'idle', jobId: '' }", () => {
    const job = updater.getJob();
    expect(job.status).toBe("idle");
    expect(job.jobId).toBe("");
  });
});

// ---------------------------------------------------------------------------
// run() — fire-and-forget behaviour
// ---------------------------------------------------------------------------

describe("Updater.run()", () => {
  it("sets status to 'running' immediately after call", () => {
    updater.run();
    const job = updater.getJob();
    expect(job.status).toBe("running");
  });

  it("is a no-op if already running (second call ignored)", () => {
    updater.run();
    const firstJobId = updater.getJob().jobId;

    updater.run(); // second call — should be ignored
    expect(updater.getJob().jobId).toBe(firstJobId);
  });

  it("stores fromVersion and toVersion in the job", () => {
    updater.run("2026.2.26", "2026.3.1");
    const job = updater.getJob();
    expect(job.fromVersion).toBe("2026.2.26");
    expect(job.toVersion).toBe("2026.3.1");
  });
});

// ---------------------------------------------------------------------------
// _execute() — async completion scenarios
// ---------------------------------------------------------------------------

describe("Updater — successful update", () => {
  it("no running instances → status 'done', message contains '0 instance(s) restarted'", async () => {
    listInstancesFn.mockReturnValue([]);

    updater.run();
    await flush();

    const job = updater.getJob();
    expect(job.status).toBe("done");
    expect(job.message).toContain("0 instance(s) restarted");
    expect(job.finishedAt).toBeDefined();
  });

  it("2 running instances → lifecycle.restart called twice, message contains '2 instance(s) restarted'", async () => {
    listInstancesFn.mockReturnValue([
      { slug: "inst1", state: "running" },
      { slug: "inst2", state: "running" },
    ]);

    updater.run();
    await flush();

    expect(restartFn).toHaveBeenCalledTimes(2);
    expect(restartFn).toHaveBeenCalledWith("inst1");
    expect(restartFn).toHaveBeenCalledWith("inst2");

    const job = updater.getJob();
    expect(job.status).toBe("done");
    expect(job.message).toContain("2 instance(s) restarted");
  });

  it("lifecycle.restart throws for one instance → update still completes as 'done'", async () => {
    listInstancesFn.mockReturnValue([{ slug: "inst1", state: "running" }]);
    restartFn.mockRejectedValueOnce(new Error("restart failed"));

    updater.run();
    await flush();

    // Error is swallowed per-instance — overall job should still be done
    const job = updater.getJob();
    expect(job.status).toBe("done");
  });

  it("only running instances are restarted (stopped ones skipped)", async () => {
    listInstancesFn.mockReturnValue([
      { slug: "running-inst", state: "running" },
      { slug: "stopped-inst", state: "stopped" },
    ]);

    updater.run();
    await flush();

    expect(restartFn).toHaveBeenCalledTimes(1);
    expect(restartFn).toHaveBeenCalledWith("running-inst");

    const job = updater.getJob();
    expect(job.message).toContain("1 instance(s) restarted");
  });
});

// ---------------------------------------------------------------------------
// _execute() — npm install failure scenarios
// ---------------------------------------------------------------------------

describe("Updater — npm install failure", () => {
  it("npm install exits with code 1 → status 'error', message contains npm error output", async () => {
    conn.mockExec("npm install -g openclaw@latest", {
      stdout: "npm ERR! code E404",
      stderr: "",
      exitCode: 1,
    });

    updater.run();
    await flush();

    const job = updater.getJob();
    expect(job.status).toBe("error");
    expect(job.message).toContain("npm ERR! code E404");
    expect(job.finishedAt).toBeDefined();
  });

  it("npm install exits with code 1 and empty stdout → status 'error', message is 'npm install failed'", async () => {
    conn.mockExec("npm install -g openclaw@latest", {
      stdout: "",
      stderr: "",
      exitCode: 1,
    });

    updater.run();
    await flush();

    const job = updater.getJob();
    expect(job.status).toBe("error");
    expect(job.message).toBe("npm install failed");
  });
});

// ---------------------------------------------------------------------------
// getJob() returns a copy — mutating it doesn't affect internal state
// ---------------------------------------------------------------------------

describe("Updater.getJob() — returns a copy", () => {
  it("mutating the returned object does not affect internal state", async () => {
    conn.mockExec("npm install -g openclaw@latest", {
      stdout: "ok",
      stderr: "",
      exitCode: 0,
    });
    listInstancesFn.mockReturnValue([]);

    updater.run();
    await flush();

    const job = updater.getJob();
    expect(job.status).toBe("done");

    // Mutate the returned copy
    (job as { status: string }).status = "idle";

    // Internal state must be unchanged
    expect(updater.getJob().status).toBe("done");
  });
});
