// src/core/__tests__/platform-dashboard.test.ts
import { describe, it, expect } from "vitest";
import * as os from "node:os";
import { getDashboardServicePath, DASHBOARD_SERVICE_UNIT } from "../../lib/platform.js";

describe("getDashboardServicePath", () => {
  it("returns path under ~/.config/systemd/user/", () => {
    const p = getDashboardServicePath();
    expect(p).toContain(".config/systemd/user");
    expect(p).toContain("claw-pilot-dashboard.service");
  });

  it("is under the user home directory", () => {
    const p = getDashboardServicePath();
    expect(p.startsWith(os.homedir())).toBe(true);
  });

  it("DASHBOARD_SERVICE_UNIT is correct", () => {
    expect(DASHBOARD_SERVICE_UNIT).toBe("claw-pilot-dashboard.service");
  });
});
