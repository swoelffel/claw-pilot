// src/commands/doctor.ts
import { Command } from "commander";
import { HealthChecker } from "../core/health.js";
import { logger } from "../lib/logger.js";
import { withContext } from "./_context.js";
import { getRuntimeStateDir, isRuntimeRunning, getRuntimePid } from "../lib/platform.js";
import { runtimeConfigExists, loadRuntimeConfig } from "../runtime/index.js";
import type { Registry } from "../core/registry.js";
import chalk from "chalk";

export function doctorCommand(): Command {
  return new Command("doctor")
    .description("Diagnose instances health")
    .argument("[slug]", "Instance slug (all instances if omitted)")
    .action(async (slug?: string) => {
      await withContext(async ({ conn, registry, xdgRuntimeDir }) => {
        const health = new HealthChecker(conn, registry, xdgRuntimeDir);

        const server = registry.getLocalServer();
        if (server) {
          logger.success(`Server registered: ${server.hostname} (${server.home_dir})`);
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

          const stateDir = getRuntimeStateDir(inst.slug);

          // 1. Check PID file / runtime process
          const pid = getRuntimePid(stateDir);
          const running = isRuntimeRunning(stateDir);
          if (running && pid) {
            logger.success(`  Runtime: running (PID ${pid}, port ${inst.port})`);
          } else {
            logger.fail(`  Runtime: not running (port ${inst.port})`);
            allOk = false;
          }

          // 2. Check runtime config (DB first, then file)
          const dbConfig = (registry as Registry).getRuntimeConfig(inst.slug);
          if (dbConfig) {
            logger.success(`  Config: DB valid (runtime_config_json)`);
          } else if (runtimeConfigExists(stateDir)) {
            try {
              loadRuntimeConfig(stateDir);
              logger.success(`  Config: runtime.json valid (not yet in DB)`);
            } catch (err) {
              logger.fail(
                `  Config: runtime.json invalid — ${err instanceof Error ? err.message : String(err)}`,
              );
              allOk = false;
            }
          } else {
            logger.fail(`  Config: no config found (DB or ${stateDir}/runtime.json)`);
            allOk = false;
          }

          // 3. Check .env file
          const envPath = `${inst.state_dir}/.env`;
          const envExists = await conn.exists(envPath);
          if (envExists) {
            logger.success(`  .env: found`);
          } else {
            logger.fail(`  .env: missing (${envPath})`);
            allOk = false;
          }

          // 4. Check port availability (only if not running — if running, port is expected to be in use)
          if (!running) {
            try {
              const portCheck = await conn.exec(
                `lsof -i :${inst.port} -sTCP:LISTEN -t 2>/dev/null || true`,
              );
              if (portCheck.stdout.trim()) {
                logger.warn(
                  `  Port ${inst.port}: in use by another process (PID ${portCheck.stdout.trim()})`,
                );
              } else {
                logger.success(`  Port ${inst.port}: available`);
              }
            } catch {
              logger.dim(`  Port ${inst.port}: could not check`);
            }
          }

          // 5. Check agents
          const agents = registry.listAgents(inst.slug);
          if (agents.length > 0) {
            logger.success(`  Agents: ${agents.length} registered`);
          } else {
            logger.warn(`  Agents: none registered`);
          }

          // 6. Health check via core module
          const status = await health.check(inst.slug);
          if (status.telegram === "connected") {
            logger.step(`  Telegram: ${chalk.green("connected")}`);
          } else if (inst.telegram_bot) {
            logger.step(`  Telegram: ${chalk.yellow("disconnected")}`);
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
