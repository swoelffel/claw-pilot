// src/core/__tests__/launchd-generator.test.ts
import { describe, it, expect } from "vitest";
import { generateDashboardLaunchdPlist } from "../launchd-generator.js";

describe("generateDashboardLaunchdPlist", () => {
  const dashOpts = {
    nodeBin: "/usr/local/bin/node",
    clawPilotBin: "/opt/claw-pilot/dist/index.mjs",
    port: 19000,
    home: "/Users/openclaw",
  };

  it("includes the correct label", () => {
    const plist = generateDashboardLaunchdPlist(dashOpts);
    expect(plist).toContain("<string>io.claw-pilot.dashboard</string>");
  });

  it("includes the correct port", () => {
    const plist = generateDashboardLaunchdPlist(dashOpts);
    expect(plist).toContain("<string>19000</string>");
  });

  it("includes node binary and claw-pilot binary", () => {
    const plist = generateDashboardLaunchdPlist(dashOpts);
    expect(plist).toContain(dashOpts.nodeBin);
    expect(plist).toContain(dashOpts.clawPilotBin);
  });

  it("logs to ~/.claw-pilot/dashboard.log", () => {
    const plist = generateDashboardLaunchdPlist(dashOpts);
    expect(plist).toContain(`${dashOpts.home}/.claw-pilot/dashboard.log`);
  });

  it("matches full dashboard plist snapshot", () => {
    const plist = generateDashboardLaunchdPlist(dashOpts);
    expect(plist).toMatchSnapshot();
  });
});
