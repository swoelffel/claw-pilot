// src/core/__tests__/platform-dashboard.test.ts
import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import { getDashboardServicePath, DASHBOARD_SERVICE_UNIT } from "../../lib/platform.js";

describe("getDashboardServicePath", () => {
  it("returns an absolute path ending with the service unit name", () => {
    const p = getDashboardServicePath();
    expect(path.isAbsolute(p)).toBe(true);
    expect(path.basename(p)).toBe(DASHBOARD_SERVICE_UNIT);
  });

  it("is under the user home directory in .config/systemd/user/", () => {
    const p = getDashboardServicePath();
    const relative = path.relative(os.homedir(), p);
    expect(relative.startsWith("..")).toBe(false); // under homedir
    expect(relative).toBe(path.join(".config", "systemd", "user", DASHBOARD_SERVICE_UNIT));
  });
});
