// src/core/telegram-pairing-manager.ts
//
// Reads Telegram DM pairing files and wraps `openclaw pairing approve telegram <CODE>`.
// Always uses ServerConnection — never child_process or fs directly.
// Mirrors the DeviceManager pattern exactly.

import type { ServerConnection } from "../server/connection.js";
import { shellEscape } from "../lib/shell.js";
import { constants } from "../lib/constants.js";

export interface TelegramPairingRequest {
  /** Telegram numeric user ID (string) */
  id: string;
  /** 8-char uppercase pairing code */
  code: string;
  /** ISO timestamp — request created */
  createdAt: string;
  /** ISO timestamp — last contact from this user */
  lastSeenAt: string;
  /** Channel-specific metadata */
  meta: { accountId?: string; username?: string };
}

export interface TelegramPairingList {
  pending: TelegramPairingRequest[];
  /** Array of approved Telegram user IDs */
  approved: string[];
}

interface RawPairingFile {
  version?: number;
  requests?: TelegramPairingRequest[];
}

interface RawAllowFromFile {
  version?: number;
  allowFrom?: string[];
}

export class TelegramPairingManager {
  constructor(private conn: ServerConnection) {}

  /**
   * Read telegram-pairing.json (pending) + telegram-allowFrom.json (approved).
   * Returns empty lists if files don't exist.
   */
  async list(stateDir: string): Promise<TelegramPairingList> {
    const pendingPath = `${stateDir}/credentials/telegram-pairing.json`;
    const approvedPath = `${stateDir}/credentials/telegram-allowFrom.json`;

    let pending: TelegramPairingRequest[] = [];
    let approved: string[] = [];

    try {
      const raw = await this.conn.readFile(pendingPath);
      const parsed = JSON.parse(raw) as RawPairingFile;
      pending = parsed.requests ?? [];
    } catch {
      // File doesn't exist or unreadable — return empty list
    }

    try {
      const raw = await this.conn.readFile(approvedPath);
      const parsed = JSON.parse(raw) as RawAllowFromFile;
      approved = parsed.allowFrom ?? [];
    } catch {
      // File doesn't exist or unreadable — return empty list
    }

    return { pending, approved };
  }

  /** Approve a pending DM pairing request via `openclaw pairing approve telegram <CODE>` */
  async approve(stateDir: string, code: string): Promise<void> {
    if (!/^[A-Z0-9]{1,32}$/.test(code)) {
      throw new Error(`Invalid pairing code format: ${code}`);
    }
    const result = await this.conn.exec(
      `${constants.OPENCLAW_PATH_PREFIX} && OPENCLAW_STATE_DIR=${stateDir} openclaw pairing approve telegram ${shellEscape(code)}`,
    );
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || "pairing approve failed");
    }
  }
}
