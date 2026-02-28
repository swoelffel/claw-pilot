// src/commands/create.ts
import { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import { PortAllocator } from "../core/port-allocator.js";
import { PairingManager } from "../core/pairing.js";
import { Provisioner } from "../core/provisioner.js";
import { OpenClawCLI } from "../core/openclaw-cli.js";
import { runWizard } from "../wizard/wizard.js";
import { logger } from "../lib/logger.js";
import { withContext } from "./_context.js";
import { constants } from "../lib/constants.js";
import chalk from "chalk";
import { readGatewayToken } from "../lib/env-reader.js";

export function createCommand(): Command {
  return new Command("create")
    .description("Create a new OpenClaw instance (wizard + provisioning)")
    .action(async () => {
      await withContext(async ({ conn, registry }) => {
        const portAllocator = new PortAllocator(registry, conn);

        const server = registry.getLocalServer();
        if (!server) {
          logger.error("No server registered. Run 'claw-pilot init' first.");
          process.exit(1);
        }

        // Detect OpenClaw — offer to install if missing (before entering the wizard)
        const cli = new OpenClawCLI(conn);
        const openclaw = await cli.detect();
        if (!openclaw) {
          const installUrl =
            process.env["OPENCLAW_INSTALL_URL"] ?? constants.OPENCLAW_INSTALL_URL;
          logger.warn("OpenClaw CLI not found.");
          const shouldInstall = await confirm({
            message: `Install OpenClaw automatically? (from ${installUrl})`,
            default: true,
          });
          if (shouldInstall) {
            logger.info("Installing OpenClaw...");
            const installed = await cli.install();
            if (!installed) {
              logger.error(
                `OpenClaw installation failed. Install manually: ${installUrl}`,
              );
              logger.error("Cannot create instance without OpenClaw.");
              process.exit(1);
            }
            const detected = await cli.detect();
            logger.success(`OpenClaw installed: ${detected?.version ?? "unknown"}`);
          } else {
            logger.error(
              "OpenClaw is required to create instances. Run 'claw-pilot init' to install it.",
            );
            process.exit(1);
          }
        }

        const answers = await runWizard(registry, portAllocator, conn, server.id);

        logger.info("\nProvisioning...");
        const provisioner = new Provisioner(conn, registry, portAllocator);
        const result = await provisioner.provision(answers, server.id);

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

        // Build Control UI URL — inject token in hash fragment for zero-friction login
        const baseUrl = `http://127.0.0.1:${result.port}`;

        // Read the freshly-written token (best-effort — provisioner already has it in result)
        const gatewayToken = result.gatewayToken || await readGatewayToken(conn, result.stateDir);
        const controlUrl = gatewayToken ? `${baseUrl}/#token=${gatewayToken}` : baseUrl;

        console.log(chalk.bold("\n=== Instance created ==="));
        console.log(`  Slug:         ${result.slug}`);
        console.log(`  Port:         ${result.port}`);
        console.log(`  State dir:    ${result.stateDir}`);
        console.log(`  Agents:       ${result.agentCount}`);
        console.log(`  Control UI:   ${chalk.cyan(controlUrl)}`);
        if (gatewayToken) {
          console.log(chalk.dim(`\nThe URL above includes the gateway token — open it to log in automatically.`));
          console.log(chalk.dim(`Run 'claw-pilot token ${result.slug} --open' to reopen at any time.`));
        }
        console.log("");
      });
    });
}
