/**
 * runtime/channel/whatsapp/baileys-transport.ts
 *
 * WhatsApp transport using Baileys (reverse-engineered WebSocket protocol).
 * Allows using a personal WhatsApp number — no Meta Business account needed.
 *
 * WARNING: This violates WhatsApp's Terms of Service.
 * Use a dedicated/burner number — risk of permanent ban.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { WhatsAppTransport, TransportInboundMessage } from "./transport.js";
import { logger } from "../../../lib/logger.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface BaileysTransportOptions {
  /** Directory to persist auth state (creds.json, signal keys, etc.) */
  sessionDir: string;
  /** Called when a QR code is generated (for display in dashboard/logs) */
  onQrCode?: (qr: string) => void;
}

// ---------------------------------------------------------------------------
// Status file helpers (for dashboard polling)
// ---------------------------------------------------------------------------

interface BaileysStatusFile {
  connected: boolean;
  qrCode: string | null;
  phoneNumber: string | null;
  updatedAt: string;
}

function writeStatusFile(sessionDir: string, status: BaileysStatusFile): void {
  try {
    const filePath = path.join(sessionDir, "status.json");
    fs.writeFileSync(filePath, JSON.stringify(status, null, 2));
  } catch {
    // Non-critical — dashboard polling will see stale data
  }
}

// ---------------------------------------------------------------------------
// BaileysTransport
// ---------------------------------------------------------------------------

export class BaileysTransport implements WhatsAppTransport {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sock: any;
  private handler: ((msg: TransportInboundMessage) => void) | undefined;
  private readonly options: BaileysTransportOptions;
  private _connected = false;
  private _phoneNumber: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectAttempts = 0;

  constructor(options: BaileysTransportOptions) {
    this.options = options;
  }

  onMessage(handler: (msg: TransportInboundMessage) => void): void {
    this.handler = handler;
  }

  async connect(): Promise<void> {
    if (this.sock) return;

    if (!this.options.sessionDir) {
      logger.warn("[whatsapp:baileys] Session directory not configured — disabled.");
      return;
    }

    // Ensure session directory exists
    fs.mkdirSync(this.options.sessionDir, { recursive: true });

    // Dynamic import to avoid loading Baileys when not needed
    const baileys = await import("@whiskeysockets/baileys");
    const { useMultiFileAuthState } = baileys;
    const makeWASocket = baileys.default;
    const { DisconnectReason } = baileys;

    const { state, saveCreds } = await useMultiFileAuthState(this.options.sessionDir);

    // Create a silent pino logger to suppress Baileys' verbose output
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let silentLogger: any;
    try {
      const pino = (await import("pino" as string)).default;
      silentLogger = pino({ level: "silent" });
    } catch {
      // pino not available — Baileys will use its default logger
      silentLogger = undefined;
    }

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      ...(silentLogger !== undefined ? { logger: silentLogger } : {}),
      browser: ["claw-pilot", "Desktop", "1.0.0"],
    });
    this.sock = sock;

    // Persist credentials on update
    sock.ev.on("creds.update", () => {
      void saveCreds();
    });

    // Connection state management
    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      // QR code for authentication
      if (qr) {
        logger.info("[whatsapp:baileys] QR code generated — scan with WhatsApp mobile app");
        this.options.onQrCode?.(qr);
        writeStatusFile(this.options.sessionDir, {
          connected: false,
          qrCode: qr,
          phoneNumber: null,
          updatedAt: new Date().toISOString(),
        });
      }

      if (connection === "open") {
        this._connected = true;
        this.reconnectAttempts = 0;
        // Extract phone number from socket state
        const me = sock.user;
        this._phoneNumber = me?.id?.replace(/:.*@.*/, "") ?? null;
        logger.info(
          `[whatsapp:baileys] Connected${this._phoneNumber ? ` as ${this._phoneNumber}` : ""}`,
        );
        writeStatusFile(this.options.sessionDir, {
          connected: true,
          qrCode: null,
          phoneNumber: this._phoneNumber,
          updatedAt: new Date().toISOString(),
        });
      }

      if (connection === "close") {
        this._connected = false;
        const statusCode =
          (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode ?? 0;

        if (statusCode === DisconnectReason.loggedOut) {
          logger.warn("[whatsapp:baileys] Logged out — session cleared, re-scan QR needed");
          // Clear session files so next connect() starts fresh
          this.clearSessionFiles();
          writeStatusFile(this.options.sessionDir, {
            connected: false,
            qrCode: null,
            phoneNumber: null,
            updatedAt: new Date().toISOString(),
          });
        } else {
          // Transient error — reconnect with backoff
          this.scheduleReconnect();
        }
        this.sock = undefined;
      }
    });

    // Inbound messages
    sock.ev.on("messages.upsert", (upsert) => {
      if (!this.handler) return;
      if (upsert.type !== "notify") return; // Only real-time messages, not history

      for (const msg of upsert.messages) {
        if (!msg.message || msg.key.fromMe) continue;

        // Extract text from various message types
        const text = msg.message.conversation ?? msg.message.extendedTextMessage?.text ?? undefined;

        if (!text) continue;

        // Convert JID to phone number: "33612345678@s.whatsapp.net" → "33612345678"
        const jid = msg.key.remoteJid;
        if (!jid || jid.endsWith("@g.us")) continue; // Skip group messages
        const phoneNumber = jid.replace(/@.*/, "");

        // Get contact name from push name
        const contactName = msg.pushName ?? undefined;

        this.handler({
          from: phoneNumber,
          id: msg.key.id ?? "",
          text,
          ...(contactName !== undefined ? { contactName } : {}),
        });
      }
    });
  }

  async sendTextMessage(phoneNumber: string, text: string): Promise<void> {
    if (!this.sock) throw new Error("Baileys transport not connected");
    const jid = `${phoneNumber}@s.whatsapp.net`;
    await this.sock.sendMessage(jid, { text });
  }

  async markMessageAsRead(messageId: string): Promise<void> {
    // Baileys read receipts require remoteJid which we don't have here.
    // This is a best-effort no-op for now.
    void messageId;
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.sock) {
      this.sock.end(undefined);
      this.sock = undefined;
    }
    this._connected = false;
    writeStatusFile(this.options.sessionDir, {
      connected: false,
      qrCode: null,
      phoneNumber: this._phoneNumber,
      updatedAt: new Date().toISOString(),
    });
  }

  getStatus(): "connected" | "disconnected" | "not_configured" {
    if (!this.options.sessionDir) return "not_configured";
    if (this._connected) return "connected";
    return "disconnected";
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= 5) {
      logger.error("[whatsapp:baileys] Max reconnect attempts reached — giving up");
      return;
    }
    const delayMs = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000);
    this.reconnectAttempts++;
    logger.info(
      `[whatsapp:baileys] Reconnecting in ${delayMs}ms (attempt ${this.reconnectAttempts})`,
    );
    this.reconnectTimer = setTimeout(() => {
      void this.connect();
    }, delayMs);
  }

  private clearSessionFiles(): void {
    try {
      const files = fs.readdirSync(this.options.sessionDir);
      for (const file of files) {
        if (file === "status.json") continue; // Keep status file
        fs.unlinkSync(path.join(this.options.sessionDir, file));
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}
