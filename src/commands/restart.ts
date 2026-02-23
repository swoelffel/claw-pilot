// src/commands/restart.ts
import { Command } from "commander";
import { Lifecycle } from "../core/lifecycle.js";
import { logger } from "../lib/logger.js";
import { withContext } from "./_context.js";

export function restartCommand(): Command {
  return new Command("restart")
    .description("Restart an instance")
    .argument("<slug>", "Instance slug")
    .action(async (slug: string) => {
      await withContext(async ({ conn, registry, xdgRuntimeDir }) => {
        const lifecycle = new Lifecycle(conn, registry, xdgRuntimeDir);
        logger.info(`Restarting ${slug}...`);
        await lifecycle.restart(slug);
        logger.success(`${slug} restarted.`);
      });
    });
}
