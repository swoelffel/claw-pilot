// src/commands/doctor.ts
import { Command } from "commander";
import type { HealthChecker } from "../core/health.js";
import { logger } from "../lib/logger.js";
import { withContext } from "./_context.js";
import { getRuntimeStateDir, isRuntimeRunning, getRuntimePid } from "../lib/platform.js";
import { runtimeConfigExists, loadRuntimeConfig } from "../runtime/index.js";
import type { Registry } from "../core/registry.js";
import type { ServerConnection } from "../server/connection.js";
import chalk from "chalk";

// ---------------------------------------------------------------------------
// Individual diagnostic checks
// ---------------------------------------------------------------------------

interface InstanceInfo {
  slug: string;
  port: number;
  state_dir: string;
  telegram_bot?: string | null;
  id: number;
}

/** Check PID file and runtime process status. */
function checkRuntime(stateDir: string, port: number): boolean {
  const pid = getRuntimePid(stateDir);
  const running = isRuntimeRunning(stateDir);
  if (running && pid) {
    logger.success(`  Runtime: running (PID ${pid}, port ${port})`);
    return true;
  }
  logger.fail(`  Runtime: not running (port ${port})`);
  return false;
}

/** Check runtime config exists and is valid (DB first, then file). */
function checkConfig(registry: Registry, slug: string, stateDir: string): boolean {
  const dbConfig = registry.getRuntimeConfig(slug);
  if (dbConfig) {
    logger.success(`  Config: DB valid (runtime_config_json)`);
    return true;
  }

  if (runtimeConfigExists(stateDir)) {
    try {
      loadRuntimeConfig(stateDir);
      logger.success(`  Config: runtime.json valid (not yet in DB)`);
      return true;
    } catch (err) {
      logger.fail(
        `  Config: runtime.json invalid — ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  logger.fail(`  Config: no config found (DB or ${stateDir}/runtime.json)`);
  return false;
}

/** Check .env file exists. */
async function checkEnv(conn: ServerConnection, envPath: string): Promise<boolean> {
  const envExists = await conn.exists(envPath);
  if (envExists) {
    logger.success(`  .env: found`);
    return true;
  }
  logger.fail(`  .env: missing (${envPath})`);
  return false;
}

/** Check port availability (only when runtime is not running). */
async function checkPort(conn: ServerConnection, port: number, running: boolean): Promise<void> {
  if (running) return;

  try {
    const portCheck = await conn.exec(`lsof -i :${port} -sTCP:LISTEN -t 2>/dev/null || true`);
    if (portCheck.stdout.trim()) {
      logger.warn(`  Port ${port}: in use by another process (PID ${portCheck.stdout.trim()})`);
    } else {
      logger.success(`  Port ${port}: available`);
    }
  } catch (err) {
    logger.debug("[doctor-cmd] port check failed", { error: String(err) });
    logger.dim(`  Port ${port}: could not check`);
  }
}

/** Check registered agents count. */
function checkAgents(registry: Registry, slug: string): void {
  const agents = registry.listAgents(slug);
  if (agents.length > 0) {
    logger.success(`  Agents: ${agents.length} registered`);
  } else {
    logger.warn(`  Agents: none registered`);
  }
}

/** Check Telegram channel health. */
async function checkTelegram(health: HealthChecker, inst: InstanceInfo): Promise<void> {
  const status = await health.check(inst.slug);
  if (status.telegram === "connected") {
    logger.step(`  Telegram: ${chalk.green("connected")}`);
  } else if (inst.telegram_bot) {
    logger.step(`  Telegram: ${chalk.yellow("disconnected")}`);
  }
}

// ---------------------------------------------------------------------------
// Command definition
// ---------------------------------------------------------------------------

export function doctorCommand(): Command {
  return new Command("doctor")
    .description("Diagnose instances health")
    .argument("[slug]", "Instance slug (all instances if omitted)")
    .action(async (slug?: string) => {
      await withContext(async ({ conn, registry, xdgRuntimeDir }) => {
        const { HealthChecker } = await import("../core/health.js");
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
          const running = isRuntimeRunning(stateDir);

          if (!checkRuntime(stateDir, inst.port)) allOk = false;
          if (!checkConfig(registry as Registry, inst.slug, stateDir)) allOk = false;
          if (!(await checkEnv(conn, `${inst.state_dir}/.env`))) allOk = false;
          await checkPort(conn, inst.port, running);
          checkAgents(registry, inst.slug);
          await checkTelegram(health, inst as unknown as InstanceInfo);

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
