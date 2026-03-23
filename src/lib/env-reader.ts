// src/lib/env-reader.ts
import * as path from "node:path";
import * as fs from "node:fs";
import type { ServerConnection } from "../server/connection.js";
import { getDataDir } from "./platform.js";

/**
 * Read all environment variables from an instance's .env file (synchronously).
 *
 * Reads <stateDir>/.env and returns a map of all key=value pairs.
 * Returns empty object if file doesn't exist or is unreadable.
 */
export function readEnvFileSync(stateDir: string): Record<string, string> {
  const envPath = path.join(stateDir, ".env");
  const result: Record<string, string> = {};
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
        result[key] = value;
      }
    }
  } catch {
    // .env missing or unreadable — return empty object
  }
  return result;
}

/**
 * Build a merged env map from global (~/.claw-pilot/.env) and instance (<stateDir>/.env).
 * Instance values override global values.
 */
export function buildResolvedEnv(stateDir: string): Record<string, string> {
  const globalEnv = readEnvFileSync(getDataDir());
  const instanceEnv = readEnvFileSync(stateDir);
  return { ...globalEnv, ...instanceEnv };
}

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
