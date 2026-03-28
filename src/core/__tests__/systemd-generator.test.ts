// src/core/__tests__/systemd-generator.test.ts
import { describe, it, expect } from "vitest";
import { generateDashboardService } from "../systemd-generator.js";

describe("generateDashboardService", () => {
  const dashOpts = {
    nodeBin: "/usr/local/bin/node",
    clawPilotBin: "/opt/claw-pilot/dist/index.mjs",
    port: 19000,
    home: "/home/openclaw",
    uid: 1000,
  };

  it("includes correct port and binary paths", () => {
    const service = generateDashboardService(dashOpts);
    expect(service).toContain("--port 19000");
    expect(service).toContain(dashOpts.nodeBin);
    expect(service).toContain(dashOpts.clawPilotBin);
  });

  it("sets XDG_RUNTIME_DIR based on uid", () => {
    const service = generateDashboardService(dashOpts);
    expect(service).toContain("XDG_RUNTIME_DIR=/run/user/1000");
  });

  it("generates a valid systemd unit file structure", () => {
    const service = generateDashboardService(dashOpts);
    // Must have required sections
    expect(service).toMatch(/^\[Unit\]/m);
    expect(service).toMatch(/^\[Service\]/m);
    expect(service).toMatch(/^\[Install\]/m);
    // ExecStart must be a single line with node + claw-pilot + --port
    const execMatch = service.match(/^ExecStart=(.+)$/m);
    expect(execMatch).not.toBeNull();
    expect(execMatch![1]).toContain(dashOpts.nodeBin);
    expect(execMatch![1]).toContain(dashOpts.clawPilotBin);
    expect(execMatch![1]).toContain("--port 19000");
    // Environment lines for HOME and XDG_RUNTIME_DIR
    expect(service).toMatch(/^Environment=HOME=/m);
    expect(service).toMatch(/^Environment=XDG_RUNTIME_DIR=/m);
    // Restart policy
    expect(service).toMatch(/^Restart=always$/m);
    // Install target
    expect(service).toMatch(/^WantedBy=default\.target$/m);
  });
});
