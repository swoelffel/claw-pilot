// src/commands/stop.ts
import { Command } from "commander";
import { getDbPath } from "../lib/platform.js";
import { initDatabase } from "../db/schema.js";
import { Registry } from "../core/registry.js";
import { Lifecycle } from "../core/lifecycle.js";
import { LocalConnection } from "../server/local.js";
import { resolveXdgRuntimeDir } from "../lib/xdg.js";
import { logger } from "../lib/logger.js";

export function stopCommand(): Command {
  return new Command("stop")
    .description("Stop an instance")
    .argument("<slug>", "Instance slug")
    .action(async (slug: string) => {
      const db = initDatabase(getDbPath());
      const registry = new Registry(db);
      const conn = new LocalConnection();
      const xdgRuntimeDir = await resolveXdgRuntimeDir(conn);
      const lifecycle = new Lifecycle(conn, registry, xdgRuntimeDir);

      logger.info(`Stopping ${slug}...`);
      await lifecycle.stop(slug);
      logger.success(`${slug} stopped.`);
      db.close();
    });
}
