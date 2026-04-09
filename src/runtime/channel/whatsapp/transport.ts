/**
 * runtime/channel/whatsapp/transport.ts
 *
 * Common transport interface for WhatsApp messaging backends.
 * Both the official Cloud API and the Baileys WebSocket client implement this.
 */

// ---------------------------------------------------------------------------
// Transport interface
// ---------------------------------------------------------------------------

/**
 * Normalized inbound message from any WhatsApp transport.
 * The transport extracts the relevant fields from its native format.
 */
export interface TransportInboundMessage {
  /** Phone number of the sender (E.164 without +) */
  from: string;
  /** Transport-specific message ID */
  id: string;
  /** Text body */
  text: string;
  /** Contact display name, if available */
  contactName?: string;
}

/**
 * Abstract transport layer for WhatsApp messaging.
 *
 * Implementations:
 *   - CloudApiTransport: Meta Business Cloud API (webhook + REST)
 *   - BaileysTransport: Baileys WebSocket (reverse-engineered protocol)
 */
export interface WhatsAppTransport {
  /** Start the transport (webhook server or WebSocket connection) */
  connect(): Promise<void>;

  /** Send a text message to a phone number (E.164 without +) */
  sendTextMessage(phoneNumber: string, text: string): Promise<void>;

  /** Mark a message as read (best-effort, no-op if unsupported) */
  markMessageAsRead(messageId: string): Promise<void>;

  /** Gracefully shut down */
  disconnect(): Promise<void>;

  /** Register handler for inbound messages */
  onMessage(handler: (msg: TransportInboundMessage) => void): void;

  /** Current connection status */
  getStatus(): "connected" | "disconnected" | "not_configured";
}
