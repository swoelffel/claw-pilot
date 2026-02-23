// src/commands/logs.ts
import { Command } from "commander";
import { InstanceNotFoundError } from "../lib/errors.js";
import { shellEscape } from "../lib/shell.js";
import { withContext } from "./_context.js";

export function logsCommand(): Command {
  return new Command("logs")
    .description("Show gateway logs for an instance")
    .argument("<slug>", "Instance slug")
    .option("-n, --lines <n>", "Number of lines to show", "50")
    .option("-f, --follow", "Follow log output (tail -f)")
    .action(async (slug: string, opts: { lines: string; follow?: boolean }) => {
      const lines = parseInt(opts.lines, 10);
      if (isNaN(lines) || lines < 1 || lines > 100_000) {
        throw new Error(`Invalid --lines value: "${opts.lines}" (expected 1-100000)`);
      }

      await withContext(async ({ conn, registry }) => {
        const instance = registry.getInstance(slug);
        if (!instance) throw new InstanceNotFoundError(slug);

        const logPath = `${instance.state_dir}/logs/gateway.log`;

        if (opts.follow) {
          const { spawn } = await import("node:child_process");
          const child = spawn("tail", ["-f", "-n", String(lines), logPath], {
            stdio: "inherit",
          });
          process.on("SIGINT", () => {
            child.kill();
          });
          await new Promise((resolve) => child.on("exit", resolve));
        } else {
          const result = await conn.exec(
            `tail -n ${lines} ${shellEscape(logPath)} 2>/dev/null || echo "(no log file found)"`,
          );
          console.log(result.stdout);
        }
      });
    });
}
