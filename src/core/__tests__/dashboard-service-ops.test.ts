// src/core/__tests__/dashboard-service-ops.test.ts
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("../../lib/platform.js", () => ({
  getServiceManager: vi.fn(() => "systemd"),
  getSystemdSystemDir: vi.fn(() => "/etc/systemd/system"),
  getDashboardServicePath: vi.fn(() => "/etc/systemd/system/claw-pilot-dashboard.service"),
  DASHBOARD_SERVICE_UNIT: "claw-pilot-dashboard.service",
  getLaunchdDir: vi.fn(() => "/Users/test/Library/LaunchAgents"),
  getDashboardLaunchdPlistPath: vi.fn(
    () => "/Users/test/Library/LaunchAgents/io.claw-pilot.dashboard.plist",
  ),
  DASHBOARD_LAUNCHD_LABEL: "io.claw-pilot.dashboard",
}));

vi.mock("../systemd-generator.js", () => ({
  generateDashboardService: vi.fn(() => "[Unit]\nDescription=test\n"),
}));

vi.mock("../launchd-generator.js", () => ({
  generateDashboardLaunchdPlist: vi.fn(() => "<plist></plist>"),
}));

vi.mock("../../lib/poll.js", () => ({
  pollUntilReady: vi.fn().mockResolvedValue(undefined),
}));

// For resolveClawPilotBin which uses statSync
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return {
    ...original,
    statSync: vi.fn((p: string) => {
      if (typeof p === "string" && p.endsWith("index.mjs")) return {};
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }),
  };
});

// For isPortResponding which uses global fetch
vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok")));

import { MockConnection } from "./mock-connection.js";
import {
  installDashboardService,
  uninstallDashboardService,
  restartDashboardService,
  getDashboardServiceStatus,
} from "../dashboard-service.js";
import { getServiceManager } from "../../lib/platform.js";

let conn: MockConnection;

