// src/lib/env-reader.ts
import * as path from "node:path";
import type { ServerConnection } from "../server/connection.js";

/**
 * Read OPENCLAW_GW_AUTH_TOKEN from <stateDir>/.env.
 * Returns the token string, or null if the file is missing or the variable is absent.
 */
export async function readGatewayToken(
  conn: ServerConnection,
  stateDir: string,
): Promise<string | null> {
  const envPath = path.join(stateDir, ".env");
  let raw: string;
  try {
    raw = await conn.readFile(envPath);
  } catch {
    // File missing or unreadable — not an error for callers
    return null;
  }

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("OPENCLAW_GW_AUTH_TOKEN=")) {
      const value = trimmed.slice("OPENCLAW_GW_AUTH_TOKEN=".length).trim();
      return value.length > 0 ? value : null;
    }
  }

  return null;
}
