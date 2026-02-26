// src/core/__tests__/discovery.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../registry.js";
import { InstanceDiscovery } from "../discovery.js";
import { MockConnection } from "./mock-connection.js";
import { getLaunchdPlistPath } from "../../lib/platform.js";

// Allow tests to control the service manager returned by getServiceManager()
let _mockServiceManager: "systemd" | "launchd" | null = null;

vi.mock("../../lib/platform.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/platform.js")>();
  return {
    ...actual,
    getServiceManager: () => _mockServiceManager ?? actual.getServiceManager(),
  };
});

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
  // Default to systemd for Linux tests (platform-independent test execution)
  _mockServiceManager = "systemd";

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
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  _mockServiceManager = null;
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

describe("InstanceDiscovery — macOS (launchd)", () => {
  beforeEach(() => {
    _mockServiceManager = "launchd";
  });

  afterEach(() => {
    _mockServiceManager = null;
  });

  it("scanSystemdUnits is a no-op on macOS (no systemctl calls)", async () => {
    // Seed a valid instance directory
    conn.files.set(`${HOME}/.openclaw-demo1/openclaw.json`, makeConfig(18789));

    const discovery = new InstanceDiscovery(conn, registry, HOME, "");
    await discovery.scan();

    const cmds = conn.commands.join("\n");
    expect(cmds).not.toContain("systemctl --user list-units");
  });

  it("scanLaunchdAgents finds instances from plist files", async () => {
    const slug = "demo-mac";
    const stateDir = `${HOME}/.openclaw-${slug}`;
    const configPath = `${stateDir}/openclaw.json`;
    const plistPath = getLaunchdPlistPath(slug);

    // Seed the config and plist
    conn.files.set(configPath, makeConfig(18790));
    conn.files.set(
      plistPath,
      `<?xml version="1.0"?><plist><dict>
        <key>OPENCLAW_STATE_DIR</key><string>${stateDir}</string>
      </dict></plist>`,
    );

    // Mock launchctl list to return active
    conn.mockExec(`launchctl list ai.openclaw.${slug}`, {
      stdout: `{ "PID" = 1234; "Label" = "ai.openclaw.${slug}"; }`,
      stderr: "",
      exitCode: 0,
    });

    const discovery = new InstanceDiscovery(conn, registry, HOME, "");
    const result = await discovery.scan();

    // Should find the instance (either from directory scan or launchd scan)
    expect(result.instances.length).toBeGreaterThan(0);
    const found = result.instances.find((i) => i.slug === slug);
    expect(found).toBeDefined();
  });

  it("uses launchctl list instead of systemctl is-active in parseInstance (active)", async () => {
    const slug = "demo-mac2";
    const stateDir = `${HOME}/.openclaw-${slug}`;
    const configPath = `${stateDir}/openclaw.json`;

    conn.files.set(configPath, makeConfig(18791));

    // Mock launchctl list to return active (exit 0)
    conn.mockExec(`launchctl list ai.openclaw.${slug}`, {
      stdout: `{ "PID" = 5678; "Label" = "ai.openclaw.${slug}"; }`,
      stderr: "",
      exitCode: 0,
    });

    const discovery = new InstanceDiscovery(conn, registry, HOME, "");
    const result = await discovery.scan();

    const found = result.instances.find((i) => i.slug === slug);
    expect(found).toBeDefined();
    // systemdUnit should be the launchd label
    expect(found?.systemdUnit).toBe(`ai.openclaw.${slug}`);
    // systemdState should be active
    expect(found?.systemdState).toBe("active");
  });
});
