/**
 * lib/process.ts
 *
 * Cross-platform utilities for process tree management.
 */

import { execSync } from "node:child_process";
import * as os from "node:os";

/**
 * Returns the PIDs of all descendant processes of the given PID.
 *
 * On Linux: reads /proc/<pid>/task/<tid>/children recursively.
 * On macOS: uses `pgrep -P <pid>` via execSync.
 *
 * Returns an empty array if the process is not found, the platform is
 * unsupported, or any error occurs (best-effort, never throws).
 */
export async function getDescendants(pid: number): Promise<number[]> {
  const platform = os.platform();

  try {
    if (platform === "linux") {
      return getDescendantsLinux(pid);
    } else if (platform === "darwin") {
      return getDescendantsDarwin(pid);
    }
    // Unsupported platform — return empty (best-effort)
    return [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Linux: read /proc/<pid>/task/<tid>/children recursively
// ---------------------------------------------------------------------------

function getDescendantsLinux(pid: number): number[] {
  const result: number[] = [];
  collectLinux(pid, result);
  return result;
}

function collectLinux(pid: number, acc: number[]): void {
  try {
    // Each task directory may have a "children" file listing direct child PIDs
    const taskDir = `/proc/${pid}/task`;
    const tids = readdirSafe(taskDir);

    for (const tid of tids) {
      const childrenPath = `${taskDir}/${tid}/children`;
      const content = readFileSafe(childrenPath);
      if (!content) continue;

      const childPids = content
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(Number)
        .filter((n) => !isNaN(n) && n > 0);

      for (const childPid of childPids) {
        acc.push(childPid);
        collectLinux(childPid, acc);
      }
    }
  } catch {
    // Process may have exited — ignore
  }
}

// ---------------------------------------------------------------------------
// macOS: use pgrep -P <pid>
// ---------------------------------------------------------------------------

function getDescendantsDarwin(pid: number): number[] {
  const result: number[] = [];
  collectDarwin(pid, result);
  return result;
}

function collectDarwin(pid: number, acc: number[]): void {
  try {
    const output = execSync(`pgrep -P ${pid}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const childPids = output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(Number)
      .filter((n) => !isNaN(n) && n > 0);

    for (const childPid of childPids) {
      acc.push(childPid);
      collectDarwin(childPid, acc);
    }
  } catch {
    // pgrep exits with code 1 when no children found — ignore
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readdirSafe(dir: string): string[] {
  try {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function readFileSafe(filePath: string): string | undefined {
  try {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    return readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }
}
