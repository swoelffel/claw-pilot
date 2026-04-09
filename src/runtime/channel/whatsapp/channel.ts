/**
 * runtime/channel/whatsapp/channel.ts
 *
 * WhatsAppChannel — implements the Channel interface using webhooks.
 *
 * Design:
 * - One default agent handles all messages (no per-user bindings)
 * - peerId = "whatsapp:<phone_number>"
 * - Responses are sent as WhatsApp-formatted text (plain-text fallback on error)
 * - Access token read from process.env[accessTokenEnvVar]
 * - Inbound messages arrive via webhook: the channel runs its own HTTP server
 *   (same pattern as WebChatChannel running its own WS server)
 *
 * Pairing:
 * - dmPolicy: "pairing" generates a pairing code for unknown users
 * - No group policy — WhatsApp Business API is 1-to-1 only
 */

import * as http from "node:http";
import type Database from "better-sqlite3";
import type { Channel } from "../channel.js";
import type { InboundMessage, OutboundMessage } from "../../types.js";
import { ChannelError } from "../channel.js";
import { WhatsAppApiClient, verifyWebhook, type WhatsAppWebhookPayload } from "./api-client.js";
import { markdownToWhatsApp } from "./formatter.js";
import { createPairingCode, listPairingCodes } from "../pairing.js";
import { logger } from "../../../lib/logger.js";
import { getBus } from "../../bus/index.js";
import { QuestionAsked } from "../../bus/events.js";

// ---------------------------------------------------------------------------
// WhatsAppChannel
// ---------------------------------------------------------------------------

export interface WhatsAppChannelOptions {
  /** Env var name that holds the long-lived access token */
  accessTokenEnvVar: string;
  /** Meta phone number ID */
  phoneNumberId: string;
  /** Env var name that holds the webhook verify token */
  verifyTokenEnvVar: string;
  /** Port for the webhook HTTP server */
  webhookPort: number;
  /** Allowed phone numbers in E.164 format without + (empty = all) */
  allowedPhoneNumbers?: string[];
  /** DM policy: pairing (code approval), open (all), allowlist (static numbers), disabled */
  dmPolicy?: "pairing" | "open" | "allowlist" | "disabled";
  /** DB + slug needed for pairing code generation */
  db?: Database.Database;
  instanceSlug?: string;
}

export class WhatsAppChannel implements Channel {
  readonly type = "whatsapp";

  private client: WhatsAppApiClient | undefined;
  private server: http.Server | undefined;
  private handler: ((msg: InboundMessage) => Promise<void>) | undefined;
  private readonly options: WhatsAppChannelOptions;
  private busUnsub: (() => void) | undefined;
  /** Track last known phone number for sending question messages */
  private lastPhoneNumber: string | undefined;

  constructor(options: WhatsAppChannelOptions) {
    this.options = options;
  }

  onMessage(handler: (msg: InboundMessage) => Promise<void>): void {
    this.handler = handler;
  }

  async connect(): Promise<void> {
    if (this.server) return; // idempotent

    const token = process.env[this.options.accessTokenEnvVar];
    if (!token) {
      logger.warn(
        `[whatsapp] Access token env var "${this.options.accessTokenEnvVar}" is not set — WhatsApp channel disabled until token is configured.`,
      );
      return;
    }

    if (!this.options.phoneNumberId) {
      logger.warn("[whatsapp] Phone number ID is not configured — WhatsApp channel disabled.");
      return;
    }

    this.client = new WhatsAppApiClient({
      accessToken: token,
      phoneNumberId: this.options.phoneNumberId,
    });

    // Start webhook HTTP server
    this.server = http.createServer((req, res) => {
      void this.handleHttpRequest(req, res);
    });

    const srv = this.server;
    await new Promise<void>((resolve, reject) => {
      srv.once("listening", resolve);
      srv.once("error", reject);
      srv.listen(this.options.webhookPort);
    });

    logger.info(`[whatsapp] Webhook server listening on port ${this.options.webhookPort}`);

    // Subscribe to question events
    if (this.options.instanceSlug) {
      const bus = getBus(this.options.instanceSlug);
      this.busUnsub = bus.subscribe(QuestionAsked, (payload) => {
        void this.handleQuestionAsked(payload);
      });
    }
  }

  async send(message: OutboundMessage): Promise<void> {
    if (!this.client) {
      throw new ChannelError("whatsapp", "Channel not connected");
    }

    const phoneNumber = parsePhoneNumber(message.peerId);
    if (phoneNumber === undefined) {
      throw new ChannelError("whatsapp", `Invalid peerId: ${message.peerId}`);
    }

    // Try WhatsApp formatting first, fall back to plain text
    const formatted = markdownToWhatsApp(message.text);
    try {
      await this.client.sendTextMessage(phoneNumber, formatted);
    } catch {
      await this.client.sendTextMessage(phoneNumber, message.text);
    }
  }

  async disconnect(): Promise<void> {
    this.busUnsub?.();
    this.busUnsub = undefined;

    if (this.server) {
      const srv = this.server;
      this.server = undefined;
      await new Promise<void>((resolve) => {
        srv.close(() => resolve());
      });
    }

    this.client = undefined;
  }

  getStatus(): "connected" | "disconnected" | "not_configured" {
    if (!this.client) return "not_configured";
    if (!this.server) return "disconnected";
    return "connected";
  }

