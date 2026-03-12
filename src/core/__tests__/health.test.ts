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

let _mockServiceManager: "systemd" | "launchd" = "systemd";

vi.mock("../../lib/platform.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/platform.js")>();
  return {
    ...actual,
    getServiceManager: () => _mockServiceManager,
    getLaunchdLabel: (slug: string) => `ai.openclaw.${slug}`,
    // Always return false so tests are not affected by CLAW_PILOT_ENV=docker in the container
    isDocker: () => false,
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
  _mockServiceManager = "systemd";

  // Default: systemd reports "active", gateway is healthy
  conn.mockExec("is-active", { stdout: "active\n", stderr: "", exitCode: 0 });
  global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);
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
  const server = registry.upsertLocalServer("testhost", "/opt/openclaw");
  const stateDir = `/home/openclaw/.openclaw-${slug}`;

  const instance = registry.createInstance({
    serverId: server.id,
    slug,
    port,
    configPath: `${stateDir}/openclaw.json`,
    stateDir,
    systemdUnit: `openclaw-${slug}.service`,
    ...(opts.telegramBot !== undefined && { telegramBot: opts.telegramBot }),
  });
  registry.allocatePort(server.id, port, slug);

  // Seed a minimal openclaw.json
  conn.files.set(
    `${stateDir}/openclaw.json`,
    JSON.stringify({
      gateway: { port },
      agents: { defaults: { model: "claude-3-5-sonnet-20241022" } },
    }),
  );

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

  it("returns state='running' when systemd active and gateway healthy", async () => {
    const { slug } = seedInstance();
    conn.mockExec("is-active", { stdout: "active\n", stderr: "", exitCode: 0 });
    global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);

    const checker = new HealthChecker(conn, registry, XDG);
    const status = await checker.check(slug);

    expect(status.state).toBe("running");
    expect(status.gateway).toBe("healthy");
    expect(status.systemd).toBe("active");
  });

  it("returns state='error' when systemd active but gateway unhealthy", async () => {
    const { slug } = seedInstance();
    conn.mockExec("is-active", { stdout: "active\n", stderr: "", exitCode: 0 });
    global.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

    const checker = new HealthChecker(conn, registry, XDG);
    const status = await checker.check(slug);

    expect(status.state).toBe("error");
    expect(status.gateway).toBe("unhealthy");
    expect(status.systemd).toBe("active");
  });

  it("returns state='stopped' when systemd inactive and gateway unhealthy", async () => {
    const { slug } = seedInstance();
    conn.mockExec("is-active", { stdout: "inactive\n", stderr: "", exitCode: 0 });
    global.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

    const checker = new HealthChecker(conn, registry, XDG);
    const status = await checker.check(slug);

    expect(status.state).toBe("stopped");
    expect(status.systemd).toBe("inactive");
  });

  it("returns state='stopped' when systemd failed (treated as stopped)", async () => {
    const { slug } = seedInstance();
    conn.mockExec("is-active", { stdout: "failed\n", stderr: "", exitCode: 0 });
    global.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

    const checker = new HealthChecker(conn, registry, XDG);
    const status = await checker.check(slug);

    // "failed" systemd state + unhealthy gateway → state = "stopped" (not "error")
    expect(status.state).toBe("stopped");
    expect(status.systemd).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// HealthChecker.check() — Telegram status
// ---------------------------------------------------------------------------

describe("HealthChecker.check() — Telegram", () => {
  it("returns telegram='connected' when log contains 'Telegram: ok'", async () => {
    const { slug } = seedInstance({ telegramBot: "@testbot" });
    // Mock the tail | grep command to return count > 0
    conn.mockExec("grep -c", { stdout: "1\n", stderr: "", exitCode: 0 });

    const checker = new HealthChecker(conn, registry, XDG);
    const status = await checker.check(slug);

    expect(status.telegram).toBe("connected");
  });

  it("returns telegram='disconnected' when log does not contain 'Telegram: ok'", async () => {
    const { slug } = seedInstance({ telegramBot: "@testbot" });
    // Mock the tail | grep command to return count = 0
    conn.mockExec("grep -c", { stdout: "0\n", stderr: "", exitCode: 0 });

    const checker = new HealthChecker(conn, registry, XDG);
    const status = await checker.check(slug);

    expect(status.telegram).toBe("disconnected");
  });

  it("returns telegram='not_configured' when no telegram bot configured", async () => {
    const { slug } = seedInstance(); // no telegramBot

    const checker = new HealthChecker(conn, registry, XDG);
    const status = await checker.check(slug);

    expect(status.telegram).toBe("not_configured");
  });
});

// ---------------------------------------------------------------------------
// HealthChecker.check() — Pending devices
// ---------------------------------------------------------------------------

describe("HealthChecker.check() — Pending devices", () => {
  it("returns pendingDevices=2 when pending.json has 2 entries", async () => {
    const { slug, stateDir } = seedInstance();
    conn.files.set(
      `${stateDir}/devices/pending.json`,
      JSON.stringify([{ id: "req1" }, { id: "req2" }]),
    );

    const checker = new HealthChecker(conn, registry, XDG);
    const status = await checker.check(slug);

    expect(status.pendingDevices).toBe(2);
  });

  it("returns pendingDevices=0 when pending.json is absent (best-effort)", async () => {
    const { slug } = seedInstance();
    // No pending.json seeded

    const checker = new HealthChecker(conn, registry, XDG);
    const status = await checker.check(slug);

    expect(status.pendingDevices).toBe(0);
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
