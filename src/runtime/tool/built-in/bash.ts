/**
 * runtime/tool/built-in/bash.ts
 *
 * Bash tool — executes shell commands with timeout and abort support.
 */

import { z } from "zod";
import { spawn } from "node:child_process";
import { Tool } from "../tool.js";
import { logger } from "../../../lib/logger.js";

const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

/** Paths that are always allowed (system binaries, temp) */
const ALLOWED_PATH_PREFIXES = ["/usr/", "/bin/", "/sbin/", "/lib/", "/tmp/", "/var/tmp/"];

/**
 * Detect absolute paths in a shell command that are outside the working directory.
 * Returns paths that are not under workDir and not in the allowed system prefixes.
 */
export function detectExternalPaths(command: string, workDir: string): string[] {
  const absolutePathRegex = /(?:^|\s)(\/[^\s;|&><'"]+)/g;
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = absolutePathRegex.exec(command)) !== null) {
    const p = match[1];
    if (!p) continue;
    if (p.startsWith(workDir)) continue;
    if (ALLOWED_PATH_PREFIXES.some((prefix) => p.startsWith(prefix))) continue;
    found.add(p);
  }
  return [...found];
}

export const BashTool = Tool.define("bash", {
  ownerOnly: true,
  description:
    "Executes a given bash command in a persistent shell session with optional timeout. " +
    "Use the workdir parameter to change directories instead of 'cd' commands. " +
    "AVOID using bash with find, grep, cat, head, tail, sed, awk — use the dedicated tools instead.",
  parameters: z.object({
    command: z.string().describe("The command to execute"),
    description: z
      .string()
      .describe(
        "Clear, concise description of what this command does in 5-10 words. " +
          "Examples:\nInput: ls\nOutput: Lists files in current directory\n\n" +
          "Input: git status\nOutput: Shows working tree status",
      ),
    timeout: z.number().int().positive().optional().describe("Optional timeout in milliseconds"),
    workdir: z
      .string()
      .optional()
      .describe(
        "The working directory to run the command in. Defaults to the instance state directory. " +
          "Use this instead of 'cd' commands.",
      ),
  }),
  async execute(params, ctx) {
    const cwd = params.workdir ?? ctx.workDir ?? process.cwd();
    const timeout = params.timeout ?? DEFAULT_TIMEOUT_MS;

    // Block sub-agents from accessing paths outside workDir
    if (ctx.senderIsOwner === false) {
      const externalPaths = detectExternalPaths(params.command, cwd);
      if (externalPaths.length > 0) {
        return {
          title: params.description,
          output: `Access denied: command accesses path(s) outside workspace '${cwd}': ${externalPaths.join(", ")}. Sub-agents cannot access external directories.`,
          truncated: false,
        };
      }
    }

    if (ctx.abort.aborted) {
      return {
        title: params.description,
        output: "<bash_metadata>\nUser aborted the command\n</bash_metadata>",
        truncated: false,
      };
    }

    const proc = spawn(params.command, {
      shell: true,
      // A dedicated process group lets cancellation reach shell descendants.
      detached: process.platform !== "win32",
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    let timedOut = false;
    let aborted = false;
    let termination: Promise<void> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const signalTree = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && proc.pid) {
          process.kill(-proc.pid, signal);
        } else {
          proc.kill(signal);
        }
      } catch (err) {
        logger.debug("[tool:bash] process group signal failed", { error: String(err) });
      }
    };

    const terminate = () => {
      if (termination) return;
      // Keep the escalation alive even if the shell exits immediately: a
      // descendant may ignore TERM and may have closed its inherited pipes.
      termination = new Promise<void>((resolve) => {
        signalTree("SIGTERM");
        setTimeout(() => {
          signalTree("SIGKILL");
          resolve();
        }, 500);
      });
    };

    proc.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    const abortHandler = () => {
      aborted = true;
      terminate();
    };

    // Register process listeners before cancellation can terminate the command.
    const completion = new Promise<void>((resolve, reject) => {
      proc.once("close", () => resolve());
      proc.once("error", reject);
    });
    ctx.abort.addEventListener("abort", abortHandler, { once: true });
    // Close the check/listener race (including aborts during spawn).
    if (ctx.abort.aborted) abortHandler();
    timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeout);

    try {
      await completion;
      await termination;
    } finally {
      clearTimeout(timer);
      ctx.abort.removeEventListener("abort", abortHandler);
    }

    const meta: string[] = [];
    if (timedOut) meta.push(`Command terminated after exceeding timeout ${timeout} ms`);
    if (aborted) meta.push("User aborted the command");
    if (meta.length > 0) {
      output += "\n\n<bash_metadata>\n" + meta.join("\n") + "\n</bash_metadata>";
    }

    return {
      title: params.description,
      output,
      truncated: false,
    };
  },
});
