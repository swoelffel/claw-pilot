/**
 * runtime/engine/channel-factory.ts
 *
 * Instantiates Channel implementations from RuntimeConfig.
 *
 * Currently supported:
 *   - WebChatChannel  (config.webChat.enabled)
 *   - TelegramChannel (config.telegram.enabled)
 *
 * The web-chat channel port is derived from the instance slug via a
 * deterministic hash so that multiple instances don't collide.
 * Base port: 19100 (above the dashboard at 19000).
 */

import type Database from "better-sqlite3";
import type { RuntimeConfig } from "../config/index.js";
import type { InstanceSlug } from "../types.js";
import type { Channel } from "../channel/channel.js";
import { WebChatChannel } from "../channel/web-chat.js";
import { TelegramChannel } from "../channel/telegram/channel.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Base port for web-chat channels (dashboard is 19000, instances start at 19100) */
const WEB_CHAT_BASE_PORT = 19100;

/** Number of ports reserved for web-chat (max instances) */
const WEB_CHAT_PORT_RANGE = 100;

// ---------------------------------------------------------------------------
// createChannels
// ---------------------------------------------------------------------------

/**
 * Build the list of channels for a runtime instance based on config.
 *
 * @param config  - Validated RuntimeConfig
 * @param slug    - Instance slug (used to derive web-chat port)
 * @param db      - SQLite database (needed for Telegram pairing code generation)
 * @returns       Array of Channel instances (not yet connected)
 */
export function createChannels(
  config: RuntimeConfig,
  slug: InstanceSlug,
  db: Database.Database,
): Channel[] {
  const channels: Channel[] = [];

  // Web chat channel
  if (config.webChat.enabled) {
    const port = deriveWebChatPort(slug);
    const token = resolveWebChatToken(slug);
    channels.push(
      new WebChatChannel({
        port,
        token,
        maxConnections: config.webChat.maxSessions,
      }),
    );
  }

  // Telegram channel
  if (config.telegram.enabled) {
    channels.push(
      new TelegramChannel({
        botTokenEnvVar: config.telegram.botTokenEnvVar,
        pollingIntervalMs: config.telegram.pollingIntervalMs,
        allowedUserIds: config.telegram.allowedUserIds,
        dmPolicy: config.telegram.dmPolicy,
        groupPolicy: config.telegram.groupPolicy,
        db,
        instanceSlug: slug,
      }),
    );
  }

  return channels;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Derive a deterministic web-chat port from the instance slug.
 * Uses a simple djb2-style hash to spread ports across the reserved range.
 */
function deriveWebChatPort(slug: InstanceSlug): number {
  let hash = 5381;
  for (let i = 0; i < slug.length; i++) {
    hash = ((hash << 5) + hash) ^ slug.charCodeAt(i);
    hash = hash >>> 0; // keep unsigned 32-bit
  }
  return WEB_CHAT_BASE_PORT + (hash % WEB_CHAT_PORT_RANGE);
}

/**
 * Resolve the web-chat auth token for an instance.
 *
 * Priority:
 *   1. CLAW_RUNTIME_WEB_TOKEN_<SLUG_UPPER> env var
 *   2. CLAW_RUNTIME_WEB_TOKEN env var
 *   3. Fallback: slug-based deterministic token (dev/test only)
 *
 * In production, the token should be set via env var or the dashboard.
 */
function resolveWebChatToken(slug: InstanceSlug): string {
  const slugKey = slug.toUpperCase().replace(/-/g, "_");
  return (
    process.env[`CLAW_RUNTIME_WEB_TOKEN_${slugKey}`] ??
    process.env["CLAW_RUNTIME_WEB_TOKEN"] ??
    `dev-token-${slug}`
  );
}
