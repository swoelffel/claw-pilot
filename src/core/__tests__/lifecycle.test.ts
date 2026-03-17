// src/core/__tests__/lifecycle.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../registry.js";
import { Lifecycle } from "../lifecycle.js";
import { MockConnection } from "./mock-connection.js";
import { InstanceNotFoundError } from "../../lib/errors.js";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

let _mockServiceManager: "systemd" | "launchd" = "systemd";
let _mockPidMap: Map<string, number | null> = new Map();
let _mockRunningMap: Map<string, boolean> = new Map();

vi.mock("../../lib/platform.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/platform.js")>();
  return {
    ...actual,
    getServiceManager: () => _mockServiceManager,
    getRuntimeStateDir: (slug: string) => `/home/test/.claw-pilot/instances/${slug}`,
    getRuntimePidPath: (stateDir: string) => `${stateDir}/runtime.pid`,
    getRuntimePid: (stateDir: string) => _mockPidMap.get(stateDir) ?? null,
    isRuntimeRunning: (stateDir: string) => _mockRunningMap.get(stateDir) ?? false,
    isDocker: () => false,
  };
});

// Mock ensureRuntimeConfig to avoid real filesystem operations
vi.mock("../../runtime/engine/config-loader.js", () => ({
  ensureRuntimeConfig: () => {},
}));

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const XDG = "/run/user/1000";

let tmpDir: string;
let registry: Registry;
let db: ReturnType<typeof initDatabase>;
let conn: MockConnection;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-lifecycle-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  registry = new Registry(db);
  conn = new MockConnection();
  _mockServiceManager = "systemd";
  _mockPidMap = new Map();
  _mockRunningMap = new Map();
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedInstance(opts: { slug?: string; port?: number } = {}) {
  const slug = opts.slug ?? "demo1";
  const port = opts.port ?? 18790;
  const server = registry.upsertLocalServer("testhost", "/home/test/.claw-pilot/instances");
  const stateDir = `/home/test/.claw-pilot/instances/${slug}`;

  const instance = registry.createInstance({
    serverId: server.id,
    slug,
    port,
    configPath: `${stateDir}/runtime.json`,
    stateDir,
    systemdUnit: `claw-runtime-${slug}`,
  });
  registry.allocatePort(server.id, port, slug);

  return { slug, port, stateDir, instance };
}

// ---------------------------------------------------------------------------
// Lifecycle.start()
// ---------------------------------------------------------------------------

describe("Lifecycle.start()", () => {
  it("throws InstanceNotFoundError for unknown slug", async () => {
    const lifecycle = new Lifecycle(conn, registry, XDG);
    await expect(lifecycle.start("nonexistent")).rejects.toThrow(InstanceNotFoundError);
  });

  it("updates state to 'running' and logs event on success", async () => {
    const { slug, stateDir } = seedInstance();
    // Simulate that the runtime starts successfully (PID file appears)
    _mockRunningMap.set(stateDir, true);
    _mockPidMap.set(stateDir, 12345);

    const lifecycle = new Lifecycle(conn, registry, XDG);
    await lifecycle.start(slug);

    expect(registry.getInstance(slug)?.state).toBe("running");
    const events = registry.listEvents(slug, 10);
    expect(events.some((e) => e.event_type === "started")).toBe(true);
  });

  it("is a no-op when runtime is already running", async () => {
    const { slug, stateDir } = seedInstance();
    _mockRunningMap.set(stateDir, true);
    _mockPidMap.set(stateDir, 12345);

    const lifecycle = new Lifecycle(conn, registry, XDG);
    // Should not throw — just logs and returns
    await lifecycle.start(slug);
    expect(registry.getInstance(slug)?.state).toBe("running");
  });
});

// ---------------------------------------------------------------------------
// Lifecycle.stop()
// ---------------------------------------------------------------------------

describe("Lifecycle.stop()", () => {
  it("throws InstanceNotFoundError for unknown slug", async () => {
    const lifecycle = new Lifecycle(conn, registry, XDG);
    await expect(lifecycle.stop("nonexistent")).rejects.toThrow(InstanceNotFoundError);
  });

  it("updates state to 'stopped' and logs event", async () => {
    const { slug } = seedInstance();
    // No PID running — stop is a no-op but still updates state
    const lifecycle = new Lifecycle(conn, registry, XDG);
    await lifecycle.stop(slug);

    expect(registry.getInstance(slug)?.state).toBe("stopped");
    const events = registry.listEvents(slug, 10);
    expect(events.some((e) => e.event_type === "stopped")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle.restart()
// ---------------------------------------------------------------------------

describe("Lifecycle.restart()", () => {
  it("throws InstanceNotFoundError for unknown slug", async () => {
    const lifecycle = new Lifecycle(conn, registry, XDG);
    await expect(lifecycle.restart("nonexistent")).rejects.toThrow(InstanceNotFoundError);
  });

  it("updates state to 'running' and logs event", async () => {
    const { slug, stateDir } = seedInstance();
    // Simulate restart:
    // - stopRuntime: getRuntimePid returns null → nothing to stop, returns immediately
    // - startRuntime: isRuntimeRunning returns true → already running, returns immediately
    // Don't set _mockPidMap (so stop is a no-op), but set running=true (so start sees it running)
    _mockRunningMap.set(stateDir, true);

    const lifecycle = new Lifecycle(conn, registry, XDG);
    await lifecycle.restart(slug);

    expect(registry.getInstance(slug)?.state).toBe("running");
    const events = registry.listEvents(slug, 10);
    expect(events.some((e) => e.event_type === "restarted")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle.enable()
// ---------------------------------------------------------------------------

describe("Lifecycle.enable()", () => {
  it("is a no-op for claw-runtime instances", async () => {
    const { slug } = seedInstance();
    const lifecycle = new Lifecycle(conn, registry, XDG);

    await lifecycle.enable(slug);

    // No commands should have been issued
    expect(conn.commands).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle.daemonReload()
// ---------------------------------------------------------------------------

describe("Lifecycle.daemonReload()", () => {
  it("calls systemctl daemon-reload on Linux", async () => {
    _mockServiceManager = "systemd";
    const lifecycle = new Lifecycle(conn, registry, XDG);

    await lifecycle.daemonReload();

    const cmds = conn.commands.join("\n");
    expect(cmds).toContain("systemctl");
    expect(cmds).toContain("daemon-reload");
  });

  it("is a no-op on launchd (macOS)", async () => {
    _mockServiceManager = "launchd";
    const lifecycle = new Lifecycle(conn, registry, XDG);

    await lifecycle.daemonReload();

    expect(conn.commands).toHaveLength(0);
  });
});
