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

// Mock platform.js — getRuntimePid returns null by default (no running process)
let _mockPid: number | null = null;
let _mockRunning = false;

vi.mock("../../lib/platform.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/platform.js")>();
  return {
    ...actual,
    getRuntimeStateDir: (slug: string) => `/home/test/.claw-pilot/instances/${slug}`,
    getRuntimePid: () => _mockPid,
    getRuntimePidPath: (stateDir: string) => `${stateDir}/runtime.pid`,
    isRuntimeRunning: () => _mockRunning,
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
  _mockPid = null;
  _mockRunning = false;
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Create a minimal claw-runtime instance in the registry and seed the mock filesystem */
function seedInstance(opts: { slug?: string } = {}) {
  const slug = opts.slug ?? "demo1";
  const server = registry.upsertLocalServer("testhost", "/home/test/.claw-pilot/instances");
  const stateDir = `/home/test/.claw-pilot/instances/${slug}`;

  // Seed files in mock connection
  conn.files.set(`${stateDir}/runtime.json`, "{}");
  conn.files.set(`${stateDir}/.env`, "KEY=val");

  const instance = registry.createInstance({
    serverId: server.id,
    slug,
    port: 18790,
    configPath: `${stateDir}/runtime.json`,
    stateDir,
    systemdUnit: `claw-runtime-${slug}`,
  });
  registry.allocatePort(server.id, 18790, slug);
  registry.createAgent(instance.id, {
    agentId: "main",
    name: "Main",
    workspacePath: `${stateDir}/workspaces/workspace`,
    isDefault: true,
  });

  return { slug, stateDir, instance };
}

describe("Destroyer.destroy()", () => {
  it("throws InstanceNotFoundError for unknown slug", async () => {
    const destroyer = new Destroyer(conn, registry, XDG);
    await expect(destroyer.destroy("nonexistent")).rejects.toThrow(InstanceNotFoundError);
  });

  it("removes the state directory recursively", async () => {
    const { slug, stateDir } = seedInstance();
    expect(conn.files.has(`${stateDir}/runtime.json`)).toBe(true);

    const destroyer = new Destroyer(conn, registry, XDG);
    await destroyer.destroy(slug);

    expect(conn.files.has(`${stateDir}/runtime.json`)).toBe(false);
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
