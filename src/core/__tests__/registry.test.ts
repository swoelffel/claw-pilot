// src/core/__tests__/registry.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../registry.js";

let tmpDir: string;
let registry: Registry;
let db: ReturnType<typeof initDatabase>;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-test-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  registry = new Registry(db);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Registry — servers", () => {
  it("upserts local server", () => {
    const server = registry.upsertLocalServer("myhost", "/opt/openclaw");
    expect(server.hostname).toBe("myhost");
    expect(server.openclaw_home).toBe("/opt/openclaw");
  });

  it("updates existing server", () => {
    registry.upsertLocalServer("host1", "/opt/openclaw");
    registry.upsertLocalServer("host2", "/opt/openclaw2");
    const server = registry.getLocalServer();
    expect(server?.hostname).toBe("host2");
  });
});

describe("Registry — instances", () => {
  let serverId: number;

  beforeEach(() => {
    const server = registry.upsertLocalServer("testhost", "/opt/openclaw");
    serverId = server.id;
  });

  it("creates and retrieves an instance", () => {
    registry.createInstance({
      serverId,
      slug: "demo1",
      port: 18789,
      configPath: "/opt/openclaw/.openclaw-demo1/openclaw.json",
      stateDir: "/opt/openclaw/.openclaw-demo1",
      systemdUnit: "openclaw-demo1.service",
    });
    const inst = registry.getInstance("demo1");
    expect(inst?.slug).toBe("demo1");
    expect(inst?.port).toBe(18789);
  });

  it("lists instances ordered by port", () => {
    registry.createInstance({
      serverId,
      slug: "b",
      port: 18790,
      configPath: "/path/b.json",
      stateDir: "/path/b",
      systemdUnit: "openclaw-b.service",
    });
    registry.createInstance({
      serverId,
      slug: "a",
      port: 18789,
      configPath: "/path/a.json",
      stateDir: "/path/a",
      systemdUnit: "openclaw-a.service",
    });
    const instances = registry.listInstances();
    expect(instances[0]?.slug).toBe("a");
    expect(instances[1]?.slug).toBe("b");
  });

  it("updates instance state", () => {
    registry.createInstance({
      serverId,
      slug: "test",
      port: 18789,
      configPath: "/p.json",
      stateDir: "/p",
      systemdUnit: "openclaw-test.service",
    });
    registry.updateInstanceState("test", "running");
    expect(registry.getInstance("test")?.state).toBe("running");
  });

  it("deletes an instance", () => {
    registry.createInstance({
      serverId,
      slug: "tmp",
      port: 18789,
      configPath: "/p.json",
      stateDir: "/p",
      systemdUnit: "openclaw-tmp.service",
    });
    registry.deleteInstance("tmp");
    expect(registry.getInstance("tmp")).toBeUndefined();
  });

  it("discovered flag defaults to 0", () => {
    registry.createInstance({
      serverId,
      slug: "native",
      port: 18789,
      configPath: "/p.json",
      stateDir: "/p",
      systemdUnit: "openclaw-native.service",
    });
    expect(registry.getInstance("native")?.discovered).toBe(0);
  });

  it("sets discovered flag to 1 when adopted", () => {
    registry.createInstance({
      serverId,
      slug: "adopted",
      port: 18789,
      configPath: "/p.json",
      stateDir: "/p",
      systemdUnit: "openclaw-adopted.service",
      discovered: true,
    });
    expect(registry.getInstance("adopted")?.discovered).toBe(1);
  });
});

describe("Registry — ports", () => {
  it("allocates and releases ports", () => {
    const server = registry.upsertLocalServer("h", "/opt/openclaw");
    registry.allocatePort(server.id, 18789, "demo1");
    expect(registry.getUsedPorts(server.id)).toContain(18789);
    registry.releasePort(server.id, 18789);
    expect(registry.getUsedPorts(server.id)).not.toContain(18789);
  });
});

describe("Registry — events", () => {
  it("logs and retrieves events", () => {
    registry.logEvent("demo1", "started", "detail here");
    const events = registry.listEvents("demo1");
    expect(events[0]?.event_type).toBe("started");
    expect(events[0]?.detail).toBe("detail here");
  });
});
