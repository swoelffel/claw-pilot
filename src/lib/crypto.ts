import * as path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { readEnvVar, writeEnvVar, removeEnvVar } from "./dotenv.js";
import { getDataDir } from "./platform.js";
import { PROVIDER_CATALOG } from "./provider-catalog.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// ---------------------------------------------------------------------------
// Secure random generation
// ---------------------------------------------------------------------------

/** Generate a cryptographically secure random hex string (via OS entropy pool). */
export function generateSecureHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

/** Generate a 48-char hex gateway auth token (24 bytes). */
export function generateGatewayToken(): string {
  return generateSecureHex(24);
}

/** Generate a 64-char hex dashboard access token (32 bytes). */
export function generateDashboardToken(): string {
  return generateSecureHex(32);
}

// ---------------------------------------------------------------------------
// Master encryption key management
// ---------------------------------------------------------------------------

/**
 * Ensure MASTER_ENCRYPTION_KEY is available in process.env.
 * Resolution: process.env → ~/.claw-pilot/.env → auto-generate.
 * Returns true if the key was freshly generated.
 */
export async function ensureMasterEncryptionKey(): Promise<boolean> {
  if (isCryptoAvailable()) return false;

  const envPath = path.join(getDataDir(), ".env");
  const envVar = "MASTER_ENCRYPTION_KEY";

  // Check global .env file
  const existing = readEnvVar(envPath, envVar);
  if (existing && existing.length >= 64) {
    process.env[envVar] = existing;
    return false;
  }

  // Generate and persist
  const key = generateSecureHex(32);
  await writeEnvVar(envPath, envVar, key);
  process.env[envVar] = key;
  return true;
}

// ---------------------------------------------------------------------------
// TODO(cleanup): remove after v0.62 — user_providers table is deprecated.
// This migration reads API keys from the global .env, encrypts them into
// named_api_keys, then cleans up the old user_providers rows and .env entries.
// ---------------------------------------------------------------------------

interface UserProviderRow {
  id: number;
  provider_id: string;
  api_key_env_var: string;
  base_url: string | null;
}

/**
 * Migrate user_providers API keys to named_api_keys (encrypted).
 * Idempotent — skips providers already migrated. Runs at dashboard startup.
 * Returns the number of keys migrated.
 */
export async function migrateUserProvidersToNamedKeys(db: Database.Database): Promise<number> {
  if (!isCryptoAvailable()) return 0;

  const rows = db
    .prepare("SELECT id, provider_id, api_key_env_var, base_url FROM user_providers")
    .all() as UserProviderRow[];

  if (rows.length === 0) return 0;

  // Lazy import to avoid circular dependency (named-key-repository → crypto)
  const { NamedKeyRepository } = await import("../core/repositories/named-key-repository.js");
  const repo = new NamedKeyRepository(db);

  const envPath = path.join(getDataDir(), ".env");
  const existingKeys = new Set(repo.listAll().map((k) => k.name));
  let migrated = 0;

  for (const row of rows) {
    const apiKey = readEnvVar(envPath, row.api_key_env_var);
    if (!apiKey) continue; // No key in .env — skip

    const catalogEntry = PROVIDER_CATALOG.find((p) => p.id === row.provider_id);
    const name = `${catalogEntry?.label ?? row.provider_id} (migrated)`;

    if (existingKeys.has(name)) continue; // Already migrated — idempotent

    const defaultModel = catalogEntry?.defaultModel ?? `${row.provider_id}/default`;

    repo.create({
      name,
      providerId: row.provider_id,
      apiKey,
      defaultModel,
      ...(row.base_url ? { baseUrl: row.base_url } : {}),
    });

    await removeEnvVar(envPath, row.api_key_env_var);
    db.prepare("DELETE FROM user_providers WHERE id = ?").run(row.id);
    existingKeys.add(name);
    migrated++;
  }

  return migrated;
}

// ---------------------------------------------------------------------------
// AES-256-GCM encryption
// ---------------------------------------------------------------------------

/**
 * Check whether the MASTER_ENCRYPTION_KEY env var is set.
 * Named API key feature requires this to be available.
 */
export function isCryptoAvailable(): boolean {
  return (
    typeof process.env.MASTER_ENCRYPTION_KEY === "string" &&
    process.env.MASTER_ENCRYPTION_KEY.length >= 64
  );
}

function getMasterKey(): Buffer {
  const hex = process.env.MASTER_ENCRYPTION_KEY;
  if (!hex || hex.length < 64) {
    throw new Error(
      "MASTER_ENCRYPTION_KEY environment variable is missing or too short (need 64 hex chars = 32 bytes).",
    );
  }
  return Buffer.from(hex.slice(0, 64), "hex");
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns `<iv_hex>:<auth_tag_hex>:<ciphertext_hex>`.
 */
export function encrypt(plaintext: string): string {
  const key = getMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt a ciphertext string produced by `encrypt()`.
 */
export function decrypt(ciphertext: string): string {
  const key = getMasterKey();
  const [ivHex, authTagHex, encryptedHex] = ciphertext.split(":");
  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error("Invalid ciphertext format — expected iv:authTag:ciphertext");
  }
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final("utf8");
}
