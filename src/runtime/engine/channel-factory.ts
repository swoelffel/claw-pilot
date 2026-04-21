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
import { deriveWebChatPort } from "../../lib/platform.js";
import { getSecretProvider } from "../../core/secrets/index.js";

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
export async function createChannels(
  config: RuntimeConfig,
  slug: InstanceSlug,
  db: Database.Database,
): Promise<Channel[]> {
  const channels: Channel[] = [];

  // Web chat channel
  if (config.webChat.enabled) {
    const port = deriveWebChatPort(slug);
    const token = await resolveWebChatToken(slug);
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

// deriveWebChatPort is imported from ../../lib/platform.js

/**
 * Resolve the web-chat auth token for an instance, via the SecretProvider (R5).
 *
 * Priority:
 *   1. CLAW_RUNTIME_WEB_TOKEN_<SLUG_UPPER>
 *   2. CLAW_RUNTIME_WEB_TOKEN
 *   3. Fallback: slug-based deterministic token (dev/test only)
 *
 * The env provider resolves `process.env` first (matching the legacy
 * lookup) before falling back to the global `.env` file. In production,
 * the token should be set via env var, `.env`, or an Enterprise backend.
 */
async function resolveWebChatToken(slug: InstanceSlug): Promise<string> {
  const slugKey = slug.toUpperCase().replace(/-/g, "_");
  const provider = getSecretProvider();
  const scopedName = `CLAW_RUNTIME_WEB_TOKEN_${slugKey}`;
  if (await provider.has(scopedName)) return provider.get(scopedName);
  if (await provider.has("CLAW_RUNTIME_WEB_TOKEN")) {
    return provider.get("CLAW_RUNTIME_WEB_TOKEN");
  }
  return `dev-token-${slug}`;
}
