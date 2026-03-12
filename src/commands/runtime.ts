// src/commands/runtime.ts
import { Command } from "commander";
import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { getStateDir, getDbPath } from "../lib/platform.js";
import { initDatabase } from "../db/schema.js";
import {
  ClawRuntime,
  loadRuntimeConfig,
  saveRuntimeConfig,
  ensureRuntimeConfig,
  runtimeConfigExists,
  createDefaultRuntimeConfig,
  type RuntimeAgentConfig,
  type RuntimeMcpServerConfig,
} from "../runtime/index.js";

// ---------------------------------------------------------------------------
// runtime config init <slug>
// ---------------------------------------------------------------------------

function runtimeConfigInitCommand(): Command {
  return new Command("init")
    .description("Generate a default runtime.json in the instance state directory")
    .argument("<slug>", "Instance slug")
    .option(
      "--model <model>",
      "Default model (provider/model format)",
      "anthropic/claude-sonnet-4-5",
    )
    .option("--telegram", "Enable Telegram channel in the generated config")
    .option("--force", "Overwrite existing runtime.json")
    .action(async (slug: string, opts: { model: string; telegram?: boolean; force?: boolean }) => {
      const stateDir = getStateDir(slug);

      if (runtimeConfigExists(stateDir) && !opts.force) {
        logger.warn(`runtime.json already exists in ${stateDir}`);
        logger.warn("Use --force to overwrite.");
        process.exit(1);
      }

      const config = createDefaultRuntimeConfig({
        defaultModel: opts.model,
        telegramEnabled: opts.telegram ?? false,
      });

      saveRuntimeConfig(stateDir, config);
      logger.success(`runtime.json created at ${stateDir}/runtime.json`);
      logger.dim(`Default model : ${config.defaultModel}`);
      logger.dim(`Agents        : ${config.agents.map((a) => a.id).join(", ")}`);
      logger.dim(`Telegram      : ${config.telegram.enabled ? "enabled" : "disabled"}`);
      logger.dim(`Web chat      : ${config.webChat.enabled ? "enabled" : "disabled"}`);
    });
}

// ---------------------------------------------------------------------------
// runtime config
// ---------------------------------------------------------------------------

function runtimeConfigCommand(): Command {
  const cmd = new Command("config").description("Manage runtime configuration");
  cmd.addCommand(runtimeConfigInitCommand());
  return cmd;
}

// ---------------------------------------------------------------------------
// runtime status <slug>
// ---------------------------------------------------------------------------

