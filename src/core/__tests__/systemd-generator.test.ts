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

  it("matches full dashboard service snapshot", () => {
    const service = generateDashboardService(dashOpts);
    expect(service).toMatchSnapshot();
  });
});
