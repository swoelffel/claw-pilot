/**
 * runtime/channel/web-chat.ts
 *
 * WebChatChannel — built-in WebSocket channel for the claw-pilot dashboard.
 *
 * Protocol (JSON over WS):
 *   Client → Server: { type: "message", text: string }
 *   Server → Client: { type: "message", text: string }
 *                    { type: "part", delta: string }   (streaming token)
 *                    { type: "error", message: string }
 *
 * Auth: Bearer token in the `Authorization` header on the WS upgrade request,
 * or `?token=<value>` query param (for browser clients).
 *
 * Each WS connection is a peer — peerId is derived from the connection's
 * remote address + a nanoid suffix to ensure uniqueness.
 */

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import { nanoid } from "nanoid";
import { timingSafeEqual } from "node:crypto";
import type { Channel } from "./channel.js";
import type { InboundMessage, OutboundMessage } from "../types.js";
import { ChannelError } from "./channel.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WebChatOptions {
  /** Port to listen on */
  port: number;
  /** Auth token (hex string) — clients must present this */
  token: string;
  /** Max concurrent connections */
  maxConnections?: number;
}

interface ClientMessage {
  type: "message";
  text: string;
}

interface ServerMessage {
  type: "message" | "part" | "error";
  text?: string;
  delta?: string;
  message?: string;
}

// ---------------------------------------------------------------------------
// WebChatChannel
// ---------------------------------------------------------------------------

export class WebChatChannel implements Channel {
  readonly type = "web";

  private wss: WebSocketServer | undefined;
  private handler: ((msg: InboundMessage) => Promise<void>) | undefined;
  private peers = new Map<string, WebSocket>();
  private readonly options: Required<WebChatOptions>;

  constructor(options: WebChatOptions) {
    this.options = {
      maxConnections: 10,
      ...options,
    };
  }

  onMessage(handler: (msg: InboundMessage) => Promise<void>): void {
    this.handler = handler;
  }

  async connect(): Promise<void> {
    if (this.wss) return; // idempotent

    const wss = new WebSocketServer({ port: this.options.port });
    this.wss = wss;

    wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      // Auth check
      if (!this.authenticate(req)) {
        ws.close(4401, "Unauthorized");
        return;
      }

      // Connection limit
      if (this.peers.size >= this.options.maxConnections) {
        ws.close(4429, "Too many connections");
        return;
      }

      const peerId = buildPeerId(req);
      this.peers.set(peerId, ws);

      ws.on("message", (data) => {
        void this.handleRawMessage(peerId, data.toString());
      });

      ws.on("close", () => {
        this.peers.delete(peerId);
      });

      ws.on("error", () => {
        this.peers.delete(peerId);
      });
    });

    await new Promise<void>((resolve, reject) => {
      wss.once("listening", resolve);
      wss.once("error", reject);
    });
  }

  async send(message: OutboundMessage): Promise<void> {
    const ws = this.peers.get(message.peerId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      // Peer disconnected — silently drop
      return;
    }

    const payload: ServerMessage = { type: "message", text: message.text };
    ws.send(JSON.stringify(payload));
  }

  async disconnect(): Promise<void> {
    if (!this.wss) return;

    for (const ws of this.peers.values()) {
      ws.close(1001, "Server shutting down");
    }
    this.peers.clear();

    await new Promise<void>((resolve) => {
      this.wss!.close(() => resolve());
    });
    this.wss = undefined;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async handleRawMessage(peerId: string, raw: string): Promise<void> {
    if (!this.handler) return;

    let parsed: ClientMessage;
    try {
      parsed = JSON.parse(raw) as ClientMessage;
    } catch {
      this.sendError(peerId, "Invalid JSON");
      return;
    }

    if (parsed.type !== "message" || typeof parsed.text !== "string") {
      this.sendError(peerId, "Expected { type: 'message', text: string }");
      return;
    }

    const inbound: InboundMessage = {
      channelType: "web",
      peerId,
      text: parsed.text,
      raw: parsed,
    };

    try {
      await this.handler(inbound);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.sendError(peerId, msg);
    }
  }

  private sendError(peerId: string, message: string): void {
    const ws = this.peers.get(peerId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const payload: ServerMessage = { type: "error", message };
    ws.send(JSON.stringify(payload));
  }

  private authenticate(req: IncomingMessage): boolean {
    const expected = Buffer.from(this.options.token, "utf8");

    // Check Authorization header
    const authHeader = req.headers["authorization"];
    if (authHeader?.startsWith("Bearer ")) {
      const provided = Buffer.from(authHeader.slice(7), "utf8");
      if (provided.length === expected.length) {
        try {
          return timingSafeEqual(provided, expected);
        } catch {
          return false;
        }
      }
    }

    // Check query param
    const url = new URL(req.url ?? "/", "http://localhost");
    const tokenParam = url.searchParams.get("token");
    if (tokenParam) {
      const provided = Buffer.from(tokenParam, "utf8");
      if (provided.length === expected.length) {
        try {
          return timingSafeEqual(provided, expected);
        } catch {
          return false;
        }
      }
    }

    return false;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPeerId(req: IncomingMessage): string {
  const addr = req.socket.remoteAddress ?? "unknown";
  return `web:${addr}:${nanoid(8)}`;
}

// Re-export ChannelError for convenience
export { ChannelError };
