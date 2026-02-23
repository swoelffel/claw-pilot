// src/commands/list.ts
import { Command } from "commander";
import Table from "cli-table3";
import { HealthChecker } from "../core/health.js";
import { withContext } from "./_context.js";
import chalk from "chalk";

export function listCommand(): Command {
  return new Command("list")
    .description("List all instances with their status")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      await withContext(async ({ conn, registry, xdgRuntimeDir }) => {
        const health = new HealthChecker(conn, registry, xdgRuntimeDir);
        const statuses = await health.checkAll();

        if (opts.json) {
          console.log(JSON.stringify(statuses, null, 2));
          return;
        }

        if (statuses.length === 0) {
          console.log("No instances registered. Run 'claw-pilot init' first.");
          return;
        }

        const table = new Table({
          head: [
            chalk.bold("Instance"),
            chalk.bold("Port"),
            chalk.bold("Status"),
            chalk.bold("Agents"),
            chalk.bold("Telegram"),
          ],
          style: { head: [], border: [] },
        });

        for (const s of statuses) {
          const statusLabel =
            s.gateway === "healthy"
              ? chalk.green("running")
              : s.systemd === "inactive"
                ? chalk.yellow("stopped")
                : s.systemd === "failed"
                  ? chalk.red("failed")
                  : chalk.gray("unknown");

          const telegramLabel =
            s.telegram === "connected"
              ? chalk.green("connected")
              : s.telegram === "disconnected"
                ? chalk.yellow("disconnected")
                : chalk.gray("-");

          table.push([
            s.slug,
            String(s.port),
            statusLabel,
            String(s.agentCount ?? "?"),
            telegramLabel,
          ]);
        }

        console.log(table.toString());
      });
    });
}
