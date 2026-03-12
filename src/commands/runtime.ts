// src/commands/runtime.ts
import * as readline from "node:readline";
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
  createSession,
  listSessions,
  resolveModel,
  defaultAgentName,
  getAgent,
  runPromptLoop,
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
// runtime chat <slug>
// ---------------------------------------------------------------------------

function runtimeChatCommand(): Command {
  return new Command("chat")
    .description("Start an interactive chat session with a claw-runtime agent")
    .argument("<slug>", "Instance slug")
    .option("--agent <id>", "Agent ID to use (default: auto-detected from config)")
    .option("--model <model>", "Override model (provider/model format)")
    .option("--session <id>", "Resume an existing session by ID")
    .option("--ensure-config", "Create runtime.json with defaults if it does not exist")
    .option("--once <message>", "Send a single message and exit (non-interactive, no TTY required)")
    .action(
      async (
        slug: string,
        opts: {
          agent?: string;
          model?: string;
          session?: string;
          ensureConfig?: boolean;
          once?: string;
        },
      ) => {
        const stateDir = getStateDir(slug);

        // Load config
        let config;
        if (opts.ensureConfig) {
          config = ensureRuntimeConfig(stateDir);
        } else {
          if (!runtimeConfigExists(stateDir)) {
            logger.error(`No runtime.json found for instance "${slug}".`);
            logger.error(`Run: claw-pilot runtime config init ${slug}`);
            process.exit(1);
          }
          try {
            config = loadRuntimeConfig(stateDir);
          } catch (err) {
            logger.error(
              `Invalid runtime.json: ${err instanceof Error ? err.message : String(err)}`,
            );
            process.exit(1);
          }
        }

        // Init agent registry
        const { initAgentRegistry } = await import("../runtime/agent/registry.js");
        initAgentRegistry(config.agents);

        // Resolve agent
        const agentId = opts.agent ?? defaultAgentName();
        const agentInfo = getAgent(agentId);
        if (!agentInfo) {
          logger.error(`Agent "${agentId}" not found.`);
          process.exit(1);
        }

        // Build RuntimeAgentConfig from agent info + config override
        const agentCfg: RuntimeAgentConfig = config.agents.find((a) => a.id === agentId) ?? {
          id: agentInfo.name,
          name: agentInfo.name,
          model: opts.model ?? agentInfo.model ?? config.defaultModel,
          permissions: agentInfo.permission ?? [],
          maxSteps: agentInfo.steps ?? 20,
          allowSubAgents: true,
          toolProfile: "coding",
          isDefault: false,
        };

        // Model override
        const modelStr = opts.model ?? agentCfg.model;
        const slashIdx = modelStr.indexOf("/");
        if (slashIdx === -1) {
          logger.error(`Invalid model format "${modelStr}" — expected "provider/model".`);
          process.exit(1);
        }
        const providerId = modelStr.slice(0, slashIdx);
        const modelId = modelStr.slice(slashIdx + 1);

        let resolvedModelObj;
        try {
          resolvedModelObj = resolveModel(providerId, modelId);
        } catch (err) {
          logger.error(
            `Cannot resolve model "${modelStr}": ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exit(1);
        }

        // Open DB
        const db = initDatabase(getDbPath());

        // Create or resume session
        let session;
        if (opts.session) {
          const { getSession } = await import("../runtime/session/session.js");
          session = getSession(db, opts.session);
          if (!session) {
            logger.error(`Session "${opts.session}" not found.`);
            db.close();
            process.exit(1);
          }
          logger.info(`Resuming session ${session.id}`);
        } else {
          session = createSession(db, { instanceSlug: slug, agentId, channel: "cli" });
          logger.info(`New session: ${session.id}`);
        }

        // --once: non-interactive single-shot mode (no TTY required)
        if (opts.once) {
          logger.info(`Session: ${session.id}`);
          process.stdout.write(chalk.green("Agent: "));
          try {
            const result = await runPromptLoop({
              db,
              instanceSlug: slug,
              sessionId: session.id,
              userText: opts.once,
              agentConfig: agentCfg,
              resolvedModel: resolvedModelObj,
              workDir: stateDir,
            });
            console.log(result.text);
            console.log(
              chalk.dim(
                `  [${result.tokens.input}→${result.tokens.output} tokens, ${result.steps} step(s), $${result.costUsd.toFixed(6)}]`,
              ),
            );
          } catch (err) {
            console.log(chalk.red(`\n[Error] ${err instanceof Error ? err.message : String(err)}`));
            db.close();
            process.exit(1);
          }
          db.close();
          process.exit(0);
        }

        // Print header
        console.log(chalk.bold(`\nclaw-runtime chat — ${slug}`));
        console.log(
          `  Agent : ${chalk.cyan(agentId)}   Model : ${chalk.cyan(modelStr)}   Session : ${chalk.dim(session.id)}`,
        );
        console.log(chalk.dim("  Type your message and press Enter. Ctrl+C or /exit to quit.\n"));

        // List previous messages if resuming
        if (opts.session) {
          const { listMessages } = await import("../runtime/session/message.js");
          const { listParts } = await import("../runtime/session/part.js");
          const msgs = listMessages(db, session.id);
          for (const msg of msgs) {
            const parts = listParts(db, msg.id);
            const text = parts
              .filter((p) => p.type === "text")
              .map((p) => p.content ?? "")
              .join("");
            if (!text) continue;
            if (msg.role === "user") {
              console.log(chalk.bold("You: ") + text);
            } else {
              console.log(chalk.green("Agent: ") + text);
            }
          }
          if (msgs.length > 0) console.log("");
        }

        // REPL loop
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
          terminal: true,
          prompt: chalk.bold("You: "),
        });

        rl.prompt();

        rl.on("line", async (line: string) => {
          const input = line.trim();
          if (!input) {
            rl.prompt();
            return;
          }

          // Built-in commands
          if (input === "/exit" || input === "/quit") {
            console.log(chalk.dim("\nSession saved. Goodbye!"));
            rl.close();
            db.close();
            process.exit(0);
          }

          if (input === "/sessions") {
            const sessions = listSessions(db, slug, { state: "active", limit: 10 });
            console.log(chalk.bold("\nActive sessions:"));
            for (const s of sessions) {
              const marker = s.id === session.id ? chalk.green(" ← current") : "";
              console.log(
                `  ${chalk.dim(s.id)}  agent=${s.agentId}  ${chalk.dim(s.createdAt.toISOString())}${marker}`,
              );
            }
            console.log("");
            rl.prompt();
            return;
          }

          if (input === "/help") {
            console.log(chalk.bold("\nCommands:"));
            console.log("  /exit, /quit  — end the session");
            console.log("  /sessions     — list active sessions");
            console.log("  /help         — show this help");
            console.log("");
            rl.prompt();
            return;
          }

          // Pause readline while the agent is thinking
          rl.pause();
          process.stdout.write(chalk.green("Agent: "));

          try {
            const result = await runPromptLoop({
              db,
              instanceSlug: slug,
              sessionId: session.id,
              userText: input,
              agentConfig: agentCfg,
              resolvedModel: resolvedModelObj,
              workDir: stateDir,
            });

            // runPromptLoop streams internally but we print the final text here
            // (streaming to stdout is handled via bus events in a future step)
            console.log(result.text);
            console.log(
              chalk.dim(
                `  [${result.tokens.input}→${result.tokens.output} tokens, ${result.steps} step(s), $${result.costUsd.toFixed(6)}]`,
              ),
            );
            console.log("");
          } catch (err) {
            console.log(chalk.red(`\n[Error] ${err instanceof Error ? err.message : String(err)}`));
          }

          rl.resume();
          rl.prompt();
        });

        rl.on("close", () => {
          console.log(chalk.dim("\nSession saved. Goodbye!"));
          db.close();
          process.exit(0);
        });
      },
    );
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
  cmd.addCommand(runtimeChatCommand());
  cmd.addCommand(runtimeConfigCommand());

  return cmd;
}
