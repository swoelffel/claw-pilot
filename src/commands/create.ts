// src/commands/create.ts
import { Command } from "commander";
import { PortAllocator } from "../core/port-allocator.js";
import { Provisioner } from "../core/provisioner.js";
import { runWizard } from "../wizard/wizard.js";
import { logger } from "../lib/logger.js";
import { withContext } from "./_context.js";
import { CliError } from "../lib/errors.js";
import chalk from "chalk";

export function createCommand(): Command {
  return new Command("create")
    .description("Create a new claw-runtime instance (wizard + provisioning)")
    .action(async () => {
      await withContext(async ({ conn, registry }) => {
        const portAllocator = new PortAllocator(registry, conn);

        const server = registry.getLocalServer();
        if (!server) {
          throw new CliError("No server registered. Run 'claw-pilot init' first.");
        }

        const answers = await runWizard(registry, portAllocator, conn, server.id);

        logger.info("\nProvisioning...");
        const provisioner = new Provisioner(conn, registry, portAllocator);
        const result = await provisioner.provision(answers, server.id);

        console.log(chalk.bold("\n=== Instance created ==="));
        console.log(`  Slug:         ${result.slug}`);
        console.log(`  Port:         ${result.port}`);
        console.log(`  State dir:    ${result.stateDir}`);
        console.log(`  Agents:       ${result.agentCount}`);

        console.log(chalk.dim(`\nStart the runtime with: claw-pilot runtime start ${result.slug}`));
        console.log(chalk.dim(`Chat interactively with: claw-pilot runtime chat ${result.slug}`));
        console.log("");
      });
    });
}
