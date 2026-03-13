// src/lib/env-reader.ts
import * as path from "node:path";
import type { ServerConnection } from "../server/connection.js";

/**
 * Read an environment variable value from an instance's .env file.
 *
 * Reads <stateDir>/.env and returns the value for the given key, or null if not found.
 */
export async function readEnvValue(
  conn: ServerConnection,
  stateDir: string,
  key: string,
): Promise<string | null> {
  const envPath = path.join(stateDir, ".env");
  try {
    const raw = await conn.readFile(envPath);
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith(`${key}=`)) {
        const value = trimmed.slice(key.length + 1).trim();
        if (value.length > 0) return value;
      }
    }
  } catch {
    // .env missing or unreadable
  }
  return null;
}

/**
 * Read the gateway auth token for an instance.
 *
 * @deprecated Gateway tokens are an OpenClaw concept. Use readEnvValue() for specific keys.
 * Kept for backward compatibility during migration.
 */
export async function readGatewayToken(
  conn: ServerConnection,
  stateDir: string,
): Promise<string | null> {
  return readEnvValue(conn, stateDir, "OPENCLAW_GW_AUTH_TOKEN");
}
