/**
 * runtime/channel/pairing.ts
 *
 * Device pairing codes for the web-chat channel.
 *
 * Flow:
 *   1. Server generates an 8-char alphanumeric code (createPairingCode)
 *   2. User enters the code in the browser
 *   3. Browser presents the code on WS connect (validatePairingCode)
 *   4. Code is marked as used — cannot be reused
 *
 * Codes expire after TTL_MINUTES (default 15 min).
 * Expired codes are cleaned up lazily on each create/validate call.
 */

import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type { InstanceSlug } from "../types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CODE_LENGTH = 8;
const TTL_MINUTES = 15;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // unambiguous chars

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PairingCode {
  code: string;
  instanceSlug: InstanceSlug;
  channel: string;
  peerId: string | undefined;
  used: boolean;
  expiresAt: Date;
  createdAt: Date;
}

interface PairingCodeRow {
  code: string;
  instance_slug: string;
  channel: string;
  peer_id: string | null;
  used: number;
  expires_at: string;
  created_at: string;
}

function fromRow(row: PairingCodeRow): PairingCode {
  return {
    code: row.code,
    instanceSlug: row.instance_slug,
    channel: row.channel,
    peerId: row.peer_id ?? undefined,
    used: row.used === 1,
    expiresAt: new Date(row.expires_at),
    createdAt: new Date(row.created_at),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a new pairing code for an instance.
 * Cleans up expired codes before creating.
 */
export function createPairingCode(
  db: Database.Database,
  instanceSlug: InstanceSlug,
  options?: { channel?: string; ttlMinutes?: number },
): PairingCode {
  cleanExpiredCodes(db);

  const code = generateCode();
  const ttl = options?.ttlMinutes ?? TTL_MINUTES;
  const channel = options?.channel ?? "web";
  const expiresAt = new Date(Date.now() + ttl * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO rt_pairing_codes (code, instance_slug, channel, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(code, instanceSlug, channel, expiresAt, now);

  const row = db
    .prepare("SELECT * FROM rt_pairing_codes WHERE code = ?")
    .get(code) as PairingCodeRow;
  return fromRow(row);
}

/**
 * Validate a pairing code.
 * Returns the code record if valid (not expired, not used).
 * Marks the code as used on success.
 */
export function validatePairingCode(db: Database.Database, code: string): PairingCode | undefined {
  cleanExpiredCodes(db);

  const row = db
    .prepare("SELECT * FROM rt_pairing_codes WHERE code = ?")
    .get(code.toUpperCase()) as PairingCodeRow | undefined;

  if (!row) return undefined;

  const record = fromRow(row);

  // Check expiry
  if (record.expiresAt < new Date()) return undefined;

  // Check already used
  if (record.used) return undefined;

  // Mark as used
  db.prepare("UPDATE rt_pairing_codes SET used = 1 WHERE code = ?").run(code.toUpperCase());

  return { ...record, used: true };
}

/**
 * Get a pairing code record (without consuming it).
 */
export function getPairingCode(db: Database.Database, code: string): PairingCode | undefined {
  const row = db
    .prepare("SELECT * FROM rt_pairing_codes WHERE code = ?")
    .get(code.toUpperCase()) as PairingCodeRow | undefined;
  return row ? fromRow(row) : undefined;
}

/**
 * List active (unused, non-expired) pairing codes for an instance.
 */
export function listPairingCodes(db: Database.Database, instanceSlug: InstanceSlug): PairingCode[] {
  const now = new Date().toISOString();
  const rows = db
    .prepare(
      `SELECT * FROM rt_pairing_codes
       WHERE instance_slug = ? AND used = 0 AND expires_at > ?
       ORDER BY created_at DESC`,
    )
    .all(instanceSlug, now) as PairingCodeRow[];
  return rows.map(fromRow);
}

/**
 * Delete a pairing code explicitly.
 */
export function deletePairingCode(db: Database.Database, code: string): void {
  db.prepare("DELETE FROM rt_pairing_codes WHERE code = ?").run(code.toUpperCase());
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function generateCode(): string {
  // Use nanoid entropy but map to our unambiguous alphabet
  const raw = nanoid(CODE_LENGTH * 2); // extra entropy
  let result = "";
  for (let i = 0; i < raw.length && result.length < CODE_LENGTH; i++) {
    const charCode = raw.charCodeAt(i) % ALPHABET.length;
    result += ALPHABET[charCode];
  }
  return result;
}

function cleanExpiredCodes(db: Database.Database): void {
  const now = new Date().toISOString();
  db.prepare("DELETE FROM rt_pairing_codes WHERE expires_at <= ?").run(now);
}
