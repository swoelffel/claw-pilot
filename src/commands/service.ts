// src/commands/service.ts
import { Command } from "commander";
import { isLinux } from "../lib/platform.js";
import {
  installDashboardService,
  uninstallDashboardService,
  restartDashboardService,
  getDashboardServiceStatus,
} from "../core/dashboard-service.js";
import { constants } from "../lib/constants.js";
import { parsePositiveInt } from "../lib/validate.js";

export function serviceCommand(): Command {
  const cmd = new Command("service")
    .description("Manage the claw-pilot dashboard systemd service (Linux only)");

  cmd
    .command("install")
    .description("Install and start the dashboard as a systemd user service")
    .option("-p, --port <port>", "Dashboard port", String(constants.DASHBOARD_PORT))
    .action(async (opts: { port: string }) => {
      if (!isLinux()) {
        console.error("[x] systemd services are only supported on Linux.");
        process.exit(1);
      }
      try {
        await installDashboardService(parsePositiveInt(opts.port, "--port"));
        console.log("[+] Dashboard service installed successfully.");
        console.log(`    View logs: journalctl --user -u claw-pilot-dashboard.service -f`);
      } catch (err: any) {
        console.error(`[x] Failed to install service: ${err.message}`);
        process.exit(1);
      }
    });

  cmd
    .command("uninstall")
    .description("Stop and remove the dashboard systemd service")
    .action(async () => {
      if (!isLinux()) {
        console.error("[x] systemd services are only supported on Linux.");
        process.exit(1);
      }
      try {
        await uninstallDashboardService();
      } catch (err: any) {
        console.error(`[x] Failed to uninstall service: ${err.message}`);
        process.exit(1);
      }
    });

  cmd
    .command("restart")
    .description("Restart the dashboard systemd service")
    .action(async () => {
      if (!isLinux()) {
        console.error("[x] systemd services are only supported on Linux.");
        process.exit(1);
      }
      try {
        await restartDashboardService();
      } catch (err: any) {
        console.error(`[x] Failed to restart service: ${err.message}`);
        process.exit(1);
      }
    });

  cmd
    .command("status")
    .description("Show the status of the dashboard systemd service")
    .action(async () => {
      if (!isLinux()) {
        console.log("[!] systemd services are only supported on Linux.");
        console.log("    On macOS, run the dashboard manually: claw-pilot dashboard");
        return;
      }
      try {
        const status = await getDashboardServiceStatus();
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
          console.log("  To view logs: journalctl --user -u claw-pilot-dashboard.service -n 50");
        }
      } catch (err: any) {
        console.error(`[x] Failed to get service status: ${err.message}`);
        process.exit(1);
      }
    });

  return cmd;
}
