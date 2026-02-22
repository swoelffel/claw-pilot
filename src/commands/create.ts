// src/commands/create.ts
import { Command } from "commander";
import { getDbPath, getOpenClawHome } from "../lib/platform.js";
import { initDatabase } from "../db/schema.js";
import { Registry } from "../core/registry.js";
import { PortAllocator } from "../core/port-allocator.js";
import { PairingManager } from "../core/pairing.js";
import { Provisioner } from "../core/provisioner.js";
import { LocalConnection } from "../server/local.js";
import { runWizard } from "../wizard/wizard.js";
import { logger } from "../lib/logger.js";
import chalk from "chalk";

export function createCommand(): Command {
  return new Command("create")
    .description("Create a new OpenClaw instance (wizard + provisioning)")
    .action(async () => {
      const db = initDatabase(getDbPath());
      const registry = new Registry(db);
      const conn = new LocalConnection();
      const portAllocator = new PortAllocator(registry, conn);

      const server = registry.getLocalServer();
      if (!server) {
        logger.error(
          "No server registered. Run 'claw-pilot init' first.",
        );
        process.exit(1);
      }

      // Run wizard
      const answers = await runWizard(registry, portAllocator, conn, server.id);

      // Provision
      logger.info("\nProvisioning...");
      const provisioner = new Provisioner(conn, registry, portAllocator);
      const result = await provisioner.provision(answers, server.id);

      // Device pairing (bootstrap)
      logger.step("Bootstrapping device pairing...");
      try {
        const pairing = new PairingManager(conn, registry);
        await pairing.bootstrapDevicePairing(result.slug);
        logger.success("Device pairing approved.");
      } catch (err) {
        logger.warn(
          `Device pairing failed (manual action may be needed): ${err instanceof Error ? err.message : err}`,
        );
      }

      // Telegram pairing (if enabled)
      if (answers.telegram.enabled) {
        logger.info("\nWaiting for Telegram pairing...");
        logger.dim(
          `Open Telegram and start a chat with the bot. The bot will send a pairing code.`,
        );
        try {
          const pairing = new PairingManager(conn, registry);
          const code = await pairing.waitForTelegramPairing(result.slug);
          logger.success(`Telegram paired (code: ${code}).`);
        } catch (err) {
          logger.warn(
            `Telegram pairing timed out. Complete it manually.\n  ${err instanceof Error ? err.message : err}`,
          );
        }
      }

      // Summary
      console.log(chalk.bold("\n=== Instance created ==="));
      console.log(`  Slug:         ${result.slug}`);
      console.log(`  Port:         ${result.port}`);
      console.log(`  State dir:    ${result.stateDir}`);
      console.log(`  Agents:       ${result.agentCount}`);
      if (result.nginxDomain) {
        console.log(`  URL:          https://${result.nginxDomain}`);
      } else {
        console.log(
          `  Gateway:      http://127.0.0.1:${result.port}`,
        );
      }
      console.log(
        chalk.dim(
          `\nGateway token stored in ${result.stateDir}/.env`,
        ),
      );
      console.log("");

      db.close();
    });
}
