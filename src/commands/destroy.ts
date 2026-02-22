// src/commands/destroy.ts
import { Command } from "commander";
import { input, confirm } from "@inquirer/prompts";
import { getDbPath } from "../lib/platform.js";
import { initDatabase } from "../db/schema.js";
import { Registry } from "../core/registry.js";
import { Destroyer } from "../core/destroyer.js";
import { LocalConnection } from "../server/local.js";
import { logger } from "../lib/logger.js";
import { InstanceNotFoundError } from "../lib/errors.js";
import chalk from "chalk";

export function destroyCommand(): Command {
  return new Command("destroy")
    .description("Destroy an instance (stops, removes files and registry entry)")
    .argument("<slug>", "Instance slug")
    .option("--yes", "Skip confirmation (dangerous!)")
    .action(async (slug: string, opts: { yes?: boolean }) => {
      const db = initDatabase(getDbPath());
      const registry = new Registry(db);

      const instance = registry.getInstance(slug);
      if (!instance) {
        throw new InstanceNotFoundError(slug);
      }

      if (!opts.yes) {
        console.log(
          chalk.red(
            `\nWARNING: This will permanently destroy instance "${slug}".`,
          ),
        );
        console.log(
          `  State dir:    ${instance.state_dir}`,
        );
        console.log(
          `  Port:         ${instance.port}`,
        );
        console.log(
          `  Agents:       ${registry.listAgents(slug).length}`,
        );
        console.log("");

        const confirm1 = await confirm({
          message: `Are you sure you want to destroy "${slug}"?`,
          default: false,
        });
        if (!confirm1) {
          logger.info("Cancelled.");
          db.close();
          return;
        }

        const typed = await input({
          message: `Type the instance slug to confirm: `,
        });
        if (typed !== slug) {
          logger.error("Slug does not match. Aborting.");
          db.close();
          return;
        }
      }

      const conn = new LocalConnection();
      const destroyer = new Destroyer(conn, registry);

      logger.info(`Destroying ${slug}...`);
      await destroyer.destroy(slug);
      logger.success(`Instance "${slug}" has been destroyed.`);

      db.close();
    });
}
