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
import type { InboundMessage, InboundAttachment, OutboundMessage } from "../../types.js";
import { ChannelError } from "../channel.js";
import { TelegramPoller } from "./polling.js";
import type { TelegramUpdate, TelegramInlineKeyboardButton } from "./polling.js";
import { markdownToTelegramV2 } from "./formatter.js";
import { createPairingCode } from "../pairing.js";
import { logger } from "../../../lib/logger.js";
import { getBus } from "../../bus/index.js";
import { QuestionAsked } from "../../bus/events.js";
import { resolveQuestion } from "../../tool/built-in/question.js";

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
  private busUnsub: (() => void) | undefined;
  /** Track last known chatId for sending question keyboards */
  private lastChatId: number | undefined;

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
      // Token not set — Telegram is enabled in config but not yet configured.
      // This is expected on a fresh install. Log a warning and skip silently
      // instead of crashing the runtime.
      logger.warn(
        `[telegram] Bot token env var "${this.options.botTokenEnvVar}" is not set — Telegram channel disabled until token is configured.`,
      );
      return;
    }

    this.poller = new TelegramPoller({
      token,
      intervalMs: this.options.pollingIntervalMs ?? 1000,
      allowedUserIds: this.options.allowedUserIds ?? [],
    });

    this.poller.start((update) => this.handleUpdate(update));

    // Subscribe to question events to send inline keyboards
    if (this.options.instanceSlug) {
      const bus = getBus(this.options.instanceSlug);
      this.busUnsub = bus.subscribe(QuestionAsked, (payload) => {
        void this.handleQuestionAsked(payload);
      });
    }
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
    this.busUnsub?.();
    this.busUnsub = undefined;
    this.poller?.stop();
    this.poller = undefined;
  }

  getStatus(): "connected" | "disconnected" | "not_configured" {
    if (!this.poller) return "not_configured";
    // TelegramPoller.running est privé — accéder via cast
    return this.poller.isRunning ? "connected" : "disconnected";
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    // Handle callback queries (inline keyboard button presses)
    if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
      return;
    }

    if (!this.handler) return;

    const message = update.message;
    if (!message) return;

    // A message must have text, a photo, or a document to be processable
    const hasContent = message.text || message.caption || message.photo || message.document;
    if (!hasContent) return;

    const chatId = message.chat.id;
    const userId = message.from?.id;
    const peerId = `telegram:${chatId}`;
    this.lastChatId = chatId;

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
        await this.handlePairingRequest(chatId, userId, message.from?.username);
      }
      return;
    }

    // Build attachments from photo/document
    const attachments = await this.extractAttachments(message);

    const inbound: InboundMessage = {
      channelType: "telegram",
      peerId,
      text: message.text ?? message.caption ?? "",
      raw: update,
      ...(attachments.length > 0 ? { attachments } : {}),
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

  /**
   * Extract image/document attachments from a Telegram message.
   * Downloads files via Bot API and returns base64-encoded data.
   */
  private async extractAttachments(
    message: import("./polling.js").TelegramMessage,
  ): Promise<InboundAttachment[]> {
    if (!this.poller) return [];
    const attachments: InboundAttachment[] = [];

    // Handle photos (pick the largest size — last in array)
    if (message.photo && message.photo.length > 0) {
      const largest = message.photo[message.photo.length - 1]!;
      try {
        const fileInfo = await this.poller.getFile(largest.file_id);
        const base64 = await this.poller.downloadFileAsBase64(fileInfo.file_path);
        const ext = fileInfo.file_path.split(".").pop()?.toLowerCase() ?? "jpg";
        const mimeType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
        attachments.push({
          id: largest.file_unique_id,
          type: "image",
          mimeType,
          data: base64,
          ...(fileInfo.file_size !== undefined ? { sizeBytes: fileInfo.file_size } : {}),
        });
      } catch (err) {
        logger.warn(`[telegram] Failed to download photo: ${err}`);
      }
    }

    // Handle documents (images sent as files)
    if (message.document) {
      const doc = message.document;
      const isImage = doc.mime_type?.startsWith("image/") ?? false;
      if (isImage) {
        try {
          const fileInfo = await this.poller.getFile(doc.file_id);
          const base64 = await this.poller.downloadFileAsBase64(fileInfo.file_path);
          attachments.push({
            id: doc.file_unique_id,
            type: "image",
            mimeType: doc.mime_type ?? "image/jpeg",
            data: base64,
            ...(doc.file_name !== undefined ? { filename: doc.file_name } : {}),
            ...(doc.file_size !== undefined ? { sizeBytes: doc.file_size } : {}),
          });
        } catch (err) {
          logger.warn(`[telegram] Failed to download document: ${err}`);
        }
      }
    }

    return attachments;
  }

  /**
   * Handle a callback_query from an inline keyboard button press.
   * Data format: "q:<questionId>:<optionIndex>"
   */
  private async handleCallbackQuery(query: TelegramUpdate["callback_query"] & {}): Promise<void> {
    if (!this.poller || !query.data) return;

    // Acknowledge the callback to remove the loading spinner in Telegram
    try {
      await this.poller.answerCallbackQuery(query.id);
    } catch {
      // Non-critical — continue processing
    }

    // Parse callback data
    const parts = query.data.split(":");
    if (parts[0] !== "q" || !parts[1] || !parts[2]) return;

    const questionId = parts[1];
    const answer = decodeURIComponent(parts.slice(2).join(":"));

    const resolved = resolveQuestion(questionId, answer);
    if (!resolved) {
      logger.warn(`[telegram] callback_query for unknown/expired question: ${questionId}`);
    }
  }

  /**
   * Handle a QuestionAsked bus event — send inline keyboard to the last known chat.
   */
  private async handleQuestionAsked(payload: {
    questionId: string;
    question: string;
    options?: string[];
  }): Promise<void> {
    if (!this.poller || !this.lastChatId) return;

    const options = payload.options ?? [];
    if (options.length === 0) {
      // No options — send as plain text (user must reply via text)
      const text = `❓ ${payload.question}`;
      try {
        await this.poller.sendMessage(this.lastChatId, text);
      } catch (err) {
        logger.warn(`[telegram] Failed to send question: ${err}`);
      }
      return;
    }

    // Build inline keyboard (one button per row)
    const keyboard: TelegramInlineKeyboardButton[][] = options.map((opt) => [
      {
        text: opt,
        callback_data: `q:${payload.questionId}:${encodeURIComponent(opt)}`,
      },
    ]);

    const text = `❓ ${payload.question}`;
    try {
      await this.poller.sendMessage(this.lastChatId, text, undefined, {
        inline_keyboard: keyboard,
      });
    } catch (err) {
      logger.warn(`[telegram] Failed to send question with keyboard: ${err}`);
    }
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
