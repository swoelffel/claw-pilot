// src/commands/destroy.ts
import { Command } from "commander";
import { input, confirm } from "@inquirer/prompts";
import { Destroyer } from "../core/destroyer.js";
import { logger } from "../lib/logger.js";
import { InstanceNotFoundError } from "../lib/errors.js";
import { withContext } from "./_context.js";
import chalk from "chalk";

export function destroyCommand(): Command {
  return new Command("destroy")
    .description("Destroy an instance (stops, removes files and registry entry)")
    .argument("<slug>", "Instance slug")
    .option("--yes", "Skip confirmation (dangerous!)")
    .action(async (slug: string, opts: { yes?: boolean }) => {
      await withContext(async ({ conn, registry, xdgRuntimeDir }) => {
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
          console.log(`  State dir:    ${instance.state_dir}`);
          console.log(`  Port:         ${instance.port}`);
          console.log(`  Agents:       ${registry.listAgents(slug).length}`);
          console.log("");

          const confirm1 = await confirm({
            message: `Are you sure you want to destroy "${slug}"?`,
            default: false,
          });
          if (!confirm1) {
            logger.info("Cancelled.");
            return;
          }

          const typed = await input({
            message: `Type the instance slug to confirm: `,
          });
          if (typed !== slug) {
            logger.error("Slug does not match. Aborting.");
            return;
          }
        }

        const destroyer = new Destroyer(conn, registry, xdgRuntimeDir);
        logger.info(`Destroying ${slug}...`);
        await destroyer.destroy(slug);
        logger.success(`Instance "${slug}" has been destroyed.`);
      });
    });
}
