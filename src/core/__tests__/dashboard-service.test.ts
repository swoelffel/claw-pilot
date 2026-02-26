// src/core/__tests__/dashboard-service.test.ts
import { describe, it, expect } from "vitest";
import { generateDashboardService } from "../systemd-generator.js";

const opts = {
  nodeBin: "/usr/local/bin/node",
  clawPilotBin: "/opt/claw-pilot/dist/index.mjs",
  port: 19000,
  home: "/home/openclaw",
  uid: 1000,
};

describe("generateDashboardService", () => {
  it("uses absolute node binary path in ExecStart", () => {
    const service = generateDashboardService(opts);
    expect(service).toContain("ExecStart=/usr/local/bin/node /opt/claw-pilot/dist/index.mjs dashboard --port 19000");
  });

  it("sets XDG_RUNTIME_DIR based on uid", () => {
    const service = generateDashboardService(opts);
    expect(service).toContain("XDG_RUNTIME_DIR=/run/user/1000");
  });

  it("sets HOME to user home dir", () => {
    const service = generateDashboardService(opts);
    expect(service).toContain("Environment=HOME=/home/openclaw");
  });

  it("has Restart=always", () => {
    const service = generateDashboardService(opts);
    expect(service).toContain("Restart=always");
  });

  it("has WantedBy=default.target", () => {
    const service = generateDashboardService(opts);
    expect(service).toContain("WantedBy=default.target");
  });

  it("uses journal for output (not file)", () => {
    const service = generateDashboardService(opts);
    expect(service).toContain("StandardOutput=journal");
    expect(service).toContain("StandardError=journal");
  });

  it("computes correct XDG_RUNTIME_DIR for different UIDs", () => {
    const service = generateDashboardService({ ...opts, uid: 996 });
    expect(service).toContain("XDG_RUNTIME_DIR=/run/user/996");
  });

  it("uses the correct port in ExecStart", () => {
    const service = generateDashboardService({ ...opts, port: 19001 });
    expect(service).toContain("--port 19001");
  });
});
