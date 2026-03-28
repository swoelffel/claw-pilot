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

  it("generates well-formed XML plist with correct structure", () => {
    const plist = generateDashboardLaunchdPlist(dashOpts);
    // Must start with XML declaration and plist DTD
    expect(plist).toMatch(/^<\?xml version="1\.0"/);
    expect(plist).toContain("<!DOCTYPE plist");
    // Must have balanced plist root
    expect(plist).toContain("<plist");
    expect(plist).toContain("</plist>");
    // Must have a Label key
    const labelIdx = plist.indexOf("<key>Label</key>");
    expect(labelIdx).toBeGreaterThan(-1);
    // ProgramArguments must contain both node and claw-pilot binaries + port
    const progIdx = plist.indexOf("<key>ProgramArguments</key>");
    expect(progIdx).toBeGreaterThan(-1);
    const arraySection = plist.slice(progIdx, plist.indexOf("</array>", progIdx));
    expect(arraySection).toContain(dashOpts.nodeBin);
    expect(arraySection).toContain(dashOpts.clawPilotBin);
    expect(arraySection).toContain("19000");
  });
});
