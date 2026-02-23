// src/commands/stop.ts
import { Command } from "commander";
import { Lifecycle } from "../core/lifecycle.js";
import { logger } from "../lib/logger.js";
import { withContext } from "./_context.js";

export function stopCommand(): Command {
  return new Command("stop")
    .description("Stop an instance")
    .argument("<slug>", "Instance slug")
    .action(async (slug: string) => {
      await withContext(async ({ conn, registry, xdgRuntimeDir }) => {
        const lifecycle = new Lifecycle(conn, registry, xdgRuntimeDir);
        logger.info(`Stopping ${slug}...`);
        await lifecycle.stop(slug);
        logger.success(`${slug} stopped.`);
      });
    });
}
