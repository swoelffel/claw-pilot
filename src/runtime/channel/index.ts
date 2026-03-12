/**
 * runtime/channel/index.ts
 *
 * Public API for the channel subsystem.
 */

export type { Channel } from "./channel.js";
export { ChannelError } from "./channel.js";
export { ChannelRouter } from "./router.js";
export type { RouterInput, RouterResult } from "./router.js";
export { WebChatChannel } from "./web-chat.js";
export { TelegramChannel } from "./telegram/channel.js";
export type { TelegramChannelOptions } from "./telegram/channel.js";
export { markdownToTelegramV2, escapeTelegramV2 } from "./telegram/formatter.js";
export { TelegramPoller } from "./telegram/polling.js";
export type {
  TelegramUpdate,
  TelegramMessage,
  TelegramUser,
  TelegramChat,
} from "./telegram/polling.js";
export {
  createPairingCode,
  validatePairingCode,
  getPairingCode,
  listPairingCodes,
  deletePairingCode,
} from "./pairing.js";
export type { PairingCode } from "./pairing.js";
