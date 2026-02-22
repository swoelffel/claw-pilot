// src/commands/list.ts
import { Command } from "commander";
import Table from "cli-table3";
import { getDbPath } from "../lib/platform.js";
import { initDatabase } from "../db/schema.js";
import { Registry } from "../core/registry.js";
import { HealthChecker } from "../core/health.js";
import { LocalConnection } from "../server/local.js";
import chalk from "chalk";

export function listCommand(): Command {
  return new Command("list")
    .description("List all instances with their status")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const db = initDatabase(getDbPath());
      const registry = new Registry(db);
      const conn = new LocalConnection();
      const health = new HealthChecker(conn, registry);

      const statuses = await health.checkAll();

      if (opts.json) {
        console.log(JSON.stringify(statuses, null, 2));
        db.close();
        return;
      }

      if (statuses.length === 0) {
        console.log("No instances registered. Run 'claw-pilot init' first.");
        db.close();
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
      db.close();
    });
}
