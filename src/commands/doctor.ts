// src/commands/doctor.ts
import { Command } from "commander";
import { HealthChecker } from "../core/health.js";
import { OpenClawCLI } from "../core/openclaw-cli.js";
import { logger } from "../lib/logger.js";
import { withContext } from "./_context.js";
import chalk from "chalk";

export function doctorCommand(): Command {
  return new Command("doctor")
    .description("Diagnose instances health")
    .argument("[slug]", "Instance slug (all instances if omitted)")
    .action(async (slug?: string) => {
      await withContext(async ({ conn, registry, xdgRuntimeDir }) => {
        const health = new HealthChecker(conn, registry, xdgRuntimeDir);
        const cli = new OpenClawCLI(conn);

        const openclaw = await cli.detect();
        if (openclaw) {
          logger.success(`OpenClaw ${openclaw.version} (${openclaw.bin})`);
        } else {
          logger.fail("OpenClaw not found in PATH");
        }

        const server = registry.getLocalServer();
        if (server) {
          logger.success(
            `Server registered: ${server.hostname} (${server.openclaw_home})`,
          );
        } else {
          logger.fail("No server registered. Run 'claw-pilot init'.");
          return;
        }

        const instances = slug
          ? [registry.getInstance(slug)].filter(Boolean)
          : registry.listInstances();

        if (instances.length === 0) {
          logger.info("No instances found.");
          return;
        }

        console.log("");

        let allOk = true;

        for (const inst of instances) {
          if (!inst) continue;
          console.log(chalk.bold(`Instance: ${inst.slug}`));

          const status = await health.check(inst.slug);

          if (status.gateway === "healthy") {
            logger.success(`  Gateway: healthy (port ${inst.port})`);
          } else {
            logger.fail(`  Gateway: unhealthy (port ${inst.port})`);
            allOk = false;
          }

          if (status.systemd === "active") {
            logger.success(`  Systemd: active (${inst.systemd_unit})`);
          } else {
            logger.fail(`  Systemd: ${status.systemd} (${inst.systemd_unit})`);
            allOk = false;
          }

          const configExists = await conn.exists(inst.config_path);
          if (configExists) {
            logger.success(`  Config: found`);
          } else {
            logger.fail(`  Config: missing (${inst.config_path})`);
            allOk = false;
          }

          const envPath = `${inst.state_dir}/.env`;
          const envExists = await conn.exists(envPath);
          if (envExists) {
            logger.success(`  .env: found`);
          } else {
            logger.fail(`  .env: missing (${envPath})`);
            allOk = false;
          }

          const agents = registry.listAgents(inst.slug);
          if (agents.length > 0) {
            logger.success(`  Agents: ${agents.length} registered`);
          } else {
            logger.warn(`  Agents: none registered`);
          }

          if (inst.telegram_bot) {
            logger.step(
              `  Telegram: ${
                status.telegram === "connected"
                  ? chalk.green("connected")
                  : chalk.yellow("disconnected")
              }`,
            );
          }

          console.log("");
        }

        if (allOk) {
          logger.success("All checks passed.");
        } else {
          logger.warn("Some checks failed. Review the output above.");
          process.exitCode = 1;
        }
      });
    });
}
