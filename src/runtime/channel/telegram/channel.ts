/**
 * runtime/channel/telegram/channel.ts
 *
 * TelegramChannel — implements the Channel interface using long-polling.
 *
 * V1 design:
 * - One default agent handles all messages (no per-user bindings)
 * - peerId = "telegram:<chat_id>"
 * - Responses are sent as MarkdownV2 (with plain-text fallback on parse error)
 * - Bot token read from process.env[botTokenEnvVar]
 *
 * V2 additions:
 * - dmPolicy: "pairing" generates a pairing code for unknown users
 * - groupPolicy: controls group message handling
 */

import type Database from "better-sqlite3";
import type { Channel } from "../channel.js";
import type { InboundMessage, OutboundMessage } from "../../types.js";
import { ChannelError } from "../channel.js";
import { TelegramPoller } from "./polling.js";
import type { TelegramUpdate } from "./polling.js";
import { markdownToTelegramV2 } from "./formatter.js";
import { createPairingCode } from "../pairing.js";

// ---------------------------------------------------------------------------
// TelegramChannel
// ---------------------------------------------------------------------------

export interface TelegramChannelOptions {
  /** Env var name that holds the bot token */
  botTokenEnvVar: string;
  /** Polling interval in ms */
  pollingIntervalMs?: number;
  /** Allowed Telegram user IDs (empty = all) */
  allowedUserIds?: number[];
  /** DM policy: pairing (code approval), open (all), allowlist (static IDs), disabled */
  dmPolicy?: "pairing" | "open" | "allowlist" | "disabled";
  /** Group policy: open (all groups), allowlist (static IDs), disabled */
  groupPolicy?: "open" | "allowlist" | "disabled";
  /** DB + slug needed for pairing code generation */
  db?: Database.Database;
  instanceSlug?: string;
}

export class TelegramChannel implements Channel {
  readonly type = "telegram";

  private poller: TelegramPoller | undefined;
  private handler: ((msg: InboundMessage) => Promise<void>) | undefined;
  private readonly options: TelegramChannelOptions;

  constructor(options: TelegramChannelOptions) {
    this.options = options;
  }

  onMessage(handler: (msg: InboundMessage) => Promise<void>): void {
    this.handler = handler;
  }

  async connect(): Promise<void> {
    if (this.poller) return; // idempotent

    const token = process.env[this.options.botTokenEnvVar];
    if (!token) {
      throw new ChannelError(
        "telegram",
        `Bot token env var not set: ${this.options.botTokenEnvVar}`,
      );
    }

    this.poller = new TelegramPoller({
      token,
      intervalMs: this.options.pollingIntervalMs ?? 1000,
      allowedUserIds: this.options.allowedUserIds ?? [],
    });

    this.poller.start((update) => this.handleUpdate(update));
  }

  async send(message: OutboundMessage): Promise<void> {
    if (!this.poller) {
      throw new ChannelError("telegram", "Channel not connected");
    }

    const chatId = parseChatId(message.peerId);
    if (chatId === undefined) {
      throw new ChannelError("telegram", `Invalid peerId: ${message.peerId}`);
    }

    const token = process.env[this.options.botTokenEnvVar];
    if (!token) {
      throw new ChannelError(
        "telegram",
        `Bot token env var not set: ${this.options.botTokenEnvVar}`,
      );
    }

    // Try MarkdownV2 first, fall back to plain text
    const formatted = markdownToTelegramV2(message.text);
    try {
      await this.poller.sendMessage(chatId, formatted, "MarkdownV2");
    } catch {
      // Fallback: send as plain text (no parse_mode)
      await this.poller.sendMessage(chatId, message.text);
    }
  }

  async disconnect(): Promise<void> {
    this.poller?.stop();
    this.poller = undefined;
  }

  getStatus(): "connected" | "disconnected" | "not_configured" {
    if (!this.poller) return "not_configured";
    // TelegramPoller.running est privé — accéder via cast
    return (this.poller as unknown as { running: boolean }).running ? "connected" : "disconnected";
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (!this.handler) return;

    const message = update.message;
    if (!message?.text) return; // ignore non-text messages

    const chatId = message.chat.id;
    const userId = message.from?.id;
    const peerId = `telegram:${chatId}`;

    // Check if user is allowed
    const allowed = this.isUserAllowed(userId);

    if (!allowed) {
      const policy = this.options.dmPolicy ?? "pairing";
      if (
        policy === "pairing" &&
        userId !== undefined &&
        this.options.db &&
        this.options.instanceSlug
      ) {
        // Generate pairing code and reply to the user
        await this.handlePairingRequest(chatId, userId, message.from?.username);
      }
      // For other policies (allowlist, disabled, open with no match), silently ignore
      return;
    }

    const inbound: InboundMessage = {
      channelType: "telegram",
      peerId,
      text: message.text,
      raw: update,
    };

    await this.handler(inbound);
  }

  /**
   * Check if a Telegram user ID is in the allowlist.
   * If allowedUserIds is empty, all users are allowed (open mode).
   */
  private isUserAllowed(userId: number | undefined): boolean {
    if (this.options.allowedUserIds === undefined || this.options.allowedUserIds.length === 0) {
      // No allowlist = open (all allowed)
      return true;
    }
    if (userId === undefined) return false;
    return this.options.allowedUserIds.includes(userId);
  }

  /**
   * Handle a pairing request from an unknown user.
   * Generates (or reuses) a pairing code and sends it to the user via the bot.
   */
  private async handlePairingRequest(
    chatId: number,
    userId: number,
    username?: string,
  ): Promise<void> {
    if (!this.options.db || !this.options.instanceSlug) return;

    const peerId = `telegram:${chatId}`;

    // Check if a valid (non-expired, non-used) code already exists for this peer
    const existingCode = this.getExistingPairingCode(peerId);
    let code: string;

    if (existingCode) {
      code = existingCode;
    } else {
      // Create new pairing code with peer_id and username in meta
      const record = createPairingCode(this.options.db, this.options.instanceSlug, {
        channel: "telegram",
        ttlMinutes: 60,
        peerId,
        ...(username !== undefined ? { meta: { username } } : {}),
      });
      code = record.code;
    }

    const token = process.env[this.options.botTokenEnvVar];
    if (!token) return;

    // Format code as XXXX-XXXX for readability
    const formatted = `${code.slice(0, 4)}-${code.slice(4)}`;
    const text = `👋 Hello! To connect to this assistant, send this code to your admin:\n\n*${formatted}*\n\nThis code expires in 60 minutes\\.`;

    try {
      await this.poller!.sendMessage(chatId, text, "MarkdownV2");
    } catch {
      // Fallback plain text
      const plainText = `Hello! To connect to this assistant, send this code to your admin: ${formatted}\n\nThis code expires in 60 minutes.`;
      await this.poller!.sendMessage(chatId, plainText);
    }
  }

  /**
   * Look up an existing valid pairing code for a given peer ID.
   * Returns the code string if found, undefined otherwise.
   */
  private getExistingPairingCode(peerId: string): string | undefined {
    if (!this.options.db || !this.options.instanceSlug) return undefined;
    const now = new Date().toISOString();
    const row = this.options.db
      .prepare(
        `SELECT code FROM rt_pairing_codes
         WHERE instance_slug = ? AND channel = 'telegram' AND peer_id = ?
           AND used = 0 AND expires_at > ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(this.options.instanceSlug, peerId, now) as { code: string } | undefined;
    return row?.code;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseChatId(peerId: string): number | undefined {
  const match = peerId.match(/^telegram:(-?\d+)$/);
  if (!match) return undefined;
  return parseInt(match[1]!, 10);
}
