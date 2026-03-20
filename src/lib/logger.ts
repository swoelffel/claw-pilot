// src/lib/logger.ts
import chalk from "chalk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFormat = "text" | "json";

// ---------------------------------------------------------------------------
// Singleton state (configurable at runtime startup via configureLogger)
// ---------------------------------------------------------------------------

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let _level: LogLevel = "info";
let _format: LogFormat = "text";

/** Configure the global logger. Call once at process startup before any logging. */
export function configureLogger(cfg: { level: LogLevel; format: LogFormat }): void {
  _level = cfg.level;
  _format = cfg.format;
}

/** Expose current config (for tests and introspection). */
export function getLoggerConfig(): { level: LogLevel; format: LogFormat } {
  return { level: _level, format: _format };
}

// ---------------------------------------------------------------------------
// Core emit function
// ---------------------------------------------------------------------------

function shouldLog(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[_level];
}

function emitJson(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...ctx,
  };
  process.stdout.write(JSON.stringify(entry) + "\n");
}

function emitText(level: LogLevel, msg: string): void {
  switch (level) {
    case "debug":
      console.log(chalk.dim(`    ${msg}`));
      break;
    case "info":
      console.log(`${chalk.green("[+]")} ${msg}`);
      break;
    case "warn":
      console.warn(`${chalk.yellow("[!]")} ${msg}`);
      break;
    case "error":
      console.error(`${chalk.red("[x]")} ${msg}`);
      break;
  }
}

function emit(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  if (_format === "json") {
    emitJson(level, msg, ctx);
  } else {
    emitText(level, msg);
  }
}

// ---------------------------------------------------------------------------
// Public logger API
// ---------------------------------------------------------------------------

export const logger = {
  // --- Levelled methods (accept optional structured context) ---

  debug(msg: string, ctx?: Record<string, unknown>): void {
    emit("debug", msg, ctx);
  },

  info(msg: string, ctx?: Record<string, unknown>): void {
    emit("info", msg, ctx);
  },

  warn(msg: string, ctx?: Record<string, unknown>): void {
    emit("warn", msg, ctx);
  },

  error(msg: string, ctx?: Record<string, unknown>): void {
    emit("error", msg, ctx);
  },

  // --- Visual helper methods (text mode: distinct prefixes; JSON mode: mapped to a level) ---

  /** Sub-step indicator. Text: cyan "  →". JSON: level=info. */
  step(msg: string): void {
    if (!shouldLog("info")) return;
    if (_format === "json") {
      emitJson("info", msg);
    } else {
      console.log(`${chalk.cyan("  →")} ${msg}`);
    }
  },

  /** Dimmed context line. Text: gray "    ". JSON: level=debug. */
  dim(msg: string): void {
    if (!shouldLog("debug")) return;
    if (_format === "json") {
      emitJson("debug", msg);
    } else {
      console.log(chalk.dim(`    ${msg}`));
    }
  },

  /** Success confirmation. Text: green "  ✓". JSON: level=info. */
  success(msg: string): void {
    if (!shouldLog("info")) return;
    if (_format === "json") {
      emitJson("info", msg);
    } else {
      console.log(`${chalk.green("  ✓")} ${msg}`);
    }
  },

  /** Failure indicator. Text: red "  ✗". JSON: level=error. */
  fail(msg: string): void {
    if (!shouldLog("error")) return;
    if (_format === "json") {
      emitJson("error", msg);
    } else {
      console.log(`${chalk.red("  ✗")} ${msg}`);
    }
  },
};
