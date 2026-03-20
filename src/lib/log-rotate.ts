// src/lib/log-rotate.ts
//
// Simple size-based log rotation for runtime.log files.
// Called at daemon startup before opening the log file descriptor.

import fs from "node:fs";

/**
 * Rotate `logPath` if its size exceeds `maxSizeMb`.
 *
 * Rotation strategy: rename existing archives from highest to lowest index,
 * then move the current log to `.1`. The caller then opens a fresh file.
 *
 * Example with maxFiles=3:
 *   runtime.log.2 → runtime.log.3  (if exists, oldest is dropped)
 *   runtime.log.1 → runtime.log.2
 *   runtime.log   → runtime.log.1
 */
export function rotateLogs(logPath: string, maxSizeMb: number, maxFiles: number): void {
  if (!fs.existsSync(logPath)) return;

  const stat = fs.statSync(logPath);
  if (stat.size < maxSizeMb * 1024 * 1024) return;

  // Shift archives from highest to lowest index
  for (let i = maxFiles - 1; i >= 1; i--) {
    const src = `${logPath}.${i}`;
    const dst = `${logPath}.${i + 1}`;
    if (fs.existsSync(src)) {
      fs.renameSync(src, dst);
    }
  }

  // Move current log to .1
  fs.renameSync(logPath, `${logPath}.1`);
}
