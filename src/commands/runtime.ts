// src/commands/runtime.ts
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { spawn } from "node:child_process";
import { Command } from "commander";
import chalk from "chalk";
import { logger, configureLogger } from "../lib/logger.js";
import { parseBracketedPaste, type PasteState } from "./_bracketed-paste.js";
import { rotateLogs } from "../lib/log-rotate.js";
import {
  getRuntimeStateDir,
  getDbPath,
  getRuntimePidPath,
  getRuntimePid,
  isRuntimeRunning,
} from "../lib/platform.js";
import { initDatabase } from "../db/schema.js";
import { ensureMasterEncryptionKey } from "../lib/crypto.js";
import { bootstrapSecretProvider } from "../core/secrets/bootstrap.js";
import { bootstrapAuditBus, shutdownAuditBus } from "../core/audit/index.js";
import { NullPluginVerifier, registerPluginVerifier } from "../runtime/plugin/verifier.js";
import { LocalConnection } from "../server/local.js";
import { bootstrapServerRegistry } from "../server/registry.js";
import {
  ClawRuntime,
  loadRuntimeConfig,
  saveRuntimeConfig,
  ensureRuntimeConfig,
  runtimeConfigExists,
  exportRuntimeJsonSnapshot,
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
import { getDataDir } from "../lib/platform.js";
import { Registry } from "../core/registry.js";
import { CommunityProfileResolver } from "../runtime/profile/community-resolver.js";
import { injectNamedKeyForCli } from "./_named-key-inject.js";
import { NamedKeyRepository } from "../core/repositories/named-key-repository.js";
import type { RuntimeConfig } from "../runtime/index.js";

/**
 * Load RuntimeConfig from DB first, then fallback to runtime.json.
 * If loaded from file, backfill the DB for next time.
 * Returns null if no config found anywhere.
 */
function loadConfigFromDbOrFile(
  db: ReturnType<typeof initDatabase>,
  slug: string,
  stateDir: string,
): RuntimeConfig | null {
  const reg = new Registry(db);

  // 1. Try DB (source of truth since v21)
  const fromDb = reg.getRuntimeConfig(slug);
  if (fromDb) return fromDb;

  // 2. Fallback to file
  if (!runtimeConfigExists(stateDir)) return null;
  const fromFile = loadRuntimeConfig(stateDir);

  // 3. Backfill DB
  reg.saveRuntimeConfig(slug, fromFile);
  logger.info(`[runtime] Backfilled runtime config to DB for "${slug}"`);

  return fromFile;
}

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
      const db = initDatabase(getDbPath());

      let config;
      try {
        config = loadConfigFromDbOrFile(db, slug, stateDir);
      } catch (err) {
        logger.error(
          `Failed to load runtime config: ${err instanceof Error ? err.message : String(err)}`,
        );
        db.close();
        process.exit(1);
      }

      if (!config) {
        logger.error(`No runtime config found for instance "${slug}" (checked DB and file).`);
        logger.error(`Run: claw-pilot runtime config init ${slug}`);
        db.close();
        process.exit(1);
      }

      db.close();

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
  } catch (err) {
    logger.debug("[runtime-cmd] .env file read failed", { error: String(err) });
    // .env missing or unreadable — not fatal
  }
}

// ---------------------------------------------------------------------------
// runtime start helpers
// ---------------------------------------------------------------------------

/** Spawn a detached daemon process and poll for its PID file. */
async function spawnDaemon(slug: string, stateDir: string, ensureConfig: boolean): Promise<void> {
  if (isRuntimeRunning(stateDir)) {
    const pid = getRuntimePid(stateDir);
    logger.warn(`claw-runtime for "${slug}" is already running (PID ${pid}).`);
    process.exit(0);
  }

  const nodeArgs = [
    ...process.argv.slice(1),
    "runtime",
    "start",
    slug,
    ...(ensureConfig ? ["--ensure-config"] : []),
  ];

  const logDir = `${stateDir}/logs`;
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = `${logDir}/runtime.log`;
  const useNohup = process.platform !== "darwin" && process.platform !== "win32";
  const [cmd, args] = useNohup
    ? ["nohup", [process.execPath, ...nodeArgs]]
    : [process.execPath, nodeArgs];
  const logFd = process.platform === "darwin" ? "ignore" : fs.openSync(logFile, "a");

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

  logger.warn(`claw-runtime started (slug: ${slug}) — PID file not yet available at ${pidPath}`);
  process.exit(0);
}

