// src/commands/runtime.ts
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { spawn } from "node:child_process";
import { Command } from "commander";
import chalk from "chalk";
import { logger, configureLogger } from "../lib/logger.js";
import { rotateLogs } from "../lib/log-rotate.js";
import {
  getRuntimeStateDir,
  getDbPath,
  getRuntimePidPath,
  getRuntimePid,
  isRuntimeRunning,
} from "../lib/platform.js";
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
import { resolveAgentWorkspacePath } from "../core/agent-workspace.js";
import { UserProfileRepository } from "../core/repositories/user-profile-repository.js";
import { CommunityProfileResolver } from "../runtime/profile/community-resolver.js";
import { getDataDir } from "../lib/platform.js";

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
      const stateDir = getRuntimeStateDir(slug);

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
      const stateDir = getRuntimeStateDir(slug);

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
// Helper: Load .env file into process.env
// ---------------------------------------------------------------------------

function loadEnvFile(stateDir: string): void {
  const envPath = path.join(stateDir, ".env");
  try {
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (key && value) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env missing or unreadable — not fatal
  }
}

// ---------------------------------------------------------------------------
// runtime start <slug>
// ---------------------------------------------------------------------------

function runtimeStartCommand(): Command {
  return new Command("start")
    .description("Start the claw-runtime engine for an instance")
    .argument("<slug>", "Instance slug")
    .option("--ensure-config", "Create runtime.json with defaults if it does not exist")
    .option(
      "-d, --daemon",
      "Run as a detached background daemon (writes PID to <stateDir>/runtime.pid)",
    )
    .action(async (slug: string, opts: { ensureConfig?: boolean; daemon?: boolean }) => {
      const stateDir = getRuntimeStateDir(slug);

      // --daemon: spawn a detached child and exit immediately
      if (opts.daemon) {
        if (isRuntimeRunning(stateDir)) {
          const pid = getRuntimePid(stateDir);
          logger.warn(`claw-runtime for "${slug}" is already running (PID ${pid}).`);
          process.exit(0);
        }

        // Re-invoke the same binary without --daemon so the child runs in foreground
        const nodeArgs = [
          ...process.argv.slice(1), // keep the script path
          "runtime",
          "start",
          slug,
          ...(opts.ensureConfig ? ["--ensure-config"] : []),
        ];

        // On Linux (including Docker), use nohup to fully detach the child from
        // the controlling terminal. Without this, Docker kills the child when the
        // docker exec session ends (even with detached:true + setsid).
        // Stdout/stderr are redirected to <stateDir>/logs/runtime.log.
        const logDir = `${stateDir}/logs`;
        fs.mkdirSync(logDir, { recursive: true });
        const logFile = `${logDir}/runtime.log`;
        const isDarwinPlatform = process.platform === "darwin";
        const [cmd, args] = isDarwinPlatform
          ? [process.execPath, nodeArgs]
          : ["nohup", [process.execPath, ...nodeArgs]];
        const logFd = isDarwinPlatform ? "ignore" : fs.openSync(logFile, "a");

        const child = spawn(cmd, args, {
          detached: true,
          stdio: ["ignore", logFd, logFd],
        });

        child.unref();

        // Poll for PID file to appear (up to 5 s)
        const pidPath = getRuntimePidPath(stateDir);
        const deadline = Date.now() + 5_000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 200));
          if (isRuntimeRunning(stateDir)) {
            const pid = getRuntimePid(stateDir);
            logger.success(`claw-runtime started (slug: ${slug}, PID: ${pid})`);
            process.exit(0);
          }
        }

        // Fallback: PID file not yet written but child may still be starting
        logger.warn(
          `claw-runtime started (slug: ${slug}) — PID file not yet available at ${pidPath}`,
        );
        process.exit(0);
      }

      // --- Foreground mode (default) ---

      // Load environment variables from .env file
      loadEnvFile(stateDir);

      // Load or create config
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
          logger.error(`Invalid runtime.json: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
      }

      // Apply log config before any further logging
      configureLogger({ level: config.log.level, format: config.log.format });

      // Rotate log file if needed (before writing anything)
      const logFile = `${stateDir}/logs/runtime.log`;
      rotateLogs(logFile, config.log.maxSizeMb, config.log.maxFiles);

      if (opts.ensureConfig) {
        logger.info(`Config loaded from ${stateDir}/runtime.json`);
      }

      // Open DB
      const db = initDatabase(getDbPath());

      // Load user-level .env (shared across instances) — if it exists
      const userEnvDir = getDataDir();
      loadEnvFile(userEnvDir);

      // Merge user profile providers/models into instance config (profile = fallback base)
      const profileResolver = new CommunityProfileResolver(new UserProfileRepository(db));
      const profile = profileResolver.getActiveProfile();
      if (profile) {
        const userProviders = profileResolver.getProviders();
        const userAliases = profileResolver.getModelAliases();
        if (userProviders.length > 0 || userAliases.length > 0 || profile.defaultModel) {
          const { mergeProviderConfig } = await import("../runtime/provider/config-merge.js");
          config = mergeProviderConfig(
            config,
            userProviders,
            userAliases,
            profile.defaultModel ?? undefined,
          );
        }
      }

      const runtime = new ClawRuntime(config, db, slug, stateDir, profileResolver);

      // Write PID file so lifecycle/health can detect us
      const pidPath = getRuntimePidPath(stateDir);
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(pidPath, String(process.pid), "utf8");

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
          // Remove PID file on clean exit
          try {
            fs.unlinkSync(pidPath);
          } catch {
            /* already gone */
          }
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
        // Do NOT remove the PID file here — the lifecycle poller uses its presence
        // to detect a premature exit. The shutdown handler will clean it up on SIGTERM.
        // Removing it here would cause a race where the poller misses the crash window.
        db.close();
        process.exit(1);
      }

      logger.success(`Runtime running (slug: ${slug}, PID: ${process.pid})`);

      if (config.webChat.enabled) {
        logger.step("Web chat channel: active");
      }
      if (config.telegram.enabled) {
        logger.step("Telegram channel: active");
      }

      logger.dim("Press Ctrl+C or send SIGTERM to stop.");

      // Keep process alive — channels hold their own event loops (WS server, polling)
      await new Promise<void>((resolve) => {
        process.once("beforeExit", resolve);
      });
    });
}

// ---------------------------------------------------------------------------
// runtime stop <slug>
// ---------------------------------------------------------------------------

function runtimeStopCommand(): Command {
  return new Command("stop")
    .description("Stop a running claw-runtime daemon")
    .argument("<slug>", "Instance slug")
    .option("--timeout <ms>", "Max wait time in ms for the process to exit", "5000")
    .action(async (slug: string, opts: { timeout: string }) => {
      const stateDir = getRuntimeStateDir(slug);
      const pid = getRuntimePid(stateDir);

      if (!pid) {
        logger.warn(`claw-runtime for "${slug}" is not running (no PID file or process gone).`);
        process.exit(0);
      }

      logger.info(`Stopping claw-runtime for "${slug}" (PID ${pid})...`);

      try {
        process.kill(pid, "SIGTERM");
      } catch (err) {
        logger.error(
          `Failed to send SIGTERM to PID ${pid}: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }

      // Poll until the process is gone
      const timeoutMs = parseInt(opts.timeout, 10) || 5_000;
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
        if (!isRuntimeRunning(stateDir)) {
          logger.success(`claw-runtime stopped (slug: ${slug}).`);
          process.exit(0);
        }
      }

      logger.error(
        `claw-runtime (PID ${pid}) did not stop within ${timeoutMs}ms. Try SIGKILL manually.`,
      );
      process.exit(1);
    });
}

