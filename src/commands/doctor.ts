// src/commands/doctor.ts
import { Command } from "commander";
import { getDbPath } from "../lib/platform.js";
import { initDatabase } from "../db/schema.js";
import { Registry } from "../core/registry.js";
import { HealthChecker } from "../core/health.js";
import { OpenClawCLI } from "../core/openclaw-cli.js";
import { LocalConnection } from "../server/local.js";
import { resolveXdgRuntimeDir } from "../lib/xdg.js";
import { logger } from "../lib/logger.js";
import chalk from "chalk";

export function doctorCommand(): Command {
  return new Command("doctor")
    .description("Diagnose instances health")
    .argument("[slug]", "Instance slug (all instances if omitted)")
    .action(async (slug?: string) => {
      const db = initDatabase(getDbPath());
      const registry = new Registry(db);
      const conn = new LocalConnection();
      const xdgRuntimeDir = await resolveXdgRuntimeDir(conn);
      const health = new HealthChecker(conn, registry, xdgRuntimeDir);
      const cli = new OpenClawCLI(conn);

      // Check OpenClaw binary
      const openclaw = await cli.detect();
      if (openclaw) {
        logger.success(`OpenClaw ${openclaw.version} (${openclaw.bin})`);
      } else {
        logger.fail("OpenClaw not found in PATH");
      }

      // Check local server registration
      const server = registry.getLocalServer();
      if (server) {
        logger.success(
          `Server registered: ${server.hostname} (${server.openclaw_home})`,
        );
      } else {
        logger.fail("No server registered. Run 'claw-pilot init'.");
        db.close();
        return;
      }

      // Determine which instances to check
      const instances = slug
        ? [registry.getInstance(slug)].filter(Boolean)
        : registry.listInstances();

      if (instances.length === 0) {
        logger.info("No instances found.");
        db.close();
        return;
      }

      console.log("");

      let allOk = true;

      for (const inst of instances) {
        if (!inst) continue;
        console.log(chalk.bold(`Instance: ${inst.slug}`));

        const status = await health.check(inst.slug);

        // Gateway
        if (status.gateway === "healthy") {
          logger.success(`  Gateway: healthy (port ${inst.port})`);
        } else {
          logger.fail(`  Gateway: unhealthy (port ${inst.port})`);
          allOk = false;
        }

        // Systemd
        if (status.systemd === "active") {
          logger.success(`  Systemd: active (${inst.systemd_unit})`);
        } else {
          logger.fail(`  Systemd: ${status.systemd} (${inst.systemd_unit})`);
          allOk = false;
        }

        // Config file exists
        const configExists = await conn.exists(inst.config_path);
        if (configExists) {
          logger.success(`  Config: found`);
        } else {
          logger.fail(`  Config: missing (${inst.config_path})`);
          allOk = false;
        }

        // .env file
        const envPath = `${inst.state_dir}/.env`;
        const envExists = await conn.exists(envPath);
        if (envExists) {
          logger.success(`  .env: found`);
        } else {
          logger.fail(`  .env: missing (${envPath})`);
          allOk = false;
        }

        // Agents
        const agents = registry.listAgents(inst.slug);
        if (agents.length > 0) {
          logger.success(`  Agents: ${agents.length} registered`);
        } else {
          logger.warn(`  Agents: none registered`);
        }

        // Telegram
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
      }

      db.close();
    });
}
