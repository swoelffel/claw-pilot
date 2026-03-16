/**
 * ui/src/services/ws-monitor.ts
 *
 * WebSocket lifecycle management for the claw-pilot dashboard.
 * Extracted from app.ts to keep the root component focused on rendering.
 *
 * Auth protocol: instead of passing the token as a URL query parameter
 * (which appears in server logs, browser history, and proxy logs), the
 * client sends a first applicative message { type: "auth", token: "..." }
 * immediately after the connection opens. The server validates this message
 * and only then adds the client to the monitor.
 */

import type { WsMessage } from "../types.js";
import { getToken } from "./auth-state.js";

const RECONNECT_DELAY_MS = 5_000;

export class WsMonitor {
  private _ws: WebSocket | null = null;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _connected = false;
  private _destroyed = false;

  constructor(
    private readonly _onMessage: (msg: WsMessage) => void,
    private readonly _onConnected: () => void,
    private readonly _onDisconnected: () => void,
  ) {}

  get connected(): boolean {
    return this._connected;
  }

  connect(): void {
    this._destroyed = false;
    this._open();
  }

  disconnect(): void {
    this._destroyed = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._ws?.close();
    this._ws = null;
    this._connected = false;
  }

  private _open(): void {
    if (this._destroyed) return;

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${location.host}/ws`;

    try {
      this._ws = new WebSocket(url);
    } catch {
      this._scheduleReconnect();
      return;
    }

    this._ws.addEventListener("open", () => {
      // Send auth message immediately after connection opens.
      // The server waits for this message before adding the client to the monitor.
      const token = getToken();
      this._ws?.send(JSON.stringify({ type: "auth", token }));
      this._connected = true;
      this._onConnected();
    });

    this._ws.addEventListener("close", () => {
      this._connected = false;
      this._onDisconnected();
      this._scheduleReconnect();
    });

    this._ws.addEventListener("error", () => {
      this._connected = false;
    });

    this._ws.addEventListener("message", (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(ev.data as string) as WsMessage;
        this._onMessage(msg);
        // Broadcast to child components via window event
        window.dispatchEvent(new CustomEvent("cp-ws-message", { detail: msg }));
      } catch {
        // Ignore malformed messages
      }
    });
  }

  private _scheduleReconnect(): void {
    if (this._destroyed || this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._open();
    }, RECONNECT_DELAY_MS);
  }
}
