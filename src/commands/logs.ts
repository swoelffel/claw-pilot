// src/commands/logs.ts
import { Command } from "commander";
import { getDbPath } from "../lib/platform.js";
import { initDatabase } from "../db/schema.js";
import { Registry } from "../core/registry.js";
import { LocalConnection } from "../server/local.js";
import { InstanceNotFoundError } from "../lib/errors.js";

export function logsCommand(): Command {
  return new Command("logs")
    .description("Show gateway logs for an instance")
    .argument("<slug>", "Instance slug")
    .option("-n, --lines <n>", "Number of lines to show", "50")
    .option("-f, --follow", "Follow log output (tail -f)")
    .action(async (slug: string, opts: { lines: string; follow?: boolean }) => {
      const db = initDatabase(getDbPath());
      const registry = new Registry(db);
      const instance = registry.getInstance(slug);

      if (!instance) throw new InstanceNotFoundError(slug);

      const logPath = `${instance.state_dir}/logs/gateway.log`;
      const conn = new LocalConnection();

      if (opts.follow) {
        // Stream logs using tail -f (spawns child process)
        const { spawn } = await import("node:child_process");
        const child = spawn("tail", ["-f", "-n", opts.lines, logPath], {
          stdio: "inherit",
        });
        process.on("SIGINT", () => {
          child.kill();
          db.close();
        });
        await new Promise((resolve) => child.on("exit", resolve));
      } else {
        const result = await conn.exec(
          `tail -n ${opts.lines} ${logPath} 2>/dev/null || echo "(no log file found)"`,
        );
        console.log(result.stdout);
      }

      db.close();
    });
}
