// src/core/__tests__/lifecycle.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../registry.js";
import { Lifecycle } from "../lifecycle.js";
import { MockConnection } from "./mock-connection.js";
import { InstanceNotFoundError, GatewayUnhealthyError } from "../../lib/errors.js";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// These variables are declared before vi.mock() so they are accessible in the
// factory closures after vitest hoisting.
let _mockServiceManager: "systemd" | "launchd" = "systemd";
let _pollShouldSucceed = true;

vi.mock("../../lib/platform.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/platform.js")>();
  return {
    ...actual,
    getServiceManager: () => _mockServiceManager,
    getLaunchdPlistPath: (slug: string) => `/tmp/launchd/ai.openclaw.${slug}.plist`,
    // Always return false so tests are not affected by CLAW_PILOT_ENV=docker in the container
    isDocker: () => false,
  };
});

// Mock pollUntilReady to avoid the 30-second GATEWAY_READY_TIMEOUT in tests.
// When _pollShouldSucceed is true, runs check() once and resolves if it passes.
// When false, throws immediately (simulates timeout).
vi.mock("../../lib/poll.js", () => ({
  pollUntilReady: async (opts: {
    check: () => Promise<boolean>;
    timeoutMs: number;
    label?: string;
  }) => {
    if (_pollShouldSucceed) {
      // Run check once — if it passes, resolve immediately
      const ok = await opts.check().catch(() => false);
      if (ok) return;
    }
    throw new Error(
      `Timeout after ${opts.timeoutMs}ms${opts.label ? ` waiting for ${opts.label}` : ""}`,
    );
  },
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
  _pollShouldSucceed = true;

  // Default: fetch resolves OK (gateway healthy)
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

function seedInstance(opts: { slug?: string; port?: number } = {}) {
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

  it("calls systemctl start and updates state to 'running'", async () => {
    const { slug } = seedInstance();
    const lifecycle = new Lifecycle(conn, registry, XDG);

    await lifecycle.start(slug);

    const cmds = conn.commands.join("\n");
    expect(cmds).toContain(`systemctl --user start openclaw-${slug}.service`);
    expect(registry.getInstance(slug)?.state).toBe("running");
  });

  it("logs a 'started' event", async () => {
    const { slug } = seedInstance();
    const lifecycle = new Lifecycle(conn, registry, XDG);

    await lifecycle.start(slug);

    const events = registry.listEvents(slug, 10);
    expect(events.some((e) => e.event_type === "started")).toBe(true);
  });

  it("throws GatewayUnhealthyError when waitForHealth times out", async () => {
    // Gateway never responds — poll will fail immediately (mocked)
    global.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));
    _pollShouldSucceed = false;

    const { slug, stateDir } = seedInstance();
    // Seed a log file so readGatewayErrorDetail has something to read
    conn.files.set(`${stateDir}/logs/gateway.err.log`, "");

    const lifecycle = new Lifecycle(conn, registry, XDG);

    await expect(lifecycle.start(slug)).rejects.toThrow(GatewayUnhealthyError);
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

  it("calls systemctl stop and updates state to 'stopped'", async () => {
    const { slug } = seedInstance();
    const lifecycle = new Lifecycle(conn, registry, XDG);

    await lifecycle.stop(slug);

    const cmds = conn.commands.join("\n");
    expect(cmds).toContain(`systemctl --user stop openclaw-${slug}.service`);
    expect(registry.getInstance(slug)?.state).toBe("stopped");
  });

  it("logs a 'stopped' event", async () => {
    const { slug } = seedInstance();
    const lifecycle = new Lifecycle(conn, registry, XDG);

    await lifecycle.stop(slug);

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

  it("calls systemctl restart and updates state to 'running'", async () => {
    const { slug } = seedInstance();
    const lifecycle = new Lifecycle(conn, registry, XDG);

    await lifecycle.restart(slug);

    const cmds = conn.commands.join("\n");
    expect(cmds).toContain(`systemctl --user restart openclaw-${slug}.service`);
    expect(registry.getInstance(slug)?.state).toBe("running");
  });

  it("logs a 'restarted' event", async () => {
    const { slug } = seedInstance();
    const lifecycle = new Lifecycle(conn, registry, XDG);

    await lifecycle.restart(slug);

    const events = registry.listEvents(slug, 10);
    expect(events.some((e) => e.event_type === "restarted")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle.enable()
// ---------------------------------------------------------------------------

describe("Lifecycle.enable()", () => {
  it("calls systemctl enable for the instance unit", async () => {
    const { slug } = seedInstance();
    const lifecycle = new Lifecycle(conn, registry, XDG);

    await lifecycle.enable(slug);

    const cmds = conn.commands.join("\n");
    expect(cmds).toContain(`systemctl --user enable openclaw-${slug}.service`);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle.daemonReload()
// ---------------------------------------------------------------------------

describe("Lifecycle.daemonReload()", () => {
  it("calls systemctl daemon-reload", async () => {
    const lifecycle = new Lifecycle(conn, registry, XDG);

    await lifecycle.daemonReload();

    const cmds = conn.commands.join("\n");
    expect(cmds).toContain("systemctl --user daemon-reload");
  });
});

// ---------------------------------------------------------------------------
// Lifecycle — launchd (macOS)
// ---------------------------------------------------------------------------

describe("Lifecycle — launchd (macOS)", () => {
  beforeEach(() => {
    _mockServiceManager = "launchd";
  });

  it("start() calls launchctl load", async () => {
    const { slug } = seedInstance();
    const lifecycle = new Lifecycle(conn, registry, XDG);

    await lifecycle.start(slug);

    const cmds = conn.commands.join("\n");
    expect(cmds).toContain(`launchctl load -w /tmp/launchd/ai.openclaw.${slug}.plist`);
    expect(cmds).not.toContain("systemctl");
  });

  it("stop() calls launchctl unload", async () => {
    const { slug } = seedInstance();
    const lifecycle = new Lifecycle(conn, registry, XDG);

    await lifecycle.stop(slug);

    const cmds = conn.commands.join("\n");
    expect(cmds).toContain(`launchctl unload /tmp/launchd/ai.openclaw.${slug}.plist`);
    expect(cmds).not.toContain("systemctl");
  });

  it("enable() is a no-op on launchd", async () => {
    const { slug } = seedInstance();
    const lifecycle = new Lifecycle(conn, registry, XDG);

    await lifecycle.enable(slug);

    const cmds = conn.commands.join("\n");
    expect(cmds).not.toContain("systemctl");
    expect(cmds).not.toContain("launchctl");
  });

  it("daemonReload() is a no-op on launchd", async () => {
    const lifecycle = new Lifecycle(conn, registry, XDG);

    await lifecycle.daemonReload();

    expect(conn.commands).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle.readGatewayErrorDetail() — via start() failure
// ---------------------------------------------------------------------------

describe("Lifecycle — readGatewayErrorDetail via start() failure", () => {
  it("includes error detail from gateway.err.log in GatewayUnhealthyError", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));
    _pollShouldSucceed = false;

    const { slug, stateDir } = seedInstance();
    // Seed a log file with a known error pattern
    conn.files.set(
      `${stateDir}/logs/gateway.err.log`,
      "2024-01-01T00:00:00Z gateway start blocked by existing process\n",
    );

    const lifecycle = new Lifecycle(conn, registry, XDG);

    const err = await lifecycle.start(slug).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayUnhealthyError);
    expect((err as GatewayUnhealthyError).message).toContain("gateway start blocked");
  });
});
