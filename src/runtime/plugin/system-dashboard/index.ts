// src/runtime/plugin/system-dashboard/index.ts
//
// Plugin that provides dashboard CRUD tools to the system-pilot agent.
// Only activates when CLAW_DASHBOARD_URL and CLAW_DASHBOARD_TOKEN are set.

import type { Plugin } from "../types.js";
import { createSystemDashboardTools } from "./tools.js";

/** System dashboard plugin — provides tools for managing the ClawPilot installation. */
export const systemDashboardPlugin: Plugin = () => {
  const dashboardUrl = process.env["CLAW_DASHBOARD_URL"];
  const dashboardToken = process.env["CLAW_DASHBOARD_TOKEN"];

  // Only activate when dashboard credentials are available (system instance only)
  if (!dashboardUrl || !dashboardToken) return {};

  return {
    tools: () => createSystemDashboardTools(dashboardUrl, dashboardToken),
  };
};
