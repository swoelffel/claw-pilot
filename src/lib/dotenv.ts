// src/lib/dotenv.ts
// Helper utilities for reading/writing .env files (one KEY=VALUE per line)

import * as fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import * as path from "node:path";

/**
 * Read a single variable from a .env file (synchronous).
 * Returns the raw value or null if not found / file absent.
 * Handles comments (#) and empty lines gracefully.
 */
export function readEnvVar(envPath: string, varName: string): string | null {
  try {
    const content = readFileSync(envPath, "utf-8");
    const regex = new RegExp(`^${varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=(.*)$`, "m");
    const match = content.match(regex);
    return match?.[1]?.trim() ?? null;
  } catch {
    // File doesn't exist or can't be read
    return null;
  }
}

/**
 * Write (or overwrite) a variable in a .env file.
 * Creates the file and parent directories if they don't exist.
 * Preserves other variables and comments. File written with mode 0o600.
 */
export async function writeEnvVar(envPath: string, varName: string, value: string): Promise<void> {
  // Ensure parent directory exists
  const dir = path.dirname(envPath);
  await fs.mkdir(dir, { recursive: true });

  // Read existing content (if file exists)
  let content = "";
  try {
    content = await fs.readFile(envPath, "utf-8");
  } catch {
    // File doesn't exist yet
  }

  // Parse lines, update or add the variable
  const lines = content.split("\n");
  const varPattern = new RegExp(`^${varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=`);
  let found = false;

  const newLines = lines.map((line) => {
    if (varPattern.test(line)) {
      found = true;
      return `${varName}=${value}`;
    }
    return line;
  });

  // If not found, append it
  if (!found) {
    // Remove trailing empty lines before appending
    while (newLines.length > 0 && newLines[newLines.length - 1] === "") {
      newLines.pop();
    }
    newLines.push(`${varName}=${value}`);
  }

  // Write back with mode 0o600 (read/write owner only)
  const newContent = newLines.join("\n");
  await fs.writeFile(envPath, newContent, { mode: 0o600 });
}

/**
 * Remove a variable from a .env file.
 * No-op if the variable or file doesn't exist.
 */
export async function removeEnvVar(envPath: string, varName: string): Promise<void> {
  try {
    const content = await fs.readFile(envPath, "utf-8");
    const varPattern = new RegExp(`^${varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=.*$`, "m");
    const newContent = content.replace(varPattern, "").replace(/\n\n+/g, "\n");
    await fs.writeFile(envPath, newContent.trim() + (newContent.trim() ? "\n" : ""), {
      mode: 0o600,
    });
  } catch {
    // File doesn't exist or can't be read — no-op
  }
}

/**
 * Mask a secret string for display.
 * Returns "••••••••3f9a" (last 4 chars visible by default).
 * Returns "••••" if the string is too short.
 */
export function maskSecret(raw: string, visibleChars: number = 4): string {
  if (!raw || raw.length <= visibleChars) {
    return "••••";
  }
  // Show bullets for all hidden chars, capped at 20 to prevent huge strings
  const hiddenCount = Math.min(raw.length - visibleChars, 20);
  return "•".repeat(hiddenCount) + raw.slice(-visibleChars);
}
