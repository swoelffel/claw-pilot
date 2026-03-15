// src/core/__tests__/health.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../registry.js";
import { HealthChecker } from "../health.js";
import { MockConnection } from "./mock-connection.js";
import { InstanceNotFoundError } from "../../lib/errors.js";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

let _mockPidMap: Map<string, number | null> = new Map();

vi.mock("../../lib/platform.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/platform.js")>();
  return {
    ...actual,
    getRuntimeStateDir: (slug: string) => `/home/test/.runtime-${slug}`,
    getRuntimePid: (stateDir: string) => _mockPidMap.get(stateDir) ?? null,
  };
});

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const XDG = "/run/user/1000";

let tmpDir: string;
let registry: Registry;
let db: ReturnType<typeof initDatabase>;
let conn: MockConnection;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-health-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  registry = new Registry(db);
  conn = new MockConnection();
  _mockPidMap = new Map();
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedInstance(
  opts: {
    slug?: string;
    port?: number;
    telegramBot?: string;
  } = {},
) {
  const slug = opts.slug ?? "demo1";
  const port = opts.port ?? 18790;
  const server = registry.upsertLocalServer("testhost", "/home/test");
  const stateDir = `/home/test/.runtime-${slug}`;

  const instance = registry.createInstance({
    serverId: server.id,
    slug,
    port,
    configPath: `${stateDir}/runtime.json`,
    stateDir,
    systemdUnit: `claw-runtime-${slug}`,
    ...(opts.telegramBot !== undefined && { telegramBot: opts.telegramBot }),
  });
  registry.allocatePort(server.id, port, slug);

  return { slug, port, stateDir, instance };
}

// ---------------------------------------------------------------------------
// HealthChecker.check()
// ---------------------------------------------------------------------------

describe("HealthChecker.check()", () => {
  it("throws InstanceNotFoundError for unknown slug", async () => {
    const checker = new HealthChecker(conn, registry, XDG);
    await expect(checker.check("nonexistent")).rejects.toThrow(InstanceNotFoundError);
  });

  it("returns state='running' when PID file exists and process is alive", async () => {
    const { slug } = seedInstance();
    _mockPidMap.set(`/home/test/.runtime-${slug}`, 12345);

    const checker = new HealthChecker(conn, registry, XDG);
    const status = await checker.check(slug);

    expect(status.state).toBe("running");
    expect(status.pid).toBe(12345);
  });

  it("returns state='stopped' when no PID file", async () => {
    const { slug } = seedInstance();
    // No PID set — defaults to null

    const checker = new HealthChecker(conn, registry, XDG);
    const status = await checker.check(slug);

    expect(status.state).toBe("stopped");
    expect(status.pid).toBeUndefined();
  });

  it("returns telegram='not_configured' when no telegram bot configured", async () => {
    const { slug } = seedInstance(); // no telegramBot

    const checker = new HealthChecker(conn, registry, XDG);
    const status = await checker.check(slug);

    expect(status.telegram).toBe("not_configured");
  });

  it("includes agentCount in status", async () => {
    const { slug } = seedInstance();
    const instance = registry.getInstance(slug)!;
    registry.createAgent(instance.id, {
      agentId: "main",
      name: "Main",
      workspacePath: "/tmp/ws",
      isDefault: true,
    });

    const checker = new HealthChecker(conn, registry, XDG);
    const status = await checker.check(slug);

    expect(status.agentCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// HealthChecker.checkAll()
// ---------------------------------------------------------------------------

describe("HealthChecker.checkAll()", () => {
  it("returns health status for all registered instances", async () => {
    seedInstance({ slug: "inst1", port: 18790 });
    seedInstance({ slug: "inst2", port: 18791 });
    seedInstance({ slug: "inst3", port: 18792 });

    const checker = new HealthChecker(conn, registry, XDG);
    const results = await checker.checkAll();

    expect(results).toHaveLength(3);
    const slugs = results.map((r) => r.slug).sort();
    expect(slugs).toEqual(["inst1", "inst2", "inst3"]);
  });
});
