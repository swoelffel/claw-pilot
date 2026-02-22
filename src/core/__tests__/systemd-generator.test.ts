// src/core/__tests__/systemd-generator.test.ts
import { describe, it, expect } from "vitest";
import { generateSystemdService } from "../systemd-generator.js";

const opts = {
  slug: "demo1",
  displayName: "Demo One",
  port: 18789,
  stateDir: "/opt/openclaw/.openclaw-demo1",
  configPath: "/opt/openclaw/.openclaw-demo1/openclaw.json",
  openclawHome: "/opt/openclaw",
  openclawBin: "/opt/openclaw/.npm-global/bin/openclaw",
};

describe("generateSystemdService", () => {
  it("includes critical env vars (OPENCLAW_PROFILE, STATE_DIR, CONFIG_PATH)", () => {
    const service = generateSystemdService(opts);
    expect(service).toContain("OPENCLAW_PROFILE=demo1");
    expect(service).toContain(`OPENCLAW_STATE_DIR=${opts.stateDir}`);
    expect(service).toContain(`OPENCLAW_CONFIG_PATH=${opts.configPath}`);
  });

  it("includes correct port", () => {
    const service = generateSystemdService(opts);
    expect(service).toContain("--port 18789");
    expect(service).toContain("OPENCLAW_GATEWAY_PORT=18789");
  });

  it("logs to stateDir/logs/gateway.log", () => {
    const service = generateSystemdService(opts);
    expect(service).toContain(
      `${opts.stateDir}/logs/gateway.log`,
    );
  });

  it("has WantedBy=default.target", () => {
    const service = generateSystemdService(opts);
    expect(service).toContain("WantedBy=default.target");
  });

  it("uses the provided binary path", () => {
    const service = generateSystemdService(opts);
    expect(service).toContain(opts.openclawBin);
  });
});
