/**
 * runtime/channel/whatsapp/api-client.ts
 *
 * WhatsApp Business Cloud API client.
 * Uses Node.js native `https` — no external SDK dependency.
 *
 * API reference: https://developers.facebook.com/docs/whatsapp/cloud-api
 */

import * as https from "node:https";

// ---------------------------------------------------------------------------
// WhatsApp Cloud API types (minimal subset)
// ---------------------------------------------------------------------------

/** Inbound webhook payload from Meta */
export interface WhatsAppWebhookPayload {
  object: string;
  entry: WhatsAppWebhookEntry[];
}

interface WhatsAppWebhookEntry {
  id: string;
  changes: WhatsAppWebhookChange[];
}

interface WhatsAppWebhookChange {
  value: {
    messaging_product: string;
    metadata: { display_phone_number: string; phone_number_id: string };
    contacts?: WhatsAppContact[];
    messages?: WhatsAppInboundMessage[];
    statuses?: unknown[];
  };
  field: string;
}

interface WhatsAppContact {
  profile: { name: string };
  wa_id: string;
}

export interface WhatsAppInboundMessage {
  from: string;
  id: string;
  timestamp: string;
  type: "text" | "image" | "audio" | "document" | "location" | "reaction" | "interactive";
  text?: { body: string };
}

// ---------------------------------------------------------------------------
// Webhook verification
// ---------------------------------------------------------------------------

/**
 * Verify a WhatsApp webhook subscription request from Meta.
 *
 * Meta sends a GET request with:
 *   hub.mode=subscribe
 *   hub.verify_token=<your_token>
 *   hub.challenge=<random_string>
 *
 * @returns The challenge string if verification passes, undefined otherwise.
 */
export function verifyWebhook(
  query: { mode?: string; verify_token?: string; challenge?: string },
  expectedToken: string,
): string | undefined {
  if (query.mode === "subscribe" && query.verify_token === expectedToken) {
    return query.challenge;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// WhatsAppApiClient
// ---------------------------------------------------------------------------

interface WhatsAppApiClientOptions {
  /** Long-lived access token from Meta Business */
  accessToken: string;
  /** Phone number ID from WhatsApp Business dashboard */
  phoneNumberId: string;
}

export class WhatsAppApiClient {
  private readonly accessToken: string;
  private readonly phoneNumberId: string;
  private readonly baseUrl: string;

  constructor(options: WhatsAppApiClientOptions) {
    this.accessToken = options.accessToken;
    this.phoneNumberId = options.phoneNumberId;
    this.baseUrl = `https://graph.facebook.com/v21.0/${options.phoneNumberId}`;
  }

  /**
   * Send a text message to a WhatsApp user.
   * @param to - Recipient phone number in E.164 format without + (e.g. "33612345678")
   * @param text - Message body
   */
  async sendTextMessage(to: string, text: string): Promise<void> {
    const payload = JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: text },
    });

    await this.post("/messages", payload);
  }

  /**
   * Mark a message as read (sends blue checkmarks to the sender).
   */
  async markMessageAsRead(messageId: string): Promise<void> {
    const payload = JSON.stringify({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    });

    await this.post("/messages", payload);
  }

  // -------------------------------------------------------------------------
  // Internal HTTP helper
  // -------------------------------------------------------------------------

  private async post(path: string, body: string): Promise<string> {
    const url = `${this.baseUrl}${path}`;
    return httpsPost(url, body, this.accessToken);
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers (native Node.js https)
// ---------------------------------------------------------------------------

function httpsPost(url: string, body: string, bearerToken: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options: https.RequestOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        Authorization: `Bearer ${bearerToken}`,
      },
    };

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode !== undefined && res.statusCode >= 300) {
          reject(new Error(`WhatsApp API error ${res.statusCode}: ${body}`));
        } else {
          resolve(body);
        }
      });
      res.on("error", reject);
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
