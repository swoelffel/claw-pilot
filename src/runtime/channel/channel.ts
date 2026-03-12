/**
 * runtime/channel/channel.ts
 *
 * Core Channel interface — every transport (web-chat, telegram, …) implements this.
 */

import type { InboundMessage, OutboundMessage } from "../types.js";

// ---------------------------------------------------------------------------
// Channel interface
// ---------------------------------------------------------------------------

/**
 * A Channel connects an external messaging transport to the runtime.
 *
 * Lifecycle:
 *   connect() → [messages flow] → disconnect()
 *
 * The channel calls `onMessage` for every inbound message and receives
 * outbound messages via `send()`.
 */
export interface Channel {
  /** Unique identifier for this channel type (e.g. "web", "telegram") */
  readonly type: string;

  /**
   * Start the channel (open WS server, start polling, etc.).
   * Must be idempotent — calling connect() on an already-connected channel is a no-op.
   */
  connect(): Promise<void>;

  /**
   * Send an outbound message to a peer.
   */
  send(message: OutboundMessage): Promise<void>;

  /**
   * Stop the channel gracefully.
   */
  disconnect(): Promise<void>;

  /**
   * Register the handler that will be called for every inbound message.
   * Must be called before connect().
   */
  onMessage(handler: (message: InboundMessage) => Promise<void>): void;
}

// ---------------------------------------------------------------------------
// Channel error
// ---------------------------------------------------------------------------

export class ChannelError extends Error {
  public readonly channelType: string;
  public override readonly cause?: unknown;

  constructor(channelType: string, message: string, cause?: unknown) {
    super(`[${channelType}] ${message}`);
    this.name = "ChannelError";
    this.channelType = channelType;
    this.cause = cause;
  }
}
