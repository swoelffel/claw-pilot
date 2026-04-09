/**
 * runtime/channel/whatsapp/cloud-api-transport.ts
 *
 * WhatsApp Cloud API transport — uses Meta's official Business API.
 * Runs an HTTP webhook server for inbound messages and REST calls for outbound.
 */

import * as http from "node:http";
import type { WhatsAppTransport, TransportInboundMessage } from "./transport.js";
import { WhatsAppApiClient, verifyWebhook, type WhatsAppWebhookPayload } from "./api-client.js";
import { logger } from "../../../lib/logger.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CloudApiTransportOptions {
  /** Env var name that holds the long-lived access token */
  accessTokenEnvVar: string;
  /** Meta phone number ID */
  phoneNumberId: string;
  /** Env var name that holds the webhook verify token */
  verifyTokenEnvVar: string;
  /** Port for the webhook HTTP server */
  webhookPort: number;
}

// ---------------------------------------------------------------------------
// CloudApiTransport
// ---------------------------------------------------------------------------

export class CloudApiTransport implements WhatsAppTransport {
  private client: WhatsAppApiClient | undefined;
  private server: http.Server | undefined;
  private handler: ((msg: TransportInboundMessage) => void) | undefined;
  private readonly options: CloudApiTransportOptions;

  constructor(options: CloudApiTransportOptions) {
    this.options = options;
  }

  onMessage(handler: (msg: TransportInboundMessage) => void): void {
    this.handler = handler;
  }

  async connect(): Promise<void> {
    if (this.server) return;

    const token = process.env[this.options.accessTokenEnvVar];
    if (!token) {
      logger.warn(
        `[whatsapp:cloud-api] Access token env var "${this.options.accessTokenEnvVar}" is not set — disabled.`,
      );
      return;
    }

    if (!this.options.phoneNumberId) {
      logger.warn("[whatsapp:cloud-api] Phone number ID is not configured — disabled.");
      return;
    }

    this.client = new WhatsAppApiClient({
      accessToken: token,
      phoneNumberId: this.options.phoneNumberId,
    });

    this.server = http.createServer((req, res) => {
      void this.handleHttpRequest(req, res);
    });

    const srv = this.server;
    await new Promise<void>((resolve, reject) => {
      srv.once("listening", resolve);
      srv.once("error", reject);
      srv.listen(this.options.webhookPort);
    });

    logger.info(
      `[whatsapp:cloud-api] Webhook server listening on port ${this.options.webhookPort}`,
    );
  }

  async sendTextMessage(phoneNumber: string, text: string): Promise<void> {
    if (!this.client) throw new Error("Cloud API transport not connected");
    await this.client.sendTextMessage(phoneNumber, text);
  }

  async markMessageAsRead(messageId: string): Promise<void> {
    if (!this.client) return;
    await this.client.markMessageAsRead(messageId);
  }

  async disconnect(): Promise<void> {
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

    if (req.method === "POST") {
      const body = await readBody(req);
      let payload: WhatsAppWebhookPayload;
      try {
        payload = JSON.parse(body) as WhatsAppWebhookPayload;
      } catch {
        res.writeHead(400).end("Bad Request");
        return;
      }

      res.writeHead(200).end("OK");
      this.processWebhookPayload(payload);
      return;
    }

    res.writeHead(405).end("Method Not Allowed");
  }

  private processWebhookPayload(payload: WhatsAppWebhookPayload): void {
    if (!this.handler) return;

    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        if (change.field !== "messages") continue;
        const messages = change.value.messages ?? [];
        const contacts = change.value.contacts ?? [];

        for (const msg of messages) {
          if (msg.type !== "text" || !msg.text?.body) continue;
          const contact = contacts.find((c) => c.wa_id === msg.from);
          this.handler({
            from: msg.from,
            id: msg.id,
            text: msg.text.body,
            ...(contact?.profile.name !== undefined ? { contactName: contact.profile.name } : {}),
          });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