  // ---------------------------------------------------------------------------
  // HTTP webhook handler
  // ---------------------------------------------------------------------------

  private async handleHttpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    // GET — Meta webhook verification
    if (req.method === "GET") {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");

      const expectedToken = process.env[this.options.verifyTokenEnvVar];
      if (!expectedToken) {
        res.writeHead(503).end("Verify token not configured");
        return;
      }

      const result = verifyWebhook(
        {
          ...(mode !== null ? { mode } : {}),
          ...(token !== null ? { verify_token: token } : {}),
          ...(challenge !== null ? { challenge } : {}),
        },
        expectedToken,
      );
      if (result !== undefined) {
        res.writeHead(200, { "Content-Type": "text/plain" }).end(result);
        return;
      }

      res.writeHead(403).end("Forbidden");
      return;
    }

    // POST — Inbound messages from Meta
    if (req.method === "POST") {
      const body = await readBody(req);
      let payload: WhatsAppWebhookPayload;
      try {
        payload = JSON.parse(body) as WhatsAppWebhookPayload;
      } catch {
        res.writeHead(400).end("Bad Request");
        return;
      }

      // Respond immediately — process async
      res.writeHead(200).end("OK");
      void this.processWebhookPayload(payload);
      return;
    }

    res.writeHead(405).end("Method Not Allowed");
  }

  // ---------------------------------------------------------------------------
  // Webhook payload processing
  // ---------------------------------------------------------------------------

  private async processWebhookPayload(payload: WhatsAppWebhookPayload): Promise<void> {
    if (!this.handler) return;

    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        if (change.field !== "messages") continue;

        const messages = change.value.messages ?? [];
        const contacts = change.value.contacts ?? [];

        for (const msg of messages) {
          if (msg.type !== "text" || !msg.text?.body) continue;
          await this.processInboundMessage(msg, contacts);
        }
      }
    }
  }

  private async processInboundMessage(
    msg: { from: string; id: string; text?: { body: string } },
    contacts: Array<{ profile: { name: string }; wa_id: string }>,
  ): Promise<void> {
    if (!this.handler || !msg.text?.body) return;

    const phoneNumber = msg.from;
    const peerId = `whatsapp:${phoneNumber}`;
    this.lastPhoneNumber = phoneNumber;

    const contact = contacts.find((c) => c.wa_id === phoneNumber);
    const contactName = contact?.profile.name;

    if (!this.isUserAllowed(phoneNumber)) {
      const policy = this.options.dmPolicy ?? "pairing";
      if (policy === "pairing" && this.options.db && this.options.instanceSlug) {
        await this.handlePairingRequest(phoneNumber, contactName);
      }
      return;
    }

    // Mark as read (fire-and-forget)
    if (this.client) {
      void this.client.markMessageAsRead(msg.id).catch(() => {});
    }

    const inbound: InboundMessage = {
      channelType: "whatsapp",
      peerId,
      text: msg.text.body,
    };

    await this.handler(inbound);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private isUserAllowed(phoneNumber: string): boolean {
    if (
      this.options.allowedPhoneNumbers === undefined ||
      this.options.allowedPhoneNumbers.length === 0
    ) {
      return true;
    }
    return this.options.allowedPhoneNumbers.includes(phoneNumber);
  }

  private async handlePairingRequest(phoneNumber: string, contactName?: string): Promise<void> {
    if (!this.options.db || !this.options.instanceSlug || !this.client) return;

    const peerId = `whatsapp:${phoneNumber}`;
    const existingCode = this.getExistingPairingCode(peerId);
    let code: string;

    if (existingCode) {
      code = existingCode;
    } else {
      const record = createPairingCode(this.options.db, this.options.instanceSlug, {
        channel: "whatsapp",
        ttlMinutes: 60,
        peerId,
        ...(contactName !== undefined ? { meta: { name: contactName } } : {}),
      });
      code = record.code;
    }

    const formatted = `${code.slice(0, 4)}-${code.slice(4)}`;
    const text =
      `Hello! To connect to this assistant, send this code to your admin:\n\n` +
      `*${formatted}*\n\n` +
      `This code expires in 60 minutes.`;

    try {
      await this.client.sendTextMessage(phoneNumber, text);
    } catch (err) {
      logger.warn(`[whatsapp] Failed to send pairing message: ${err}`);
    }
  }

  private getExistingPairingCode(peerId: string): string | undefined {
    if (!this.options.db || !this.options.instanceSlug) return undefined;
    const existing = listPairingCodes(this.options.db, this.options.instanceSlug).find(
      (p) => p.channel === "whatsapp" && p.peerId === peerId,
    );
    return existing?.code;
  }

  private async handleQuestionAsked(payload: {
    questionId: string;
    question: string;
    options?: string[];
  }): Promise<void> {
    if (!this.client || !this.lastPhoneNumber) return;

    const options = payload.options ?? [];
    let text = `❓ ${payload.question}`;

    if (options.length > 0) {
      const optionList = options.map((opt, idx) => `${idx + 1}. ${opt}`).join("\n");
      text += `\n\n${optionList}`;
    }

    try {
      await this.client.sendTextMessage(this.lastPhoneNumber, text);
    } catch (err) {
      logger.warn(`[whatsapp] Failed to send question: ${err}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePhoneNumber(peerId: string): string | undefined {
  const match = /^whatsapp:(\d+)$/.exec(peerId);
  if (!match) return undefined;
  return match[1];
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