beforeEach(() => {
  conn = new MockConnection();
  vi.clearAllMocks();
  // Reset getServiceManager to systemd by default
  vi.mocked(getServiceManager).mockReturnValue("systemd");
  // Reset fetch stub
  vi.mocked(globalThis.fetch).mockResolvedValue(new Response("ok"));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// getDashboardServiceStatus
// ---------------------------------------------------------------------------

describe("getDashboardServiceStatus", () => {
  describe("systemd", () => {
    function setupSystemdActive(): void {
      conn.files.set("/etc/systemd/system/claw-pilot-dashboard.service", "content");
      conn.mockExec("is-active", { stdout: "active\n", stderr: "", exitCode: 0 });
      conn.mockExec("is-enabled", { stdout: "enabled\n", stderr: "", exitCode: 0 });
      conn.mockExec("--property=MainPID", {
        stdout: "MainPID=1234\n",
        stderr: "",
        exitCode: 0,
      });
      conn.mockExec("--property=ActiveEnterTimestamp", {
        stdout: "ActiveEnterTimestamp=Thu 2025-04-01 10:00:00 UTC\n",
        stderr: "",
        exitCode: 0,
      });
    }

    it("returns fully active status when installed, active, enabled and port responding", async () => {
      setupSystemdActive();

      const status = await getDashboardServiceStatus(conn, "/run/user/1000");

      expect(status.installed).toBe(true);
      expect(status.active).toBe(true);
      expect(status.enabled).toBe(true);
      expect(status.pid).toBe(1234);
      expect(status.uptime).toBe("Thu 2025-04-01 10:00:00 UTC");
      expect(status.portResponding).toBe(true);
    });

    it("returns installed false when service file does not exist", async () => {
      // Do NOT set the service file in conn.files
      const status = await getDashboardServiceStatus(conn, "/run/user/1000");

      expect(status.installed).toBe(false);
    });

    it("returns active false when is-active exits non-zero", async () => {
      conn.files.set("/etc/systemd/system/claw-pilot-dashboard.service", "content");
      conn.mockExec("is-active", { stdout: "inactive\n", stderr: "", exitCode: 3 });
      conn.mockExec("is-enabled", { stdout: "enabled\n", stderr: "", exitCode: 0 });

      const status = await getDashboardServiceStatus(conn, "/run/user/1000");

      expect(status.installed).toBe(true);
      expect(status.active).toBe(false);
      expect(status.enabled).toBe(true);
    });

    it("parses PID from MainPID property", async () => {
      conn.files.set("/etc/systemd/system/claw-pilot-dashboard.service", "content");
      conn.mockExec("--property=MainPID", {
        stdout: "MainPID=5678\n",
        stderr: "",
        exitCode: 0,
      });

      const status = await getDashboardServiceStatus(conn, "/run/user/1000");

      expect(status.pid).toBe(5678);
    });

    it("parses uptime from ActiveEnterTimestamp property", async () => {
      conn.files.set("/etc/systemd/system/claw-pilot-dashboard.service", "content");
      conn.mockExec("--property=ActiveEnterTimestamp", {
        stdout: "ActiveEnterTimestamp=Thu 2025-04-01 10:00:00 UTC\n",
        stderr: "",
        exitCode: 0,
      });

      const status = await getDashboardServiceStatus(conn, "/run/user/1000");

      expect(status.uptime).toBe("Thu 2025-04-01 10:00:00 UTC");
    });

    it("returns portResponding false when fetch rejects", async () => {
      conn.files.set("/etc/systemd/system/claw-pilot-dashboard.service", "content");
      vi.mocked(globalThis.fetch).mockRejectedValue(new Error("ECONNREFUSED"));

      const status = await getDashboardServiceStatus(conn, "/run/user/1000");

      expect(status.portResponding).toBe(false);
    });
  });

  describe("launchd", () => {
    it("returns installed and active when plist exists and launchctl list succeeds", async () => {
      vi.mocked(getServiceManager).mockReturnValue("launchd");
      conn.files.set("/Users/test/Library/LaunchAgents/io.claw-pilot.dashboard.plist", "content");

      const status = await getDashboardServiceStatus(conn, "/tmp/runtime");

      expect(status.installed).toBe(true);
      expect(status.active).toBe(true);
      expect(status.enabled).toBe(true);
      expect(status.portResponding).toBe(true);
    });

    it("returns installed false when plist does not exist", async () => {
      vi.mocked(getServiceManager).mockReturnValue("launchd");

      const status = await getDashboardServiceStatus(conn, "/tmp/runtime");

      expect(status.installed).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// installDashboardService
// ---------------------------------------------------------------------------

describe("installDashboardService", () => {
  describe("systemd", () => {
    it("writes service file, reloads daemon, enables and starts the service", async () => {
      conn.mockExec("which", { stdout: "/usr/bin/node\n", stderr: "", exitCode: 0 });

      await installDashboardService(conn, "/run/user/1000");

      // Service file was written
      expect(conn.files.has("/etc/systemd/system/claw-pilot-dashboard.service")).toBe(true);

      // Commands include daemon-reload, enable, start
      const cmds = conn.commands.join("\n");
      expect(cmds).toContain("daemon-reload");
      expect(cmds).toContain("enable");
      expect(cmds).toContain("start");
    });

    it("throws when node binary cannot be found", async () => {
      // which returns empty, no fallback candidates exist
      conn.mockExec("which", { stdout: "", stderr: "", exitCode: 1 });

      await expect(installDashboardService(conn, "/run/user/1000")).rejects.toThrow(
        /Cannot find node binary/,
      );
    });
  });

  describe("launchd", () => {
    it("writes plist and loads the launchd agent", async () => {
      vi.mocked(getServiceManager).mockReturnValue("launchd");
      conn.mockExec("which", { stdout: "/usr/bin/node\n", stderr: "", exitCode: 0 });

      await installDashboardService(conn, "/tmp/runtime");

      // Plist was written
      expect(conn.files.has("/Users/test/Library/LaunchAgents/io.claw-pilot.dashboard.plist")).toBe(
        true,
      );

      // launchctl load was called
      const cmds = conn.commands.join("\n");
      expect(cmds).toContain("launchctl load");
    });
  });
});

// ---------------------------------------------------------------------------
// uninstallDashboardService
// ---------------------------------------------------------------------------

describe("uninstallDashboardService", () => {
  it("systemd: stops, disables, removes service file and reloads daemon", async () => {
    conn.files.set("/etc/systemd/system/claw-pilot-dashboard.service", "content");

    await uninstallDashboardService(conn, "/run/user/1000");

    const cmds = conn.commands.join("\n");
    expect(cmds).toContain("stop");
    expect(cmds).toContain("disable");
    expect(cmds).toContain("daemon-reload");
    // Service file removed
    expect(conn.files.has("/etc/systemd/system/claw-pilot-dashboard.service")).toBe(false);
  });

  it("launchd: unloads agent and removes plist", async () => {
    vi.mocked(getServiceManager).mockReturnValue("launchd");
    conn.files.set("/Users/test/Library/LaunchAgents/io.claw-pilot.dashboard.plist", "content");

    await uninstallDashboardService(conn, "/tmp/runtime");

    const cmds = conn.commands.join("\n");
    expect(cmds).toContain("launchctl unload");
    expect(conn.files.has("/Users/test/Library/LaunchAgents/io.claw-pilot.dashboard.plist")).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// restartDashboardService
// ---------------------------------------------------------------------------

describe("restartDashboardService", () => {
  it("systemd: runs systemctl restart", async () => {
    await restartDashboardService(conn, "/run/user/1000");

    const cmds = conn.commands.join("\n");
    expect(cmds).toContain("systemctl restart");
  });

  it("launchd: unloads then loads the agent", async () => {
    vi.mocked(getServiceManager).mockReturnValue("launchd");

    await restartDashboardService(conn, "/tmp/runtime");

    const cmds = conn.commands.join("\n");
    expect(cmds).toContain("launchctl unload");
    expect(cmds).toContain("launchctl load");
  });
});
