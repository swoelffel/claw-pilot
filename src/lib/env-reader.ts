// src/lib/env-reader.ts
import * as path from "node:path";
import type { ServerConnection } from "../server/connection.js";

/**
 * Read the gateway auth token for an instance.
 *
 * Strategy:
 * 1. Read OPENCLAW_GW_AUTH_TOKEN from <stateDir>/.env  (claw-pilot-provisioned instances)
 * 2. Fallback: read gateway.auth.token from <stateDir>/openclaw.json  (manually installed instances)
 *
 * Returns the token string, or null if not found.
 */
export async function readGatewayToken(
  conn: ServerConnection,
  stateDir: string,
): Promise<string | null> {
  // 1. Try .env first
  const envPath = path.join(stateDir, ".env");
  try {
    const raw = await conn.readFile(envPath);
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("OPENCLAW_GW_AUTH_TOKEN=")) {
        const value = trimmed.slice("OPENCLAW_GW_AUTH_TOKEN=".length).trim();
        if (value.length > 0) return value;
      }
    }
  } catch {
    // .env missing or unreadable — fall through to openclaw.json
  }

  // 2. Fallback: openclaw.json → gateway.auth.token
  const configPath = path.join(stateDir, "openclaw.json");
  try {
    const raw = await conn.readFile(configPath);
    const config = JSON.parse(raw) as Record<string, unknown>;
    const gateway = config["gateway"] as Record<string, unknown> | undefined;
    const auth = gateway?.["auth"] as Record<string, unknown> | undefined;
    const token = auth?.["token"];
    if (typeof token === "string" && token.length > 0) return token;
  } catch {
    // Config missing or invalid JSON — not an error for callers
  }

  return null;
}
