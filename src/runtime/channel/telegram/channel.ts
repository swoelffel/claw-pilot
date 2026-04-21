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

import * as nodeFs from "node:fs/promises";
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
import {
  QuestionAsked,
  SuggestionsGenerated,
  BudgetSoftAlert,
  BudgetHardStop,
} from "../../bus/events.js";
import type { QuestionItem } from "../../bus/events.js";
import { resolveQuestion } from "../../tool/built-in/question.js";
import { getSecretProvider, isSecretProviderRegistered } from "../../../core/secrets/index.js";
import type { QuestionAnswerPayload } from "../../tool/built-in/question.js";
import type { OutboundArtifact } from "../../types.js";

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
  private suggestionsUnsub: (() => void) | undefined;
  private budgetSoftUnsub: (() => void) | undefined;
  private budgetHardUnsub: (() => void) | undefined;
  /** Track last known chatId for sending question keyboards */
  private lastChatId: number | undefined;
  /**
   * In-flight question state machine. A single question tool call may contain
   * multiple items rendered sequentially — we track the current item, the
   * accumulated answers, and multi-select toggle state per questionId.
   */
  private pendingQuestions = new Map<
    string,
    {
      items: QuestionItem[];
      chatId: number;
      currentIdx: number;
      answers: QuestionAnswerPayload[];
      /** Indexes of options currently toggled for the current `multi` item. */
      multiSelected: Set<number>;
      /** Message id of the last keyboard shown — used for editMessageReplyMarkup. */
      lastMessageId?: number;
      /** True when current item is `free` and we await a plain text reply. */
      awaitingFreeText: boolean;
    }
  >();

  constructor(options: TelegramChannelOptions) {
    this.options = options;
  }

  onMessage(handler: (msg: InboundMessage) => Promise<void>): void {
    this.handler = handler;
  }

  /**
   * Resolve the bot token via the SecretProvider (R5). The env provider
   * reads `process.env[botTokenEnvVar]` first, matching the legacy lookup,
   * then falls back to the global `.env` file. Returns `undefined` when
   * the token is absent so callers can handle the not-configured path.
   */
  private async resolveBotToken(): Promise<string | undefined> {
    const name = this.options.botTokenEnvVar;
    // Tolerate calls before bootstrap (e.g. unit tests instantiating the
    // channel without a full withContext) — fall back to process.env.
    if (!isSecretProviderRegistered()) {
      const raw = process.env[name];
      return raw && raw.length > 0 ? raw : undefined;
    }
    const provider = getSecretProvider();
    if (!(await provider.has(name))) return undefined;
    try {
      return await provider.get(name);
    } catch (err) {
      logger.debug("[telegram] bot token resolution failed", { error: String(err) });
      return undefined;
    }
  }

  async connect(): Promise<void> {
    if (this.poller) return; // idempotent

    const token = await this.resolveBotToken();
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

    // Subscribe to bus events for inline keyboards
    if (this.options.instanceSlug) {
      const bus = getBus(this.options.instanceSlug);
      this.busUnsub = bus.subscribe(QuestionAsked, (payload) => {
        void this.handleQuestionAsked(payload);
      });
      this.suggestionsUnsub = bus.subscribe(SuggestionsGenerated, (payload) => {
        void this.handleSuggestionsGenerated(payload);
      });
      this.budgetSoftUnsub = bus.subscribe(BudgetSoftAlert, (payload) => {
        if (this.lastChatId && this.poller) {
          const pct = Math.round(payload.pct * 100);
          const label = payload.scopeId ? `${payload.scope} (${payload.scopeId})` : payload.scope;
          void this.poller.sendMessage(
            this.lastChatId,
            `\u26a0\ufe0f Budget alert: ${label} at ${pct}% — $${payload.spentUsd.toFixed(2)} / $${payload.limitUsd.toFixed(2)}`,
          );
        }
      });
      this.budgetHardUnsub = bus.subscribe(BudgetHardStop, (payload) => {
        if (this.lastChatId && this.poller) {
          const label = payload.scopeId ? `${payload.scope} (${payload.scopeId})` : payload.scope;
          void this.poller.sendMessage(
            this.lastChatId,
            `\ud83d\uded1 Budget exceeded: ${label} — agent paused. $${payload.spentUsd.toFixed(2)} / $${payload.limitUsd.toFixed(2)}. Override via dashboard.`,
          );
        }
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

    const token = await this.resolveBotToken();
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
    } catch (err) {
      logger.warn("[telegram] MarkdownV2 send failed, falling back to plain text", {
        error: String(err),
      });
      // Fallback: send as plain text (no parse_mode)
      await this.poller.sendMessage(chatId, message.text);
    }

    // Send artifacts as downloadable documents
    if (message.artifacts && message.artifacts.length > 0) {
      for (const artifact of message.artifacts) {
        try {
          await this.sendArtifactDocument(chatId, artifact);
        } catch (err) {
          logger.warn(`[telegram] Failed to send artifact document: ${err}`);
        }
      }
    }

    // Send workspace files as downloadable documents
    if (message.files && message.files.length > 0) {
      for (const file of message.files) {
        try {
          const buffer = await nodeFs.readFile(file.path);
          await this.poller.sendDocument(chatId, buffer, file.filename, `📎 ${file.title}`);
        } catch (err) {
          logger.warn(`[telegram] Failed to send file "${file.filename}": ${err}`);
        }
      }
    }
  }

  async disconnect(): Promise<void> {
    this.busUnsub?.();
    this.busUnsub = undefined;
    this.suggestionsUnsub?.();
    this.suggestionsUnsub = undefined;
    this.budgetSoftUnsub?.();
    this.budgetSoftUnsub = undefined;
    this.budgetHardUnsub?.();
    this.budgetHardUnsub = undefined;
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

    if (allowed) {
      // If a pending question is awaiting free text from this chat, consume
      // the plain-text message as the answer instead of forwarding it to
      // the agent's normal chat loop (which would deadlock behind the
      // session queue).
      const rawText = message.text ?? message.caption ?? "";
      if (rawText && (await this.tryConsumeFreeTextAnswer(chatId, rawText))) {
        return;
      }
    }

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

    const token = await this.resolveBotToken();
    if (!token) return;

    // Format code as XXXX-XXXX for readability
    const formatted = `${code.slice(0, 4)}-${code.slice(4)}`;
    const text = `👋 Hello! To connect to this assistant, send this code to your admin:\n\n*${formatted}*\n\nThis code expires in 60 minutes\\.`;

    try {
      await this.poller!.sendMessage(chatId, text, "MarkdownV2");
    } catch (err) {
      logger.warn("[telegram] pairing message MarkdownV2 send failed", { error: String(err) });
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
    const photoAttachment = await this._extractPhotoAttachment(message);
    if (photoAttachment) attachments.push(photoAttachment);

    // Handle documents (images sent as files)
    const docAttachment = await this._extractDocumentAttachment(message);
    if (docAttachment) attachments.push(docAttachment);

    return attachments;
  }

  /** Download the largest photo from a Telegram message, if present. */
  private async _extractPhotoAttachment(
    message: import("./polling.js").TelegramMessage,
  ): Promise<InboundAttachment | undefined> {
    if (!this.poller || !message.photo || message.photo.length === 0) return undefined;
    const largest = message.photo[message.photo.length - 1]!;
    try {
      const fileInfo = await this.poller.getFile(largest.file_id);
      const base64 = await this.poller.downloadFileAsBase64(fileInfo.file_path);
      const ext = fileInfo.file_path.split(".").pop()?.toLowerCase() ?? "jpg";
      const mimeType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      return {
        id: largest.file_unique_id,
        type: "image",
        mimeType,
        data: base64,
        ...(fileInfo.file_size !== undefined ? { sizeBytes: fileInfo.file_size } : {}),
      };
    } catch (err) {
      logger.warn(`[telegram] Failed to download photo: ${err}`);
      return undefined;
    }
  }

  /** Download an image document from a Telegram message, if present. */
  private async _extractDocumentAttachment(
    message: import("./polling.js").TelegramMessage,
  ): Promise<InboundAttachment | undefined> {
    if (!this.poller || !message.document) return undefined;
    const doc = message.document;
    const isImage = doc.mime_type?.startsWith("image/") ?? false;
    if (!isImage) return undefined;
    try {
      const fileInfo = await this.poller.getFile(doc.file_id);
      const base64 = await this.poller.downloadFileAsBase64(fileInfo.file_path);
      return {
        id: doc.file_unique_id,
        type: "image",
        mimeType: doc.mime_type ?? "image/jpeg",
        data: base64,
        ...(doc.file_name !== undefined ? { filename: doc.file_name } : {}),
        ...(doc.file_size !== undefined ? { sizeBytes: doc.file_size } : {}),
      };
    } catch (err) {
      logger.warn(`[telegram] Failed to download document: ${err}`);
      return undefined;
    }
  }

  /**
   * Handle a callback_query from an inline keyboard button press.
   *
   * Data formats (v0.72+):
   *   q:<questionId>:sel:<optIdx>  — single-select
   *   q:<questionId>:tog:<optIdx>  — multi-select toggle
   *   q:<questionId>:cfm           — multi-select confirm
   *   q:<questionId>:oth           — switch current item to free-text fallback
   *   s:<suggestion>               — suggestion click (unchanged)
   *
   * Legacy (pre-v0.72): q:<questionId>:<url-encoded answer> — still honored
   * when no state exists (falls back to direct resolveQuestion).
   */
  private async handleCallbackQuery(query: TelegramUpdate["callback_query"] & {}): Promise<void> {
    if (!this.poller || !query.data) return;

    // Acknowledge the callback to remove the loading spinner in Telegram
    try {
      await this.poller.answerCallbackQuery(query.id);
    } catch (err) {
      logger.warn("[telegram] answerCallbackQuery failed", { error: String(err) });
    }

    const parts = query.data.split(":");
    const prefix = parts[0];

    if (prefix === "q" && parts[1]) {
      this._handleQuestionCallback(parts);
    } else if (prefix === "s" && parts[1]) {
      this._handleSuggestionCallback(parts, query.message?.chat?.id);
    }
  }

  /** Dispatch a question callback (structured v0.72+ or legacy). */
  private _handleQuestionCallback(parts: string[]): void {
    const questionId = parts[1]!;
    const action = parts[2];
    const state = this.pendingQuestions.get(questionId);

    // v0.72+ structured actions require state
    if (state && (action === "sel" || action === "tog" || action === "cfm" || action === "oth")) {
      void this.handleStructuredCallback(questionId, action, parts[3]);
      return;
    }

    // Legacy fallback: q:<id>:<url-encoded answer>
    if (!state && parts[2]) {
      const answer = decodeURIComponent(parts.slice(2).join(":"));
      const resolved = resolveQuestion(questionId, answer);
      if (!resolved) {
        logger.warn(`[telegram] callback_query for unknown/expired question: ${questionId}`);
      }
    }
  }

  /** Dispatch a suggestion callback — forward as a new inbound message. */
  private _handleSuggestionCallback(parts: string[], chatId: number | undefined): void {
    const suggestionText = decodeURIComponent(parts.slice(1).join(":"));
    if (suggestionText && chatId && this.handler) {
      void this.handler({
        channelType: "telegram",
        peerId: `telegram:${chatId}`,
        text: suggestionText,
      });
    }
  }

  /**
   * Dispatch v0.72+ structured callback actions for pending questions.
   */
  private async handleStructuredCallback(
    questionId: string,
    action: string,
    arg: string | undefined,
  ): Promise<void> {
    const state = this.pendingQuestions.get(questionId);
    if (!state || !this.poller) return;
    const item = state.items[state.currentIdx];
    if (!item) return;

    if (action === "sel") {
      await this._handleSelectAction(questionId, state, item, arg);
    } else if (action === "tog") {
      await this._handleToggleAction(questionId, state, item, arg);
    } else if (action === "cfm") {
      await this._handleConfirmAction(questionId, state, item);
    } else if (action === "oth") {
      await this._handleOtherAction(state);
    }
  }

  /** Handle single-select callback. */
  private async _handleSelectAction(
    questionId: string,
    state: { answers: QuestionAnswerPayload[]; currentIdx: number },
    item: QuestionItem,
    arg: string | undefined,
  ): Promise<void> {
    if (arg === undefined) return;
    const idx = Number(arg);
    const opt = item.options?.[idx];
    if (opt === undefined) return;
    state.answers[state.currentIdx] = { selected: [opt] };
    state.currentIdx++;
    await this.sendNextQuestion(questionId);
  }

  /** Handle multi-select toggle callback. */
  private async _handleToggleAction(
    questionId: string,
    state: { chatId: number; multiSelected: Set<number>; lastMessageId?: number },
    item: QuestionItem,
    arg: string | undefined,
  ): Promise<void> {
    if (arg === undefined || !this.poller) return;
    const idx = Number(arg);
    if (!item.options || idx < 0 || idx >= item.options.length) return;
    if (state.multiSelected.has(idx)) state.multiSelected.delete(idx);
    else state.multiSelected.add(idx);
    if (state.lastMessageId !== undefined) {
      try {
        await this.poller.editMessageReplyMarkup(state.chatId, state.lastMessageId, {
          inline_keyboard: this.buildMultiKeyboard(questionId, item, state.multiSelected),
        });
      } catch (err) {
        logger.warn(`[telegram] editMessageReplyMarkup failed: ${err}`);
      }
    }
  }

  /** Handle multi-select confirm callback. */
  private async _handleConfirmAction(
    questionId: string,
    state: { answers: QuestionAnswerPayload[]; currentIdx: number; multiSelected: Set<number> },
    item: QuestionItem,
  ): Promise<void> {
    const selected = [...state.multiSelected].sort((a, b) => a - b).map((i) => item.options![i]!);
    if (selected.length === 0) return;
    state.answers[state.currentIdx] = { selected };
    state.currentIdx++;
    await this.sendNextQuestion(questionId);
  }

  /** Handle "other" callback — switch to free-text mode. */
  private async _handleOtherAction(state: {
    chatId: number;
    awaitingFreeText: boolean;
  }): Promise<void> {
    if (!this.poller) return;
    state.awaitingFreeText = true;
    try {
      await this.poller.sendMessage(state.chatId, "💬 Reply with your custom answer:");
    } catch (err) {
      logger.warn(`[telegram] Failed to prompt for other: ${err}`);
    }
  }

  /**
   * Intercept a text reply when a pending question is awaiting free text.
   * Returns true when the text was consumed as an answer (caller should not
   * forward it to the normal message handler).
   */
  private async tryConsumeFreeTextAnswer(chatId: number, text: string): Promise<boolean> {
    for (const [questionId, state] of this.pendingQuestions) {
      if (!state.awaitingFreeText || state.chatId !== chatId) continue;
      const item = state.items[state.currentIdx];
      if (!item) continue;

      if (item.answerType === "free") {
        state.answers[state.currentIdx] = { selected: [], otherText: text };
      } else {
        // "Other" fallback on single/multi item — keep any toggled selections.
        const selected =
          item.answerType === "multi"
            ? [...state.multiSelected].sort((a, b) => a - b).map((i) => item.options![i]!)
            : [];
        state.answers[state.currentIdx] = { selected, otherText: text };
      }
      state.awaitingFreeText = false;
      state.currentIdx++;
      await this.sendNextQuestion(questionId);
      return true;
    }
    return false;
  }

  /**
   * Send an artifact as a Telegram document (downloadable file).
   */
  private async sendArtifactDocument(chatId: number, artifact: OutboundArtifact): Promise<void> {
    if (!this.poller) return;
    const ext = artifactExtension(artifact.artifactType, artifact.language);
    const filename = `${sanitizeFilename(artifact.title)}${ext}`;
    const buffer = Buffer.from(artifact.content, "utf-8");
    await this.poller.sendDocument(chatId, buffer, filename, `📎 ${artifact.title}`);
  }

  /**
   * Handle SuggestionsGenerated bus event — send inline keyboard with suggestion buttons.
   */
  private async handleSuggestionsGenerated(payload: {
    sessionId: string;
    messageId: string;
    suggestions: string[];
  }): Promise<void> {
    if (!this.poller || !this.lastChatId) return;

    const keyboard: TelegramInlineKeyboardButton[][] = payload.suggestions.map((s) => [
      {
        text: s,
        callback_data: `s:${encodeURIComponent(s).slice(0, 60)}`,
      },
    ]);

    try {
      await this.poller.sendMessage(this.lastChatId, "💡", undefined, {
        inline_keyboard: keyboard,
      });
    } catch (err) {
      logger.warn(`[telegram] Failed to send suggestions keyboard: ${err}`);
    }
  }

  /**
   * Handle a QuestionAsked bus event — set up sequential-question state and
   * send the first item to the last known chat.
   */
  private async handleQuestionAsked(payload: {
    questionId: string;
    questions?: QuestionItem[];
    question: string;
    options?: string[];
  }): Promise<void> {
    if (!this.poller || !this.lastChatId) return;

    // Normalize to QuestionItem[]. The bus event always carries `questions[]`
    // in v0.72+; we fall back to the legacy flat shape for older emitters.
    let items: QuestionItem[] = payload.questions ?? [];
    if (items.length === 0) {
      items = [
        {
          header: "",
          question: payload.question,
          answerType: (payload.options?.length ?? 0) > 0 ? "single" : "free",
          ...(payload.options !== undefined ? { options: payload.options } : {}),
          allowOther: false,
        },
      ];
    }

    this.pendingQuestions.set(payload.questionId, {
      items,
      chatId: this.lastChatId,
      currentIdx: 0,
      answers: [],
      multiSelected: new Set(),
      awaitingFreeText: false,
    });

    await this.sendNextQuestion(payload.questionId);
  }

  /**
   * Send the current-index item from the pending state.
   * Called on question start, and after each item is answered.
   */
  private async sendNextQuestion(questionId: string): Promise<void> {
    const state = this.pendingQuestions.get(questionId);
    if (!state || !this.poller) return;

    const item = state.items[state.currentIdx];
    if (!item) {
      // All items answered — resolve atomically.
      this.pendingQuestions.delete(questionId);
      const resolved = resolveQuestion(questionId, JSON.stringify(state.answers));
      if (!resolved) {
        logger.warn(`[telegram] resolveQuestion failed for ${questionId}`);
      }
      return;
    }

    const progress =
      state.items.length > 1 ? ` (${state.currentIdx + 1}/${state.items.length})` : "";
    const header = item.header ? `*${item.header}*\n` : "";
    const text = `❓${progress}\n${header}${item.question}`;

    if (item.answerType === "free") {
      await this._sendFreeTextQuestion(state, text);
      return;
    }

    state.awaitingFreeText = false;
    state.multiSelected.clear();
    const keyboard = this._buildQuestionKeyboard(questionId, item);

    try {
      const sent = await this.poller.sendMessage(state.chatId, text, undefined, {
        inline_keyboard: keyboard,
      });
      if (sent?.message_id !== undefined) state.lastMessageId = sent.message_id;
    } catch (err) {
      logger.warn(`[telegram] Failed to send question with keyboard: ${err}`);
    }
  }

  /** Send a free-text question (no keyboard). */
  private async _sendFreeTextQuestion(
    state: {
      chatId: number;
      awaitingFreeText: boolean;
      multiSelected: Set<number>;
      lastMessageId?: number;
    },
    text: string,
  ): Promise<void> {
    if (!this.poller) return;
    state.awaitingFreeText = true;
    state.multiSelected.clear();
    try {
      const sent = await this.poller.sendMessage(state.chatId, text);
      if (sent?.message_id !== undefined) state.lastMessageId = sent.message_id;
    } catch (err) {
      logger.warn(`[telegram] Failed to send free-text question: ${err}`);
    }
  }

  /** Build the inline keyboard for a single-select or multi-select question item. */
  private _buildQuestionKeyboard(
    questionId: string,
    item: QuestionItem,
  ): TelegramInlineKeyboardButton[][] {
    const options = item.options ?? [];
    const keyboard: TelegramInlineKeyboardButton[][] = [];

    if (item.answerType === "single") {
      for (let idx = 0; idx < options.length; idx++) {
        keyboard.push([{ text: options[idx]!, callback_data: `q:${questionId}:sel:${idx}` }]);
      }
    } else {
      // multi
      for (let idx = 0; idx < options.length; idx++) {
        keyboard.push([
          { text: `☐ ${options[idx]!}`, callback_data: `q:${questionId}:tog:${idx}` },
        ]);
      }
    }

    if (item.allowOther) {
      keyboard.push([{ text: "💬 Other (reply with text)", callback_data: `q:${questionId}:oth` }]);
    }

    if (item.answerType === "multi") {
      keyboard.push([{ text: "✅ Confirm", callback_data: `q:${questionId}:cfm` }]);
    }

    return keyboard;
  }

  /**
   * Build the current inline keyboard for the active multi-select item,
   * reflecting the toggle state with ☑️/☐ prefixes.
   */
  private buildMultiKeyboard(
    questionId: string,
    item: QuestionItem,
    selected: Set<number>,
  ): TelegramInlineKeyboardButton[][] {
    const options = item.options ?? [];
    const keyboard: TelegramInlineKeyboardButton[][] = [];
    for (let idx = 0; idx < options.length; idx++) {
      const prefix = selected.has(idx) ? "☑️" : "☐";
      keyboard.push([
        { text: `${prefix} ${options[idx]!}`, callback_data: `q:${questionId}:tog:${idx}` },
      ]);
    }
    if (item.allowOther) {
      keyboard.push([{ text: "💬 Other (reply with text)", callback_data: `q:${questionId}:oth` }]);
    }
    keyboard.push([{ text: "✅ Confirm", callback_data: `q:${questionId}:cfm` }]);
    return keyboard;
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

/** Map artifact type + language to a file extension */
function artifactExtension(artifactType: string, language?: string): string {
  if (artifactType === "code" && language) {
    const langMap: Record<string, string> = {
      python: ".py",
      typescript: ".ts",
      javascript: ".js",
      go: ".go",
      rust: ".rs",
      java: ".java",
      c: ".c",
      cpp: ".cpp",
      ruby: ".rb",
      php: ".php",
      swift: ".swift",
      kotlin: ".kt",
      shell: ".sh",
      bash: ".sh",
      sql: ".sql",
      yaml: ".yaml",
      toml: ".toml",
    };
    return langMap[language.toLowerCase()] ?? ".txt";
  }
  const typeMap: Record<string, string> = {
    code: ".txt",
    markdown: ".md",
    json: ".json",
    csv: ".csv",
    svg: ".svg",
    html: ".html",
  };
  return typeMap[artifactType] ?? ".txt";
}

/** Sanitize a string for use as a filename */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, "-")
    .slice(0, 60);
}
