// src/core/__tests__/discovery.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../registry.js";
import { InstanceDiscovery } from "../discovery.js";
import { MockConnection } from "./mock-connection.js";

// Mock getRuntimePid to control running status in tests
let _mockPidMap: Map<string, number | null> = new Map();

vi.mock("../../lib/platform.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/platform.js")>();
  return {
    ...actual,
    getRuntimePid: (stateDir: string) => _mockPidMap.get(stateDir) ?? null,
  };
});

let tmpDir: string;
let registry: Registry;
let db: ReturnType<typeof initDatabase>;
let conn: MockConnection;
const HOME = "/home/test";

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-disc-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  registry = new Registry(db);
  registry.upsertLocalServer("testhost", HOME);
  conn = new MockConnection();
  _mockPidMap = new Map();
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function makeConfig(port: number, agents?: Array<{ id: string; name: string }>): string {
  return JSON.stringify({
    port,
    agents: agents ?? [],
  });
}

describe("InstanceDiscovery — directory scan", () => {
  it("discovers instance from .runtime-<slug> directory", async () => {
    const stateDir = `${HOME}/.runtime-demo1`;
    const configPath = `${stateDir}/runtime.json`;
    // Seed the config file — MockConnection.readdir() will find .runtime-demo1 under HOME
    conn.files.set(configPath, makeConfig(18789));

    const discovery = new InstanceDiscovery(conn, registry, HOME, "/run/user/1000");
    const result = await discovery.scan();

    expect(result.instances).toHaveLength(1);
    expect(result.instances[0]?.slug).toBe("demo1");
    expect(result.instances[0]?.port).toBe(18789);
    expect(result.instances[0]?.source).toBe("directory");
  });

  it("skips directories without runtime.json", async () => {
    // Add a directory but no runtime.json file
    conn.dirs.add(`${HOME}/.runtime-empty`);

    const discovery = new InstanceDiscovery(conn, registry, HOME, "/run/user/1000");
    const result = await discovery.scan();
    expect(result.instances).toHaveLength(0);
  });

  it("skips malformed runtime.json", async () => {
    conn.files.set(`${HOME}/.runtime-bad/runtime.json`, "not json {{{");

    const discovery = new InstanceDiscovery(conn, registry, HOME, "/run/user/1000");
    const result = await discovery.scan();
    expect(result.instances).toHaveLength(0);
  });

  it("skips config without port", async () => {
    conn.files.set(`${HOME}/.runtime-nport/runtime.json`, JSON.stringify({}));

    const discovery = new InstanceDiscovery(conn, registry, HOME, "/run/user/1000");
    const result = await discovery.scan();
    expect(result.instances).toHaveLength(0);
  });

  it("discovers agents list from config", async () => {
    conn.files.set(
      `${HOME}/.runtime-demo1/runtime.json`,
      makeConfig(18789, [{ id: "pm", name: "Project Manager" }]),
    );

    const discovery = new InstanceDiscovery(conn, registry, HOME, "/run/user/1000");
    const result = await discovery.scan();
    // Should have at least the pm agent (and possibly a synthetic main)
    expect(result.instances[0]?.agents.length).toBeGreaterThanOrEqual(1);
    expect(result.instances[0]?.agents.some((a) => a.id === "pm")).toBe(true);
  });

  it("reports runtimeRunning=true and pid when PID file exists", async () => {
    const stateDir = `${HOME}/.runtime-running1`;
    conn.files.set(`${stateDir}/runtime.json`, makeConfig(18789));
    _mockPidMap.set(stateDir, 12345);

    const discovery = new InstanceDiscovery(conn, registry, HOME, "/run/user/1000");
    const result = await discovery.scan();

    expect(result.instances).toHaveLength(1);
    expect(result.instances[0]?.runtimeRunning).toBe(true);
    expect(result.instances[0]?.pid).toBe(12345);
  });

  it("reports runtimeRunning=false when no PID file", async () => {
    const stateDir = `${HOME}/.runtime-stopped1`;
    conn.files.set(`${stateDir}/runtime.json`, makeConfig(18789));

    const discovery = new InstanceDiscovery(conn, registry, HOME, "/run/user/1000");
    const result = await discovery.scan();

    expect(result.instances).toHaveLength(1);
    expect(result.instances[0]?.runtimeRunning).toBe(false);
    expect(result.instances[0]?.pid).toBeNull();
  });
});

describe("InstanceDiscovery — reconciliation", () => {
  it("identifies new instances", async () => {
    conn.files.set(`${HOME}/.runtime-demo1/runtime.json`, makeConfig(18789));

    const discovery = new InstanceDiscovery(conn, registry, HOME, "/run/user/1000");
    const result = await discovery.scan();

    expect(result.newInstances).toHaveLength(1);
    expect(result.unchangedSlugs).toHaveLength(0);
    expect(result.removedSlugs).toHaveLength(0);
  });

  it("identifies unchanged instances (already in registry)", async () => {
    const server = registry.getLocalServer()!;
    registry.createInstance({
      serverId: server.id,
      slug: "demo1",
      port: 18789,
      configPath: `${HOME}/.runtime-demo1/runtime.json`,
      stateDir: `${HOME}/.runtime-demo1`,
      systemdUnit: "claw-runtime-demo1",
    });

    conn.files.set(`${HOME}/.runtime-demo1/runtime.json`, makeConfig(18789));

    const discovery = new InstanceDiscovery(conn, registry, HOME, "/run/user/1000");
    const result = await discovery.scan();

    expect(result.newInstances).toHaveLength(0);
    expect(result.unchangedSlugs).toContain("demo1");
  });

  it("identifies removed instances", async () => {
    const server = registry.getLocalServer()!;
    registry.createInstance({
      serverId: server.id,
      slug: "ghost",
      port: 18789,
      configPath: `${HOME}/.runtime-ghost/runtime.json`,
      stateDir: `${HOME}/.runtime-ghost`,
      systemdUnit: "claw-runtime-ghost",
    });

    // No files on disk for "ghost"
    const discovery = new InstanceDiscovery(conn, registry, HOME, "/run/user/1000");
    const result = await discovery.scan();

    expect(result.removedSlugs).toContain("ghost");
  });
});

describe("InstanceDiscovery — adopt", () => {
  it("registers instance, agents, and port in registry", async () => {
    conn.files.set(
      `${HOME}/.runtime-demo1/runtime.json`,
      makeConfig(18789, [{ id: "pm", name: "PM" }]),
    );

    const server = registry.getLocalServer()!;
    const discovery = new InstanceDiscovery(conn, registry, HOME, "/run/user/1000");
    const result = await discovery.scan();

    await discovery.adopt(result.newInstances[0]!, server.id);

    const inst = registry.getInstance("demo1");
    expect(inst).toBeDefined();
    expect(inst?.discovered).toBe(1);
    expect(inst?.port).toBe(18789);

    const agents = registry.listAgents("demo1");
    expect(agents.length).toBeGreaterThanOrEqual(1);

    const ports = registry.getUsedPorts(server.id);
    expect(ports).toContain(18789);
  });

  it("logs a 'discovered' event after adopt", async () => {
    conn.files.set(`${HOME}/.runtime-demo1/runtime.json`, makeConfig(18789));

    const server = registry.getLocalServer()!;
    const discovery = new InstanceDiscovery(conn, registry, HOME, "/run/user/1000");
    const result = await discovery.scan();
    await discovery.adopt(result.newInstances[0]!, server.id);

    const events = registry.listEvents("demo1");
    expect(events.some((e) => e.event_type === "discovered")).toBe(true);
  });
});
