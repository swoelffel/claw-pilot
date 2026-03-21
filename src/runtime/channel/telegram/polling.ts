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
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  date: number;
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
      allowed_updates: JSON.stringify(["message"]),
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
  ): Promise<void> {
    const payload = JSON.stringify({
      chat_id: chatId,
      text,
      ...(parseMode ? { parse_mode: parseMode } : {}),
    });

    const url = `https://api.telegram.org/bot${this.options.token}/sendMessage`;
    await httpsPost(url, payload);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
