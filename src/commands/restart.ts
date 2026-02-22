// src/commands/restart.ts
import { Command } from "commander";
import { getDbPath } from "../lib/platform.js";
import { initDatabase } from "../db/schema.js";
import { Registry } from "../core/registry.js";
import { Lifecycle } from "../core/lifecycle.js";
import { LocalConnection } from "../server/local.js";
import { logger } from "../lib/logger.js";

export function restartCommand(): Command {
  return new Command("restart")
    .description("Restart an instance")
    .argument("<slug>", "Instance slug")
    .action(async (slug: string) => {
      const db = initDatabase(getDbPath());
      const registry = new Registry(db);
      const conn = new LocalConnection();
      const lifecycle = new Lifecycle(conn, registry);

      logger.info(`Restarting ${slug}...`);
      await lifecycle.restart(slug);
      logger.success(`${slug} restarted.`);
      db.close();
    });
}