/** Start the runtime in foreground mode (blocking). */
async function startForeground(
  slug: string,
  stateDir: string,
  ensureConfig: boolean,
): Promise<void> {
  // Load environment variables from .env file
  loadEnvFile(stateDir);

  // Bootstrap the SecretProvider before any consumer reads a secret
  // (MASTER_ENCRYPTION_KEY, channel tokens). Uses the global data dir so
  // the master key is persisted to ~/.claw-pilot/.env (shared across
  // instances), matching the pre-H4 behaviour. Per-instance secrets
  // (bot tokens) are already loaded into process.env by loadEnvFile()
  // above, so the env provider resolves them without a file round-trip.
  bootstrapSecretProvider();

  // Ensure master encryption key is available (for named API key decryption)
  await ensureMasterEncryptionKey();

  // Open DB early so we can read config from it
  const db = initDatabase(getDbPath());

  // Register the ServerRegistry (H3) — the daemon has its own lifecycle and
  // bypasses withContext(), so the registration done there doesn't apply here.
  // Without this, plugin tool hooks throw "ServerRegistry not registered".
  const conn = new LocalConnection();
  bootstrapServerRegistry(db, conn);

  // Register the default audit sinks (file + db). Runtime-only events
  // (tool calls) land in rt_audit_events and in the daily JSONL file.
  bootstrapAuditBus(db);
  registerPluginVerifier(new NullPluginVerifier());

  // Load config: DB first, then file fallback, then create default
  const config = loadOrCreateConfig(db, slug, stateDir, ensureConfig);

  // Apply log config before any further logging
  configureLogger({ level: config.log.level, format: config.log.format });

  // Rotate log file if needed (before writing anything)
  const logFile = `${stateDir}/logs/runtime.log`;
  rotateLogs(logFile, config.log.maxSizeMb, config.log.maxFiles);

  // Export runtime.json snapshot for debugging
  exportRuntimeJsonSnapshot(stateDir, config);

  // Load user-level .env (shared across instances) — if it exists
  const userEnvDir = getDataDir();
  loadEnvFile(userEnvDir);

  const profileResolver = new CommunityProfileResolver(new Registry(db).userProfiles);
  const runtime = new ClawRuntime(config, db, slug, stateDir, profileResolver);

  // Write PID file so lifecycle/health can detect us
  const pidPath = getRuntimePidPath(stateDir);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(pidPath, String(process.pid), "utf8");

  // Graceful shutdown on SIGTERM / SIGINT
  registerShutdownHandlers(runtime, db, pidPath);

  logger.info(`Starting claw-runtime for "${slug}"...`);
  logger.dim(`Model: ${config.defaultModel}`);
  logger.dim(`Agents: ${config.agents.map((a: RuntimeAgentConfig) => a.id).join(", ") || "none"}`);

  try {
    await runtime.start();
  } catch (err) {
    logger.error(`Failed to start runtime: ${err instanceof Error ? err.message : String(err)}`);
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
}

/** Load config from DB/file or create default if ensureConfig is set. */
function loadOrCreateConfig(
  db: ReturnType<typeof initDatabase>,
  slug: string,
  stateDir: string,
  ensureConfig: boolean,
): RuntimeConfig {
  const fromDb = loadConfigFromDbOrFile(db, slug, stateDir);
  if (fromDb) return fromDb;

  if (ensureConfig) {
    const config = ensureRuntimeConfig(stateDir);
    new Registry(db).saveRuntimeConfig(slug, config);
    return config;
  }

  logger.error(`No runtime config found for instance "${slug}" (checked DB and file).`);
  logger.error(`Run: claw-pilot runtime config init ${slug}`);
  db.close();
  process.exit(1);
}

/** Register SIGTERM/SIGINT handlers for graceful shutdown. */
function registerShutdownHandlers(
  runtime: ClawRuntime,
  db: ReturnType<typeof initDatabase>,
  pidPath: string,
): void {
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
      try {
        fs.unlinkSync(pidPath);
      } catch (err) {
        logger.debug("[runtime-cmd] PID file cleanup failed", { error: String(err) });
      }
      await shutdownAuditBus();
      db.close();
      process.exit(0);
    }
  };

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
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

      if (opts.daemon) {
        await spawnDaemon(slug, stateDir, opts.ensureConfig === true);
        return;
      }

      await startForeground(slug, stateDir, opts.ensureConfig === true);
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
        } catch (err) {
          logger.debug("[runtime-cmd] SIGTERM send failed", { error: String(err) });
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
// runtime chat helpers
// ---------------------------------------------------------------------------

interface ChatContext {
  slug: string;
  stateDir: string;
  db: ReturnType<typeof initDatabase>;
  agentCfg: RuntimeAgentConfig;
  resolvedModelObj: ReturnType<typeof resolveModel>;
  agentWorkDir: string;
  sessionId: string;
}

/** Print a chat response with token/cost info. */
function printChatResponse(result: {
  text: string;
  tokens: { input: number; output: number };
  steps: number;
  costUsd: number;
}): void {
  console.log(result.text);
  console.log(
    chalk.dim(
      `  [${result.tokens.input}→${result.tokens.output} tokens, ${result.steps} step(s), $${result.costUsd.toFixed(6)}]`,
    ),
  );
}

/** Handle a single chat line from the REPL. */
async function handleChatLine(
  input: string,
  ctx: ChatContext,
  rl: readline.Interface,
): Promise<boolean> {
  if (!input) {
    rl.prompt();
    return false;
  }

  // Built-in commands
  if (input === "/exit" || input === "/quit") {
    console.log(chalk.dim("\nSession saved. Goodbye!"));
    rl.close();
    ctx.db.close();
    process.exit(0);
  }

  if (input === "/sessions") {
    const sessions = listSessions(ctx.db, ctx.slug, { state: "active", limit: 10 });
    console.log(chalk.bold("\nActive sessions:"));
    for (const s of sessions) {
      const marker = s.id === ctx.sessionId ? chalk.green(" ← current") : "";
      console.log(
        `  ${chalk.dim(s.id)}  agent=${s.agentId}  ${chalk.dim(s.createdAt.toISOString())}${marker}`,
      );
    }
    console.log("");
    rl.prompt();
    return false;
  }

  if (input === "/help") {
    console.log(chalk.bold("\nCommands:"));
    console.log("  /exit, /quit  — end the session");
    console.log("  /sessions     — list active sessions");
    console.log("  /help         — show this help");
    console.log("");
    rl.prompt();
    return false;
  }

  // Agent interaction
  rl.pause();
  process.stdout.write(chalk.green("Agent: "));

  try {
    const result = await runPromptLoop({
      db: ctx.db,
      instanceSlug: ctx.slug,
      sessionId: ctx.sessionId,
      userText: input,
      agentConfig: ctx.agentCfg,
      resolvedModel: ctx.resolvedModelObj,
      workDir: ctx.stateDir,
      agentWorkDir: ctx.agentWorkDir,
    });

    printChatResponse(result);
    console.log("");
  } catch (err) {
    console.log(chalk.red(`\n[Error] ${err instanceof Error ? err.message : String(err)}`));
  }

  rl.resume();
  rl.prompt();
  return false;
}

/** Set up and run the chat REPL loop. */
function setupChatRepl(ctx: ChatContext): void {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    prompt: chalk.bold("You: "),
  });

  // Enable bracketed paste mode so multiline pastes are treated as a
  // single message instead of one message per line.
  const supportsBracketedPaste = process.stdout.isTTY && process.env["TERM"] !== "dumb";
  if (supportsBracketedPaste) {
    process.stdout.write("\x1b[?2004h");
  }

  let pasteState: PasteState = { inPaste: false, buffer: "" };
  let suppressNextLines = 0; // lines to ignore from readline while in paste

  if (supportsBracketedPaste) {
    // Intercept raw stdin chunks before readline processes them.
    // When a paste sequence is detected, we accumulate and suppress
    // the individual readline "line" events that would otherwise fire.
    process.stdin.on("data", (chunk: Buffer) => {
      const str = chunk.toString("utf8");
      const result = parseBracketedPaste(str, pasteState);
      pasteState = result.state;

      if (result.state.inPaste) {
        // Count newlines in the current chunk — readline will emit that
        // many spurious "line" events which we must suppress.
        suppressNextLines += (str.match(/\n/g) ?? []).length;
      }

      if (result.complete && result.text !== undefined) {
        // Suppress readline lines generated by this paste
        const pastedLines = (result.text.match(/\n/g) ?? []).length;
        suppressNextLines += pastedLines;
        void handleChatLine(result.text.trim(), ctx, rl);
      }
    });
  }

  rl.prompt();

  rl.on("line", (line: string) => {
    if (suppressNextLines > 0) {
      suppressNextLines--;
      return;
    }
    void handleChatLine(line.trim(), ctx, rl);
  });

  rl.on("close", () => {
    if (supportsBracketedPaste) {
      process.stdout.write("\x1b[?2004l"); // disable bracketed paste
    }
    console.log(chalk.dim("\nSession saved. Goodbye!"));
    ctx.db.close();
    process.exit(0);
  });
}

