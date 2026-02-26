// src/commands/service.ts
import { Command } from "commander";
import { getServiceManager } from "../lib/platform.js";
import {
  installDashboardService,
  uninstallDashboardService,
  restartDashboardService,
  getDashboardServiceStatus,
} from "../core/dashboard-service.js";
import { constants } from "../lib/constants.js";
import { parsePositiveInt } from "../lib/validate.js";
import { withContext } from "./_context.js";

export function serviceCommand(): Command {
  const cmd = new Command("service")
    .description("Manage the claw-pilot dashboard service (systemd on Linux, launchd on macOS)");

  cmd
    .command("install")
    .description("Install and start the dashboard as a system service")
    .option("-p, --port <port>", "Dashboard port", String(constants.DASHBOARD_PORT))
    .action(async (opts: { port: string }) => {
      const sm = getServiceManager();
      try {
        await withContext(async ({ conn, xdgRuntimeDir }) => {
          await installDashboardService(conn, xdgRuntimeDir, parsePositiveInt(opts.port, "--port"));
        });
        console.log("[+] Dashboard service installed successfully.");
        if (sm === "launchd") {
          console.log(`    View logs: tail -f ~/.claw-pilot/dashboard.log`);
        } else {
          console.log(`    View logs: journalctl --user -u claw-pilot-dashboard.service -f`);
        }
      } catch (err: any) {
        console.error(`[x] Failed to install service: ${err.message}`);
        process.exit(1);
      }
    });

  cmd
    .command("uninstall")
    .description("Stop and remove the dashboard service")
    .action(async () => {
      try {
        await withContext(async ({ conn, xdgRuntimeDir }) => {
          await uninstallDashboardService(conn, xdgRuntimeDir);
        });
      } catch (err: any) {
        console.error(`[x] Failed to uninstall service: ${err.message}`);
        process.exit(1);
      }
    });

  cmd
    .command("restart")
    .description("Restart the dashboard service")
    .action(async () => {
      try {
        await withContext(async ({ conn, xdgRuntimeDir }) => {
          await restartDashboardService(conn, xdgRuntimeDir);
        });
      } catch (err: any) {
        console.error(`[x] Failed to restart service: ${err.message}`);
        process.exit(1);
      }
    });

  cmd
    .command("status")
    .description("Show the status of the dashboard service")
    .action(async () => {
      const sm = getServiceManager();
      try {
        const status = await withContext(async ({ conn, xdgRuntimeDir }) => {
          return getDashboardServiceStatus(conn, xdgRuntimeDir);
        });
        console.log("Dashboard Service Status:");
        console.log(`  Installed:       ${status.installed ? "yes" : "no"}`);
        console.log(`  Active:          ${status.active ? "yes (running)" : "no"}`);
        console.log(`  Enabled:         ${status.enabled ? "yes (auto-start)" : "no"}`);
        if (status.pid) console.log(`  PID:             ${status.pid}`);
        if (status.uptime) console.log(`  Active since:    ${status.uptime}`);
        console.log(`  Port responding: ${status.portResponding ? "yes" : "no"}`);
        if (!status.active) {
          console.log("");
          console.log("  To install: claw-pilot service install");
          if (sm === "launchd") {
            console.log("  To view logs: tail -f ~/.claw-pilot/dashboard.log");
          } else {
            console.log("  To view logs: journalctl --user -u claw-pilot-dashboard.service -n 50");
          }
        }
      } catch (err: any) {
        console.error(`[x] Failed to get service status: ${err.message}`);
        process.exit(1);
      }
    });

  return cmd;
}
