import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getSecretProvider } from "../core/secrets/index.js";

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
 * Ensure MASTER_ENCRYPTION_KEY is available in process.env, delegating
 * all persistence to the registered `SecretProvider` (R5 — no direct
 * `process.env` / `.env` access for secrets). Returns true if the key
 * was freshly generated.
 *
 * Extension point: Enterprise providers (Vault, AWS SM) hydrate the key
 * from their backend via the same contract — `has()` / `get()` / `set()`.
 */
export async function ensureMasterEncryptionKey(): Promise<boolean> {
  if (isCryptoAvailable()) return false;

  const envVar = "MASTER_ENCRYPTION_KEY";
  const provider = getSecretProvider();

  if (await provider.has(envVar)) {
    const existing = await provider.get(envVar);
    if (existing.length >= 64) {
      process.env[envVar] = existing;
      return false;
    }
  }

  // Generate and persist via the provider. `EnvSecretProvider.set()`
  // writes to `<stateDir>/.env` and mirrors into process.env; other
  // providers (Enterprise) are free to skip the mirror.
  const key = generateSecureHex(32);
  if (!provider.set) {
    throw new Error(
      `SecretProvider "${provider.kind}" cannot persist MASTER_ENCRYPTION_KEY (set() not implemented)`,
    );
  }
  await provider.set(envVar, key);
  process.env[envVar] = key;
  return true;
}

// ---------------------------------------------------------------------------
// AES-256-GCM encryption
// ---------------------------------------------------------------------------

/**
 * Check whether the MASTER_ENCRYPTION_KEY is hydrated in process.env.
 * Named API key feature requires this to be available.
 *
 * R5 snapshot exemption — `ensureMasterEncryptionKey()` primes process.env
 * via `secretProvider.set()`; subsequent reads stay synchronous to keep
 * `encrypt()` / `decrypt()` off the async cascade on the hot path. The
 * H9 `no-direct-secret-access` lint rule allowlists this file.
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
  // Empty plaintext short-circuits to an empty ciphertext. Historically we
  // encrypted anyway, which produced "iv:authTag:" (ciphertext segment empty).
  // That value failed decrypt()'s non-empty-segment check and propagated as a
  // 500 out of list endpoints. Storing "" is unambiguous and safe: nothing to
  // protect, and decrypt("") round-trips to "".
  if (plaintext === "") return "";
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
  // Round-trip for keyless providers (encrypt("") returns "").
  if (ciphertext === "") return "";
  const key = getMasterKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid ciphertext format — expected iv:authTag:ciphertext");
  }
  const [ivHex, authTagHex, encryptedHex] = parts as [string, string, string];
  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error("Invalid ciphertext format — empty segment");
  }
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");
  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid IV length: expected ${IV_LENGTH}, got ${iv.length}`);
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error(`Invalid auth tag length: expected ${AUTH_TAG_LENGTH}, got ${authTag.length}`);
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final("utf8");
}
