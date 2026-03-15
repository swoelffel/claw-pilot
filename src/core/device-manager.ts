// src/core/device-manager.ts
//
// Manages device pairing codes via the rt_pairing_codes DB table.
// Uses the rt_pairing_codes DB table for pairing code management.

import type Database from "better-sqlite3";
import {
  createPairingCode,
  listPairingCodes,
  deletePairingCode,
  getPairingCode,
  type PairingCode,
} from "../runtime/channel/pairing.js";

export interface PairingCodeInfo {
  code: string;
  channel: string;
  used: boolean;
  used_at: string | null;
  expires_at: string;
  created_at: string;
}

export class DeviceManager {
  constructor(private db: Database.Database) {}

  /**
   * List active (unused, non-expired) pairing codes for an instance.
   * Returns an array of PairingCodeInfo.
   */
  list(instanceSlug: string): PairingCodeInfo[] {
    const codes = listPairingCodes(this.db, instanceSlug);
    return codes.map(toPairingCodeInfo);
  }

  /**
   * Create a new pairing code for an instance.
   */
  create(
    instanceSlug: string,
    options?: { channel?: string; ttlMinutes?: number },
  ): PairingCodeInfo {
    const code = createPairingCode(this.db, instanceSlug, options);
    return toPairingCodeInfo(code);
  }

  /**
   * Revoke (delete) a pairing code.
   * Returns true if the code existed and was deleted, false otherwise.
   */
  revoke(_instanceSlug: string, code: string): boolean {
    const existing = getPairingCode(this.db, code);
    if (!existing) return false;
    deletePairingCode(this.db, code);
    return true;
  }
}

function toPairingCodeInfo(code: PairingCode): PairingCodeInfo {
  return {
    code: code.code,
    channel: code.channel,
    used: code.used,
    used_at: null, // rt_pairing_codes doesn't track used_at separately
    expires_at: code.expiresAt.toISOString(),
    created_at: code.createdAt.toISOString(),
  };
}
