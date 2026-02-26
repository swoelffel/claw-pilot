// src/core/__tests__/destroyer.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../registry.js";
import { Destroyer } from "../destroyer.js";
import { MockConnection } from "./mock-connection.js";
import { InstanceNotFoundError } from "../../lib/errors.js";
import { getSystemdDir, getLaunchdPlistPath } from "../../lib/platform.js";

// Allow tests to control the service manager returned by getServiceManager()
let _mockServiceManager: "systemd" | "launchd" | null = null;

vi.mock("../../lib/platform.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/platform.js")>();
  return {
    ...actual,
    getServiceManager: () => _mockServiceManager ?? actual.getServiceManager(),
  };
});

const XDG = "/run/user/1000";

let tmpDir: string;
let registry: Registry;
let db: ReturnType<typeof initDatabase>;
let conn: MockConnection;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-dest-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  registry = new Registry(db);
  conn = new MockConnection();
  // Default to systemd for Linux tests (platform-independent test execution)
  _mockServiceManager = "systemd";
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  _mockServiceManager = null;
});

/** Create a minimal instance in the registry and seed the mock filesystem */
function seedInstance(opts: { slug?: string } = {}) {
  const slug = opts.slug ?? "demo1";
  const server = registry.upsertLocalServer("testhost", "/opt/openclaw");
  const stateDir = `/home/openclaw/.openclaw-${slug}`;
  // Destroyer uses getSystemdDir() from platform.ts — seed at the same path
  const serviceFile = path.join(getSystemdDir(), `openclaw-${slug}.service`);

  // Seed files in mock connection
  conn.files.set(serviceFile, "[Unit]\nDescription=test");
  conn.files.set(`${stateDir}/openclaw.json`, "{}");
  conn.files.set(`${stateDir}/.env`, "KEY=val");

  const instance = registry.createInstance({
    serverId: server.id,
    slug,
    port: 18790,
    configPath: `${stateDir}/openclaw.json`,
    stateDir,
    systemdUnit: `openclaw-${slug}.service`,
  });
  registry.allocatePort(server.id, 18790, slug);
  registry.createAgent(instance.id, {
    agentId: "main",
    name: "Main",
    workspacePath: `${stateDir}/workspaces/workspace`,
    isDefault: true,
  });

  return { slug, stateDir, serviceFile, instance };
}

describe("Destroyer.destroy()", () => {
  it("throws InstanceNotFoundError for unknown slug", async () => {
    const destroyer = new Destroyer(conn, registry, XDG);
    await expect(destroyer.destroy("nonexistent")).rejects.toThrow(
      InstanceNotFoundError,
    );
  });

  it("issues stop, disable, daemon-reload systemctl commands", async () => {
    const { slug } = seedInstance();
    const destroyer = new Destroyer(conn, registry, XDG);
    await destroyer.destroy(slug);

    const cmds = conn.commands.join("\n");
    expect(cmds).toContain(`systemctl --user stop openclaw-${slug}.service`);
    expect(cmds).toContain(`systemctl --user disable openclaw-${slug}.service`);
    expect(cmds).toContain("systemctl --user daemon-reload");
  });

  it("uses the provided XDG_RUNTIME_DIR in systemctl commands", async () => {
    const { slug } = seedInstance();
    const destroyer = new Destroyer(conn, registry, "/run/user/1234");
    await destroyer.destroy(slug);

    const cmds = conn.commands.join("\n");
    expect(cmds).toContain("XDG_RUNTIME_DIR=/run/user/1234");
  });

  it("removes the systemd service file", async () => {
    const { slug, serviceFile } = seedInstance();
    expect(conn.files.has(serviceFile)).toBe(true);

    const destroyer = new Destroyer(conn, registry, XDG);
    await destroyer.destroy(slug);

    expect(conn.files.has(serviceFile)).toBe(false);
  });

  it("removes the state directory recursively", async () => {
    const { slug, stateDir } = seedInstance();
    expect(conn.files.has(`${stateDir}/openclaw.json`)).toBe(true);

    const destroyer = new Destroyer(conn, registry, XDG);
    await destroyer.destroy(slug);

    expect(conn.files.has(`${stateDir}/openclaw.json`)).toBe(false);
    expect(conn.files.has(`${stateDir}/.env`)).toBe(false);
  });

  it("releases the port in the registry", async () => {
    const { slug } = seedInstance();
    const server = registry.getLocalServer()!;
    expect(registry.getUsedPorts(server.id)).toContain(18790);

    const destroyer = new Destroyer(conn, registry, XDG);
    await destroyer.destroy(slug);

    expect(registry.getUsedPorts(server.id)).not.toContain(18790);
  });

  it("deletes agents from the registry", async () => {
    const { slug } = seedInstance();
    expect(registry.listAgents(slug)).toHaveLength(1);

    const destroyer = new Destroyer(conn, registry, XDG);
    await destroyer.destroy(slug);

    expect(registry.listAgents(slug)).toHaveLength(0);
  });

  it("deletes the instance from the registry", async () => {
    const { slug } = seedInstance();
    expect(registry.getInstance(slug)).toBeDefined();

    const destroyer = new Destroyer(conn, registry, XDG);
    await destroyer.destroy(slug);

    expect(registry.getInstance(slug)).toBeUndefined();
  });

  it("logs a 'destroyed' event", async () => {
    const { slug } = seedInstance();
    const destroyer = new Destroyer(conn, registry, XDG);
    await destroyer.destroy(slug);

    const events = registry.listEvents(slug, 10);
    expect(events.some((e) => e.event_type === "destroyed")).toBe(true);
  });

  it("is idempotent: second destroy throws InstanceNotFoundError", async () => {
    const { slug } = seedInstance();
    const destroyer = new Destroyer(conn, registry, XDG);
    await destroyer.destroy(slug);
    await expect(destroyer.destroy(slug)).rejects.toThrow(InstanceNotFoundError);
  });
});

