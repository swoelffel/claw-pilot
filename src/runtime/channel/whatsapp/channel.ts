/**
 * runtime/channel/whatsapp/channel.ts
 *
 * WhatsAppChannel — implements the Channel interface with pluggable transports.
 *
 * Supported modes:
 *   - "cloud-api": Meta Business Cloud API (webhook + REST) — official, no ban risk
 *   - "baileys": Baileys WebSocket (reverse-engineered) — personal number, ban risk
 *
 * Shared logic (independent of transport):
 *   - peerId = "whatsapp:<phone_number>"
 *   - DM policy (pairing, open, allowlist, disabled)
 *   - Pairing code flow
 *   - Markdown → WhatsApp formatting
 *   - QuestionAsked bus events
 */

import type Database from "better-sqlite3";
import type { Channel } from "../channel.js";
import type { InboundMessage, OutboundMessage } from "../../types.js";
import { ChannelError } from "../channel.js";
import type { WhatsAppTransport, TransportInboundMessage } from "./transport.js";
import { CloudApiTransport } from "./cloud-api-transport.js";
import { markdownToWhatsApp } from "./formatter.js";
import { createPairingCode, listPairingCodes } from "../pairing.js";
import { logger } from "../../../lib/logger.js";
import { getBus } from "../../bus/index.js";
import { QuestionAsked } from "../../bus/events.js";

// ---------------------------------------------------------------------------
// WhatsAppChannel
// ---------------------------------------------------------------------------

export interface WhatsAppChannelOptions {
  /** Transport mode */
  mode: "cloud-api" | "baileys";
  // Cloud API fields (used only when mode === "cloud-api")
  accessTokenEnvVar: string;
  phoneNumberId: string;
  verifyTokenEnvVar: string;
  webhookPort: number;
  // Baileys fields (used only when mode === "baileys")
  sessionDir?: string;
  onQrCode?: (qr: string) => void;
  // Shared fields
  allowedPhoneNumbers?: string[];
  dmPolicy?: "pairing" | "open" | "allowlist" | "disabled";
  db?: Database.Database;
  instanceSlug?: string;
}

export class WhatsAppChannel implements Channel {
  readonly type = "whatsapp";

  private transport: WhatsAppTransport | undefined;
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
    if (this.transport) return; // idempotent

    // Create the right transport based on mode
    if (this.options.mode === "baileys") {
      // Lazy import to avoid loading Baileys when not needed
      const { BaileysTransport } = await import("./baileys-transport.js");
      this.transport = new BaileysTransport({
        sessionDir: this.options.sessionDir ?? "",
        ...(this.options.onQrCode !== undefined ? { onQrCode: this.options.onQrCode } : {}),
      });
    } else {
      this.transport = new CloudApiTransport({
        accessTokenEnvVar: this.options.accessTokenEnvVar,
        phoneNumberId: this.options.phoneNumberId,
        verifyTokenEnvVar: this.options.verifyTokenEnvVar,
        webhookPort: this.options.webhookPort,
      });
    }

    // Register transport message handler — transport is guaranteed to be set by the if/else above
    const transport = this.transport!;
    transport.onMessage((msg) => {
      void this.processTransportMessage(msg);
    });

    await transport.connect();

    // Subscribe to question events
    if (this.options.instanceSlug) {
      const bus = getBus(this.options.instanceSlug);
      this.busUnsub = bus.subscribe(QuestionAsked, (payload) => {
        void this.handleQuestionAsked(payload);
      });
    }
  }

  async send(message: OutboundMessage): Promise<void> {
    if (!this.transport) {
      throw new ChannelError("whatsapp", "Channel not connected");
    }

    const phoneNumber = parsePhoneNumber(message.peerId);
    if (phoneNumber === undefined) {
      throw new ChannelError("whatsapp", `Invalid peerId: ${message.peerId}`);
    }

    const formatted = markdownToWhatsApp(message.text);
    try {
      await this.transport.sendTextMessage(phoneNumber, formatted);
    } catch {
      // Fallback: send as plain text
      await this.transport.sendTextMessage(phoneNumber, message.text);
    }
  }

  async disconnect(): Promise<void> {
    this.busUnsub?.();
    this.busUnsub = undefined;
    await this.transport?.disconnect();
    this.transport = undefined;
  }

  getStatus(): "connected" | "disconnected" | "not_configured" {
    return this.transport?.getStatus() ?? "not_configured";
  }

  // ---------------------------------------------------------------------------
  // Transport message processing (shared logic for both modes)
  // ---------------------------------------------------------------------------

  private async processTransportMessage(msg: TransportInboundMessage): Promise<void> {
    if (!this.handler) return;

    const phoneNumber = msg.from;
    const peerId = `whatsapp:${phoneNumber}`;
    this.lastPhoneNumber = phoneNumber;

    if (!this.isUserAllowed(phoneNumber)) {
      const policy = this.options.dmPolicy ?? "pairing";
      if (policy === "pairing" && this.options.db && this.options.instanceSlug) {
        await this.handlePairingRequest(phoneNumber, msg.contactName);
      }
      return;
    }

    // Mark as read (fire-and-forget)
    if (this.transport) {
      void this.transport.markMessageAsRead(msg.id).catch(() => {});
    }

    const inbound: InboundMessage = {
      channelType: "whatsapp",
      peerId,
      text: msg.text,
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
    if (!this.options.db || !this.options.instanceSlug || !this.transport) return;

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
      await this.transport.sendTextMessage(phoneNumber, text);
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
    if (!this.transport || !this.lastPhoneNumber) return;

    const options = payload.options ?? [];
    let text = `❓ ${payload.question}`;

    if (options.length > 0) {
      const optionList = options.map((opt, idx) => `${idx + 1}. ${opt}`).join("\n");
      text += `\n\n${optionList}`;
    }

    try {
      await this.transport.sendTextMessage(this.lastPhoneNumber, text);
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