function runtimeStatusCommand(): Command {
  return new Command("status")
    .description("Show runtime configuration and channel status for an instance")
    .argument("<slug>", "Instance slug")
    .option("--json", "Output as JSON")
    .action(async (slug: string, opts: { json?: boolean }) => {
      const stateDir = getStateDir(slug);

      if (!runtimeConfigExists(stateDir)) {
        logger.error(`No runtime.json found for instance "${slug}".`);
        logger.error(`Run: claw-pilot runtime config init ${slug}`);
        process.exit(1);
      }

      let config;
      try {
        config = loadRuntimeConfig(stateDir);
      } catch (err) {
        logger.error(
          `Failed to load runtime.json: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify({ slug, stateDir, config }, null, 2));
        return;
      }

      console.log(chalk.bold(`\nRuntime config: ${slug}`));
      console.log(`  State dir     : ${stateDir}`);
      console.log(`  Default model : ${config.defaultModel}`);
      console.log(
        `  Agents        : ${config.agents.length > 0 ? config.agents.map((a: RuntimeAgentConfig) => `${a.id} (${a.model})`).join(", ") : chalk.dim("none")}`,
      );
      console.log(
        `  MCP           : ${config.mcpEnabled ? chalk.green(`enabled (${config.mcpServers.filter((s: RuntimeMcpServerConfig) => s.enabled).length} servers)`) : chalk.dim("disabled")}`,
      );
      console.log(
        `  Web chat      : ${config.webChat.enabled ? chalk.green("enabled") : chalk.dim("disabled")}`,
      );
      console.log(
        `  Telegram      : ${config.telegram.enabled ? chalk.green("enabled") : chalk.dim("disabled")}`,
      );

      if (config.mcpEnabled && config.mcpServers.length > 0) {
        console.log(chalk.bold("\n  MCP servers:"));
        for (const srv of config.mcpServers) {
          const status = srv.enabled ? chalk.green("enabled") : chalk.dim("disabled");
          const detail = srv.type === "local" ? `${srv.command} ${srv.args.join(" ")}` : srv.url;
          console.log(`    ${srv.id} [${srv.type}] ${status} — ${chalk.dim(detail)}`);
        }
      }

      console.log("");
    });
}

// ---------------------------------------------------------------------------
// runtime start <slug>
// ---------------------------------------------------------------------------

function runtimeStartCommand(): Command {
  return new Command("start")
    .description("Start the claw-runtime engine for an instance (foreground, SIGTERM to stop)")
    .argument("<slug>", "Instance slug")
    .option("--ensure-config", "Create runtime.json with defaults if it does not exist")
    .action(async (slug: string, opts: { ensureConfig?: boolean }) => {
      const stateDir = getStateDir(slug);

      // Load or create config
      let config;
      if (opts.ensureConfig) {
        config = ensureRuntimeConfig(stateDir);
        logger.info(`Config loaded from ${stateDir}/runtime.json`);
      } else {
        if (!runtimeConfigExists(stateDir)) {
          logger.error(`No runtime.json found for instance "${slug}".`);
          logger.error(`Run: claw-pilot runtime config init ${slug}`);
          process.exit(1);
        }
        try {
          config = loadRuntimeConfig(stateDir);
        } catch (err) {
          logger.error(`Invalid runtime.json: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
      }

      // Open DB
      const db = initDatabase(getDbPath());

      const runtime = new ClawRuntime(config, db, slug);

      // Graceful shutdown on SIGTERM / SIGINT
      let stopping = false;
      const shutdown = async () => {
        if (stopping) return;
        stopping = true;
        logger.info("Stopping runtime...");
        try {
          await runtime.stop();
          logger.success("Runtime stopped.");
        } catch (err) {
          logger.error(`Error during stop: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          db.close();
          process.exit(0);
        }
      };

      process.on("SIGTERM", () => void shutdown());
      process.on("SIGINT", () => void shutdown());

      logger.info(`Starting claw-runtime for "${slug}"...`);
      logger.dim(`Model: ${config.defaultModel}`);
      logger.dim(
        `Agents: ${config.agents.map((a: RuntimeAgentConfig) => a.id).join(", ") || "none"}`,
      );

      try {
        await runtime.start();
      } catch (err) {
        logger.error(
          `Failed to start runtime: ${err instanceof Error ? err.message : String(err)}`,
        );
        db.close();
        process.exit(1);
      }

      logger.success(`Runtime running (slug: ${slug})`);

      if (config.webChat.enabled) {
        logger.step("Web chat channel: active");
      }
      if (config.telegram.enabled) {
        logger.step("Telegram channel: active");
      }

      logger.dim("Press Ctrl+C or send SIGTERM to stop.");

      // Keep process alive — channels hold their own event loops (WS server, polling)
      // We just wait for the shutdown signal.
      await new Promise<void>((resolve) => {
        process.once("beforeExit", resolve);
      });
    });
}

// ---------------------------------------------------------------------------
// runtime (root command)
// ---------------------------------------------------------------------------

export function runtimeCommand(): Command {
  const cmd = new Command("runtime").description(
    "Manage the claw-runtime engine (multi-agent, channels, MCP)",
  );

  cmd.addCommand(runtimeStartCommand());
  cmd.addCommand(runtimeStatusCommand());
  cmd.addCommand(runtimeConfigCommand());

  return cmd;
}
