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
 */

import type { Channel } from "../channel.js";
import type { InboundMessage, OutboundMessage } from "../../types.js";
import { ChannelError } from "../channel.js";
import { TelegramPoller } from "./polling.js";
import type { TelegramUpdate } from "./polling.js";
import { markdownToTelegramV2 } from "./formatter.js";

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

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (!this.handler) return;

    const message = update.message;
    if (!message?.text) return; // ignore non-text messages

    const chatId = message.chat.id;
    const peerId = `telegram:${chatId}`;

    const inbound: InboundMessage = {
      channelType: "telegram",
      peerId,
      text: message.text,
      raw: update,
    };

    await this.handler(inbound);
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
