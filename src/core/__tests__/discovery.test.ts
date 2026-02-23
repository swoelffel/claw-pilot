// src/core/__tests__/discovery.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../registry.js";
import { InstanceDiscovery } from "../discovery.js";
import { MockConnection } from "./mock-connection.js";

let tmpDir: string;
let registry: Registry;
let db: ReturnType<typeof initDatabase>;
let conn: MockConnection;
const HOME = "/opt/openclaw";

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-disc-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  registry = new Registry(db);
  registry.upsertLocalServer("testhost", HOME);
  conn = new MockConnection();

  // Mock systemctl as inactive by default
  conn.mockExec("systemctl --user is-active", {
    stdout: "inactive",
    stderr: "",
    exitCode: 0,
  });
  conn.mockExec("systemctl --user list-units", {
    stdout: "",
    stderr: "",
    exitCode: 0,
  });
  conn.mockExec("nginx", { stdout: "", stderr: "", exitCode: 0 });
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// Suppress fetch for tests (no real HTTP)
vi.stubGlobal("fetch", async () => {
  throw new Error("Network not available in tests");
});

function makeConfig(port: number, agents?: Array<{ id: string; name: string }>): string {
  return JSON.stringify({
    meta: { slug: "test" },
    gateway: { port },
    agents: {
      defaults: { model: "anthropic/claude-sonnet-4-6" },
      list: agents ?? [],
    },
  });
}

describe("InstanceDiscovery — directory scan", () => {
  it("discovers instance from directory", async () => {
    const stateDir = `${HOME}/.openclaw-demo1`;
    const configPath = `${stateDir}/openclaw.json`;
    conn.files.set(configPath, makeConfig(18789));

    const discovery = new InstanceDiscovery(conn, registry, HOME, "/run/user/1000");
    const result = await discovery.scan();

    expect(result.instances).toHaveLength(1);
    expect(result.instances[0]?.slug).toBe("demo1");
    expect(result.instances[0]?.port).toBe(18789);
    expect(result.instances[0]?.source).toBe("directory");
  });

  it("skips directories without openclaw.json", async () => {
    conn.dirs.add(`${HOME}/.openclaw-empty`);

    const discovery = new InstanceDiscovery(conn, registry, HOME, "/run/user/1000");
    const result = await discovery.scan();
    expect(result.instances).toHaveLength(0);
  });

  it("skips malformed openclaw.json", async () => {
    conn.files.set(`${HOME}/.openclaw-bad/openclaw.json`, "not json {{{");

    const discovery = new InstanceDiscovery(conn, registry, HOME, "/run/user/1000");
    const result = await discovery.scan();
    expect(result.instances).toHaveLength(0);
  });

  it("skips config without port", async () => {
    conn.files.set(
      `${HOME}/.openclaw-nport/openclaw.json`,
      JSON.stringify({ gateway: {} }),
    );

    const discovery = new InstanceDiscovery(conn, registry, HOME, "/run/user/1000");
    const result = await discovery.scan();
    expect(result.instances).toHaveLength(0);
  });

  it("discovers agents list from config", async () => {
    conn.files.set(
      `${HOME}/.openclaw-demo1/openclaw.json`,
      makeConfig(18789, [{ id: "pm", name: "Project Manager" }]),
    );

    const discovery = new InstanceDiscovery(conn, registry, HOME, "/run/user/1000");
    const result = await discovery.scan();
    expect(result.instances[0]?.agents).toHaveLength(2); // main + pm
    expect(result.instances[0]?.agents[1]?.id).toBe("pm");
  });
});

describe("InstanceDiscovery — legacy scan", () => {
  it("discovers legacy .openclaw directory", async () => {
    conn.files.set(`${HOME}/.openclaw/openclaw.json`, makeConfig(18789));

    const discovery = new InstanceDiscovery(conn, registry, HOME, "/run/user/1000");
    const result = await discovery.scan();

    expect(result.instances).toHaveLength(1);
    expect(result.instances[0]?.slug).toBe("default");
    expect(result.instances[0]?.source).toBe("legacy");
  });
});

describe("InstanceDiscovery — reconciliation", () => {
  it("identifies new instances", async () => {
    conn.files.set(`${HOME}/.openclaw-demo1/openclaw.json`, makeConfig(18789));

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
      configPath: `${HOME}/.openclaw-demo1/openclaw.json`,
      stateDir: `${HOME}/.openclaw-demo1`,
      systemdUnit: "openclaw-demo1.service",
    });

    conn.files.set(`${HOME}/.openclaw-demo1/openclaw.json`, makeConfig(18789));

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
      configPath: `${HOME}/.openclaw-ghost/openclaw.json`,
      stateDir: `${HOME}/.openclaw-ghost`,
      systemdUnit: "openclaw-ghost.service",
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
      `${HOME}/.openclaw-demo1/openclaw.json`,
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
    expect(agents).toHaveLength(2); // main + pm

    const ports = registry.getUsedPorts(server.id);
    expect(ports).toContain(18789);
  });

  it("logs a 'discovered' event after adopt", async () => {
    conn.files.set(
      `${HOME}/.openclaw-demo1/openclaw.json`,
      makeConfig(18789),
    );

    const server = registry.getLocalServer()!;
    const discovery = new InstanceDiscovery(conn, registry, HOME, "/run/user/1000");
    const result = await discovery.scan();
    await discovery.adopt(result.newInstances[0]!, server.id);

    const events = registry.listEvents("demo1");
    expect(events.some((e) => e.event_type === "discovered")).toBe(true);
  });
});
