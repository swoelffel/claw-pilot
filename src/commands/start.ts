// src/commands/start.ts
import { Command } from "commander";
import { Lifecycle } from "../core/lifecycle.js";
import { logger } from "../lib/logger.js";
import { withContext } from "./_context.js";

export function startCommand(): Command {
  return new Command("start")
    .description("Start an instance")
    .argument("<slug>", "Instance slug")
    .action(async (slug: string) => {
      await withContext(async ({ conn, registry, xdgRuntimeDir }) => {
        const lifecycle = new Lifecycle(conn, registry, xdgRuntimeDir);
        logger.info(`Starting ${slug}...`);
        await lifecycle.start(slug);
        logger.success(`${slug} is running.`);
      });
    });
}
