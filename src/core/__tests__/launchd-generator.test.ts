// src/core/__tests__/launchd-generator.test.ts
import { describe, it, expect } from "vitest";
import { generateLaunchdPlist, generateDashboardLaunchdPlist } from "../launchd-generator.js";

const instanceOpts = {
  slug: "demo1",
  displayName: "Demo One",
  port: 18789,
  stateDir: "/Users/openclaw/.openclaw-demo1",
  configPath: "/Users/openclaw/.openclaw-demo1/openclaw.json",
  openclawBin: "/Users/openclaw/.npm-global/bin/openclaw",
  home: "/Users/openclaw",
};

describe("generateLaunchdPlist", () => {
  it("includes the correct label", () => {
    const plist = generateLaunchdPlist(instanceOpts);
    expect(plist).toContain("<string>ai.openclaw.demo1</string>");
  });

  it("includes the correct port", () => {
    const plist = generateLaunchdPlist(instanceOpts);
    expect(plist).toContain("<string>18789</string>");
  });

  it("includes the binary path", () => {
    const plist = generateLaunchdPlist(instanceOpts);
    expect(plist).toContain(instanceOpts.openclawBin);
  });

  it("includes OPENCLAW_PROFILE env var", () => {
    const plist = generateLaunchdPlist(instanceOpts);
    expect(plist).toContain("<key>OPENCLAW_PROFILE</key>");
    expect(plist).toContain("<string>demo1</string>");
  });

  it("includes OPENCLAW_STATE_DIR env var", () => {
    const plist = generateLaunchdPlist(instanceOpts);
    expect(plist).toContain("<key>OPENCLAW_STATE_DIR</key>");
    expect(plist).toContain(`<string>${instanceOpts.stateDir}</string>`);
  });

  it("includes OPENCLAW_CONFIG_PATH env var", () => {
    const plist = generateLaunchdPlist(instanceOpts);
    expect(plist).toContain("<key>OPENCLAW_CONFIG_PATH</key>");
    expect(plist).toContain(`<string>${instanceOpts.configPath}</string>`);
  });

  it("logs to stateDir/logs/gateway.log", () => {
    const plist = generateLaunchdPlist(instanceOpts);
    expect(plist).toContain(`${instanceOpts.stateDir}/logs/gateway.log`);
  });

  it("has RunAtLoad and KeepAlive set to true", () => {
    const plist = generateLaunchdPlist(instanceOpts);
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).toContain("<true/>");
  });

  it("is valid XML (starts with XML declaration)", () => {
    const plist = generateLaunchdPlist(instanceOpts);
    expect(plist.trim()).toMatch(/^<\?xml/);
  });

  it("matches full plist snapshot", () => {
    const plist = generateLaunchdPlist(instanceOpts);
    expect(plist).toMatchSnapshot();
  });
});

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