// ---------------------------------------------------------------------------
// runtime restart <slug>
// ---------------------------------------------------------------------------

function runtimeRestartCommand(): Command {
  return new Command("restart")
    .description("Restart a claw-runtime daemon (stop + start --daemon)")
    .argument("<slug>", "Instance slug")
    .option("--ensure-config", "Create runtime.json with defaults if it does not exist")
    .option("--timeout <ms>", "Max wait time in ms for stop", "5000")
    .action(async (slug: string, opts: { ensureConfig?: boolean; timeout: string }) => {
      const stateDir = getRuntimeStateDir(slug);
      const pid = getRuntimePid(stateDir);

      if (pid) {
        logger.info(`Stopping claw-runtime for "${slug}" (PID ${pid})...`);
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // Process may have already exited
        }

        const timeoutMs = parseInt(opts.timeout, 10) || 5_000;
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 200));
          if (!isRuntimeRunning(stateDir)) break;
        }

        if (isRuntimeRunning(stateDir)) {
          logger.error(`claw-runtime (PID ${pid}) did not stop within ${timeoutMs}ms.`);
          process.exit(1);
        }
        logger.success(`claw-runtime stopped.`);
      } else {
        logger.dim(`claw-runtime for "${slug}" was not running — starting fresh.`);
      }

      // Start as daemon
      const args = [
        ...process.argv.slice(1),
        "runtime",
        "start",
        "--daemon",
        slug,
        ...(opts.ensureConfig ? ["--ensure-config"] : []),
      ];

      const child = spawn(process.execPath, args, {
        detached: true,
        stdio: "ignore",
      });
      child.unref();

      // Poll for PID file
      const deadline2 = Date.now() + 5_000;
      while (Date.now() < deadline2) {
        await new Promise((r) => setTimeout(r, 200));
        if (isRuntimeRunning(stateDir)) {
          const newPid = getRuntimePid(stateDir);
          logger.success(`claw-runtime restarted (slug: ${slug}, PID: ${newPid})`);
          process.exit(0);
        }
      }

      logger.warn(`claw-runtime restarted (slug: ${slug}) — PID file not yet available.`);
      process.exit(0);
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
        const stateDir = getRuntimeStateDir(slug);

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
          inheritWorkspace: true,
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
          const agentWorkDir = resolveAgentWorkspacePath(stateDir, agentId, undefined);
          try {
            const result = await runPromptLoop({
              db,
              instanceSlug: slug,
              sessionId: session.id,
              userText: opts.once,
              agentConfig: agentCfg,
              resolvedModel: resolvedModelObj,
              workDir: stateDir,
              agentWorkDir,
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

        // Resolve agent workspace directory once for the whole REPL session
        const agentWorkDir = resolveAgentWorkspacePath(stateDir, agentId, undefined);

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
              agentWorkDir,
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
  cmd.addCommand(runtimeStopCommand());
  cmd.addCommand(runtimeRestartCommand());
  cmd.addCommand(runtimeStatusCommand());
  cmd.addCommand(runtimeChatCommand());
  cmd.addCommand(runtimeConfigCommand());

  return cmd;
}
