// src/commands/status.ts
import { Command } from "commander";
import { getDbPath } from "../lib/platform.js";
import { initDatabase } from "../db/schema.js";
import { Registry } from "../core/registry.js";
import { HealthChecker } from "../core/health.js";
import { LocalConnection } from "../server/local.js";
import { logger } from "../lib/logger.js";
import chalk from "chalk";

export function statusCommand(): Command {
  return new Command("status")
    .description("Show detailed status of an instance")
    .argument("<slug>", "Instance slug")
    .option("--json", "Output as JSON")
    .action(async (slug: string, opts: { json?: boolean }) => {
      const db = initDatabase(getDbPath());
      const registry = new Registry(db);
      const conn = new LocalConnection();
      const health = new HealthChecker(conn, registry);

      const status = await health.check(slug);
      const instance = registry.getInstance(slug);

      if (opts.json) {
        console.log(JSON.stringify({ status, instance }, null, 2));
        db.close();
        return;
      }

      console.log(chalk.bold(`\nInstance: ${slug}`));
      console.log(`  Display name : ${instance?.display_name ?? "-"}`);
      console.log(`  Port         : ${status.port}`);
      console.log(
        `  Gateway      : ${
          status.gateway === "healthy"
            ? chalk.green("healthy")
            : chalk.red("unhealthy")
        }`,
      );
      console.log(
        `  Systemd      : ${
          status.systemd === "active"
            ? chalk.green("active")
            : status.systemd === "failed"
              ? chalk.red("failed")
              : chalk.yellow(status.systemd)
        }`,
      );
      if (status.pid) console.log(`  PID          : ${status.pid}`);
      if (status.uptime) console.log(`  Since        : ${status.uptime}`);
      console.log(`  Agents       : ${status.agentCount ?? "?"}`);
      console.log(
        `  Telegram     : ${
          status.telegram === "connected"
            ? chalk.green("connected")
            : status.telegram === "disconnected"
              ? chalk.yellow("disconnected")
              : "-"
        }`,
      );
      if (instance?.nginx_domain)
        console.log(`  Nginx domain : ${instance.nginx_domain}`);
      if (instance?.discovered)
        console.log(`  Origin       : ${chalk.dim("adopted (existing infra)")}`);

      // Recent events
      const events = registry.listEvents(slug, 5);
      if (events.length > 0) {
        console.log(chalk.bold("\n  Recent events:"));
        for (const e of events) {
          console.log(
            `    ${chalk.dim(e.created_at)} ${e.event_type}${e.detail ? ": " + e.detail : ""}`,
          );
        }
      }

      console.log("");
      db.close();
    });
}