describe("Destroyer.destroy() — macOS (launchd)", () => {
  beforeEach(() => {
    _mockServiceManager = "launchd";
  });

  afterEach(() => {
    _mockServiceManager = null;
  });

  function seedLaunchdInstance(opts: { slug?: string } = {}) {
    const slug = opts.slug ?? "demo-mac";
    const server = registry.upsertLocalServer("mac-host", "/Users/test");
    const stateDir = `/Users/test/.openclaw-${slug}`;
    const plistPath = getLaunchdPlistPath(slug);

    // Seed plist and state files in mock connection
    conn.files.set(plistPath, `<plist><dict><key>Label</key><string>ai.openclaw.${slug}</string></dict></plist>`);
    conn.files.set(`${stateDir}/openclaw.json`, "{}");
    conn.files.set(`${stateDir}/.env`, "KEY=val");

    const instance = registry.createInstance({
      serverId: server.id,
      slug,
      port: 18791,
      configPath: `${stateDir}/openclaw.json`,
      stateDir,
      systemdUnit: `ai.openclaw.${slug}`,
    });
    registry.allocatePort(server.id, 18791, slug);
    registry.createAgent(instance.id, {
      agentId: "main",
      name: "Main",
      workspacePath: `${stateDir}/workspaces/workspace`,
      isDefault: true,
    });

    return { slug, stateDir, plistPath, instance };
  }

  it("calls launchctl unload for the plist", async () => {
    const { slug, plistPath } = seedLaunchdInstance();
    const destroyer = new Destroyer(conn, registry, XDG);
    await destroyer.destroy(slug);

    const cmds = conn.commands.join("\n");
    expect(cmds).toContain(`launchctl unload ${plistPath}`);
  });

  it("removes the launchd plist file", async () => {
    const { slug, plistPath } = seedLaunchdInstance();
    expect(conn.files.has(plistPath)).toBe(true);

    const destroyer = new Destroyer(conn, registry, XDG);
    await destroyer.destroy(slug);

    expect(conn.files.has(plistPath)).toBe(false);
  });

  it("does NOT call systemctl on macOS", async () => {
    const { slug } = seedLaunchdInstance();
    const destroyer = new Destroyer(conn, registry, XDG);
    await destroyer.destroy(slug);

    const cmds = conn.commands.join("\n");
    expect(cmds).not.toContain("systemctl");
  });

  it("removes the state directory recursively", async () => {
    const { slug, stateDir } = seedLaunchdInstance();
    expect(conn.files.has(`${stateDir}/openclaw.json`)).toBe(true);

    const destroyer = new Destroyer(conn, registry, XDG);
    await destroyer.destroy(slug);

    expect(conn.files.has(`${stateDir}/openclaw.json`)).toBe(false);
  });

  it("deletes the instance from the registry", async () => {
    const { slug } = seedLaunchdInstance();
    expect(registry.getInstance(slug)).toBeDefined();

    const destroyer = new Destroyer(conn, registry, XDG);
    await destroyer.destroy(slug);

    expect(registry.getInstance(slug)).toBeUndefined();
  });
});
