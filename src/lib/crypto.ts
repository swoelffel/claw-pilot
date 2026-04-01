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
// TODO(cleanup): remove after v0.62 — instance .env API keys are deprecated.
// This migration reads API keys from instance .env files, deduplicates them,
// encrypts into named_api_keys, assigns to instances, and cleans up .env.
// ---------------------------------------------------------------------------

interface InstanceRow {
  id: number;
  slug: string;
  state_dir: string | null;
  default_model: string | null;
}

/**
 * Migrate instance-level API keys from .env files to named_api_keys.
 * Deduplicates: if multiple instances share the same key for a provider,
 * only one named_api_key is created and assigned to all.
 * Idempotent — skips instances already assigned named keys.
 * Returns the number of keys migrated.
 */
export async function migrateInstanceProvidersToNamedKeys(db: Database.Database): Promise<number> {
  if (!isCryptoAvailable()) return 0;

  const { NamedKeyRepository } = await import("../core/repositories/named-key-repository.js");
  const { PROVIDER_ENV_VARS } = await import("./providers.js");
  const repo = new NamedKeyRepository(db);

  const instances = db
    .prepare("SELECT id, slug, state_dir, default_model FROM instances WHERE state_dir IS NOT NULL")
    .all() as InstanceRow[];

  if (instances.length === 0) return 0;

  // Cache: provider_id → Map<rawApiKey, namedKeyId> for deduplication
  const keyCache = new Map<string, Map<string, number>>();

  // Pre-populate cache with existing named keys
  for (const nk of repo.listAll()) {
    const raw = repo.decryptApiKey(nk.id);
    if (!keyCache.has(nk.providerId)) keyCache.set(nk.providerId, new Map());
    keyCache.get(nk.providerId)!.set(raw, nk.id);
  }

  let migrated = 0;

  for (const inst of instances) {
    if (!inst.state_dir) continue;

    // Skip if instance already has a default named key assigned
    const existingDefault = db
      .prepare("SELECT default_named_key_id FROM instances WHERE id = ?")
      .get(inst.id) as { default_named_key_id: number | null } | undefined;
    if (existingDefault?.default_named_key_id) continue;

    const envPath = path.join(inst.state_dir, ".env");

    // Try each known provider env var
    for (const [providerId, envVar] of Object.entries(PROVIDER_ENV_VARS)) {
      const apiKey = readEnvVar(envPath, envVar);
      if (!apiKey) continue;

      // Check deduplication cache
      let namedKeyId: number | undefined;
      const providerCache = keyCache.get(providerId);
      if (providerCache) {
        namedKeyId = providerCache.get(apiKey);
      }

      // Create new named key if not found
      if (namedKeyId === undefined) {
        const catalogEntry = PROVIDER_CATALOG.find((p) => p.id === providerId);
        const label = catalogEntry?.label ?? providerId;

        // Build unique name: "Anthropic" or "Anthropic (2)" if name taken
        let name = label;
        const allNames = new Set(repo.listAll().map((k) => k.name));
        if (allNames.has(name)) {
          let suffix = 2;
          while (allNames.has(`${label} (${suffix})`)) suffix++;
          name = `${label} (${suffix})`;
        }

        const defaultModel =
          inst.default_model ?? catalogEntry?.defaultModel ?? `${providerId}/default`;

        const created = repo.create({
          name,
          providerId,
          apiKey,
          defaultModel,
        });
        namedKeyId = created.id;

        // Update cache
        if (!keyCache.has(providerId)) keyCache.set(providerId, new Map());
        keyCache.get(providerId)!.set(apiKey, namedKeyId);
      }

      // Determine if this is the default provider for the instance
      const isDefault = inst.default_model
        ? inst.default_model.startsWith(`${providerId}/`)
        : false;

      if (isDefault) {
        db.prepare("UPDATE instances SET default_named_key_id = ? WHERE id = ?").run(
          namedKeyId,
          inst.id,
        );
      }
      await removeEnvVar(envPath, envVar);
      migrated++;
    }
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
