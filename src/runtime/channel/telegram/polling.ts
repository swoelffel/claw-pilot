/**
 * runtime/channel/telegram/polling.ts
 *
 * Long-polling implementation for the Telegram Bot API.
 * Uses Node.js native `https` — no external Telegram SDK dependency.
 *
 * Implements getUpdates with offset tracking and exponential backoff on errors.
 */

import * as https from "node:https";

// ---------------------------------------------------------------------------
// Telegram API types (minimal subset)
// ---------------------------------------------------------------------------

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data?: string;
}

export type TelegramReplyMarkup = {
  inline_keyboard: TelegramInlineKeyboardButton[][];
};

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  caption?: string;
  date: number;
  /** Photo array — ordered by size, largest last */
  photo?: TelegramPhotoSize[];
  /** Document attachment */
  document?: TelegramDocument;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

// ---------------------------------------------------------------------------
// TelegramPoller
// ---------------------------------------------------------------------------

export interface PollerOptions {
  /** Bot token */
  token: string;
  /** Polling interval in ms (used as timeout between retries on error) */
  intervalMs?: number;
  /** Long-poll timeout in seconds (passed to getUpdates) */
  longPollTimeoutSec?: number;
  /** Allowed user IDs (empty = all) */
  allowedUserIds?: number[];
}

export type UpdateHandler = (update: TelegramUpdate) => Promise<void>;

export class TelegramPoller {
  private offset = 0;
  private _running = false;
  private abortController: AbortController | undefined;
  private readonly options: Required<PollerOptions>;

  get isRunning(): boolean {
    return this._running;
  }

  constructor(options: PollerOptions) {
    this.options = {
      intervalMs: 1000,
      longPollTimeoutSec: 30,
      allowedUserIds: [],
      ...options,
    };
  }

  /**
   * Start polling. Calls `handler` for each update.
   * Returns immediately — polling runs in the background.
   */
  start(handler: UpdateHandler): void {
    if (this._running) return;
    this._running = true;
    this.abortController = new AbortController();
    void this.pollLoop(handler);
  }

  /**
   * Stop polling gracefully.
   */
  stop(): void {
    this._running = false;
    this.abortController?.abort();
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async pollLoop(handler: UpdateHandler): Promise<void> {
    let backoffMs = this.options.intervalMs;

    while (this._running) {
      try {
        const updates = await this.getUpdates();

        if (updates.length > 0) {
          for (const update of updates) {
            if (this.isAllowed(update)) {
              await handler(update);
            }
            this.offset = Math.max(this.offset, update.update_id + 1);
          }
          backoffMs = this.options.intervalMs; // reset backoff on success
        }
      } catch {
        if (!this._running) break;
        // Exponential backoff, cap at 30s
        backoffMs = Math.min(backoffMs * 2, 30_000);
        await sleep(backoffMs);
      }
    }
  }

  private async getUpdates(): Promise<TelegramUpdate[]> {
    const params = new URLSearchParams({
      offset: String(this.offset),
      timeout: String(this.options.longPollTimeoutSec),
      allowed_updates: JSON.stringify(["message", "callback_query"]),
    });

    const url = `https://api.telegram.org/bot${this.options.token}/getUpdates?${params}`;
    const body = await httpsGet(url);
    const response = JSON.parse(body) as TelegramApiResponse<TelegramUpdate[]>;

    if (!response.ok) {
      throw new Error(`Telegram API error: ${response.description ?? "unknown"}`);
    }

    return response.result ?? [];
  }

  /**
   * Send a text message to a chat.
   */
  async sendMessage(
    chatId: number,
    text: string,
    parseMode?: "MarkdownV2" | "HTML",
    replyMarkup?: TelegramReplyMarkup,
  ): Promise<void> {
    const payload = JSON.stringify({
      chat_id: chatId,
      text,
      ...(parseMode ? { parse_mode: parseMode } : {}),
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });

    const url = `https://api.telegram.org/bot${this.options.token}/sendMessage`;
    await httpsPost(url, payload);
  }

  /**
   * Acknowledge a callback query (required by Telegram after inline keyboard press).
   */
  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    const payload = JSON.stringify({
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    });

    const url = `https://api.telegram.org/bot${this.options.token}/answerCallbackQuery`;
    await httpsPost(url, payload);
  }

  /**
   * Get file path from Telegram servers (needed before download).
   */
  async getFile(fileId: string): Promise<{ file_path: string; file_size?: number }> {
    const url = `https://api.telegram.org/bot${this.options.token}/getFile?file_id=${encodeURIComponent(fileId)}`;
    const body = await httpsGet(url);
    const response = JSON.parse(body) as TelegramApiResponse<{
      file_id: string;
      file_path?: string;
      file_size?: number;
    }>;
    if (!response.ok || !response.result?.file_path) {
      throw new Error(`Telegram getFile failed: ${response.description ?? "no file_path"}`);
    }
    return {
      file_path: response.result.file_path,
      ...(response.result.file_size !== undefined ? { file_size: response.result.file_size } : {}),
    };
  }

  /**
   * Download a file from Telegram and return as base64 string.
   */
  async downloadFileAsBase64(filePath: string): Promise<string> {
    const url = `https://api.telegram.org/file/bot${this.options.token}/${filePath}`;
    const buffer = await httpsGetBuffer(url);
    return buffer.toString("base64");
  }

  /**
   * Send a document (file) to a chat via multipart/form-data upload.
   */
  async sendDocument(
    chatId: number,
    document: Buffer,
    filename: string,
    caption?: string,
    parseMode?: "MarkdownV2" | "HTML",
  ): Promise<void> {
    const url = `https://api.telegram.org/bot${this.options.token}/sendDocument`;
    await httpsPostMultipart(
      url,
      {
        chat_id: String(chatId),
        ...(caption !== undefined ? { caption } : {}),
        ...(parseMode !== undefined ? { parse_mode: parseMode } : {}),
      },
      {
        fieldName: "document",
        buffer: document,
        filename,
      },
    );
  }

  private isAllowed(update: TelegramUpdate): boolean {
    if (this.options.allowedUserIds.length === 0) return true;
    const userId = update.message?.from?.id;
    if (userId === undefined) return false;
    return this.options.allowedUserIds.includes(userId);
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers (native Node.js https)
// ---------------------------------------------------------------------------

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

function httpsGetBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        // Follow redirects (Telegram file API may redirect)
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          httpsGetBuffer(res.headers.location).then(resolve, reject);
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

function httpsPost(url: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options: https.RequestOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function httpsPostMultipart(
  url: string,
  fields: Record<string, string>,
  file: { fieldName: string; buffer: Buffer; filename: string },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const boundary = `----FormBoundary${Date.now().toString(36)}`;
    const parts: Buffer[] = [];

    // Text fields
    for (const [key, value] of Object.entries(fields)) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
        ),
      );
    }

    // File field
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldName}"; filename="${file.filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
    );
    parts.push(file.buffer);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    const body = Buffer.concat(parts);
    const urlObj = new URL(url);
    const options: https.RequestOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length,
      },
    };

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