// ---------------------------------------------------------------------------
// runtime chat <slug>
// ---------------------------------------------------------------------------

/** Resolve agent config and model from options and runtime config. */
function resolveAgentAndModel(
  config: RuntimeConfig,
  opts: { agent?: string; model?: string },
): {
  agentId: string;
  agentCfg: RuntimeAgentConfig;
  resolvedModelObj: ReturnType<typeof resolveModel>;
} {
  const agentId = opts.agent ?? defaultAgentName();
  const agentInfo = getAgent(agentId);
  if (!agentInfo) {
    logger.error(`Agent "${agentId}" not found.`);
    process.exit(1);
  }

  const agentCfg: RuntimeAgentConfig = config.agents.find((a) => a.id === agentId) ?? {
    id: agentInfo.name,
    name: agentInfo.name,
    model: opts.model ?? agentInfo.model ?? config.defaultModel,
    permissions: agentInfo.permission ?? [],
    maxSteps: agentInfo.steps ?? 20,
    allowSubAgents: true,
    toolProfile: "executor",
    isDefault: false,
    inheritWorkspace: true,
  };

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

  return { agentId, agentCfg, resolvedModelObj };
}

/** Print previous messages when resuming a session. */
async function printSessionHistory(
  db: ReturnType<typeof initDatabase>,
  sessionId: string,
): Promise<void> {
  const { listMessages } = await import("../runtime/session/message.js");
  const { listParts } = await import("../runtime/session/part.js");
  const msgs = listMessages(db, sessionId);
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
        const db = initDatabase(getDbPath());

        // Load config: DB first, then file fallback
        const config = loadOrCreateConfig(db, slug, stateDir, opts.ensureConfig === true);

        // Inject Named API Key into process.env if the instance uses one and the
        // env var is not already set. This allows `runtime chat` to work without
        // manually exporting ANTHROPIC_API_KEY when the key is stored in the DB.
        {
          const instanceRow = db
            .prepare("SELECT id, default_named_key_id FROM instances WHERE slug = ?")
            .get(slug) as { id: number; default_named_key_id: number | null } | undefined;

          if (instanceRow?.default_named_key_id != null) {
            const namedKeyRepo = new NamedKeyRepository(db);
            const defaultKey = namedKeyRepo.getDefaultKeyForInstance(instanceRow.id);
            if (defaultKey) {
              injectNamedKeyForCli({
                providerId: defaultKey.providerId,
                apiKey: defaultKey.apiKey,
              });
            }
          }
        }

        // Init agent registry
        const { initAgentRegistry } = await import("../runtime/agent/registry.js");
        initAgentRegistry(config.agents);

        // Resolve agent and model
        const { agentId, agentCfg, resolvedModelObj } = resolveAgentAndModel(config, opts);

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

        const agentWorkDir = resolveAgentWorkspacePath(stateDir, agentId, undefined);

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
              agentWorkDir,
            });
            printChatResponse(result);
          } catch (err) {
            console.log(chalk.red(`\n[Error] ${err instanceof Error ? err.message : String(err)}`));
            db.close();
            process.exit(1);
          }
          db.close();
          process.exit(0);
        }

        // Print header
        const modelStr = opts.model ?? agentCfg.model;
        console.log(chalk.bold(`\nclaw-runtime chat — ${slug}`));
        console.log(
          `  Agent : ${chalk.cyan(agentId)}   Model : ${chalk.cyan(modelStr)}   Session : ${chalk.dim(session.id)}`,
        );
        console.log(chalk.dim("  Type your message and press Enter. Ctrl+C or /exit to quit.\n"));

        // List previous messages if resuming
        if (opts.session) {
          await printSessionHistory(db, session.id);
        }

        // Start REPL
        setupChatRepl({
          slug,
          stateDir,
          db,
          agentCfg,
          resolvedModelObj,
          agentWorkDir,
          sessionId: session.id,
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
