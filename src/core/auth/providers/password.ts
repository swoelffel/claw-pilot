// src/core/auth/providers/password.ts
import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";
import { logger } from "../../../lib/logger.js";
import type { AuthProvider, AuthResult } from "../provider.js";

const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384; // N=2^14, OWASP recommendation
const SCRYPT_BLOCK_SIZE = 8; // r
const SCRYPT_PARALLELIZATION = 1; // p

// Alphabet without ambiguous characters: no 0/O/1/l/I
const PASSWORD_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PASSWORD_LENGTH = 16;

/** Promisified scrypt with options — typed manually to avoid @types/node overload issues */
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/**
 * Hash a password using scrypt.
 * Returns a string in the format: "scrypt:<salt_hex_32>:<hash_hex_128>".
 *
 * Public utility — consumed by user-creation flows (CLI `auth` command,
 * e2e seed helpers). Not tied to any specific AuthProvider instance.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
  });
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

/**
 * Verify a password against a stored hash string.
 * Returns false (never throws) if the format is invalid or the password is wrong.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split(":");
    if (parts.length !== 3 || parts[0] !== "scrypt") return false;

    const [, saltHex, hashHex] = parts;
    if (!saltHex || !hashHex) return false;

    const salt = Buffer.from(saltHex, "hex");
    const expectedHash = Buffer.from(hashHex, "hex");

    if (expectedHash.length !== SCRYPT_KEYLEN) return false;

    const computedHash = await scryptAsync(password, salt, SCRYPT_KEYLEN, {
      N: SCRYPT_COST,
      r: SCRYPT_BLOCK_SIZE,
      p: SCRYPT_PARALLELIZATION,
    });

    return timingSafeEqual(expectedHash, computedHash);
  } catch (err) {
    logger.warn("[auth] password verification failed (crypto error)", { error: String(err) });
    return false;
  }
}

/**
 * Generate a random human-readable password.
 * 16 characters from an alphabet without ambiguous chars (0/O/1/l/I).
 * Entropy: ~95 bits (log2(57^16)).
 */
export function generatePassword(): string {
  const bytes = randomBytes(PASSWORD_LENGTH);
  let password = "";
  for (let i = 0; i < PASSWORD_LENGTH; i++) {
    password += PASSWORD_ALPHABET[bytes[i]! % PASSWORD_ALPHABET.length];
  }
  return password;
}

/** Credentials shape accepted by `PasswordProvider.authenticate()`. */
export interface PasswordCredentials {
  username: string;
  password: string;
}

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: string;
}

/**
 * Default Community auth backend: looks up a user in the `users` table and
 * verifies their password with scrypt.
 *
 * Instantiated once per dashboard process and registered via
 * `registerAuthProvider()` during bootstrap. Carries the `db` handle needed
 * to perform the user lookup.
 */
export class PasswordProvider implements AuthProvider {
  readonly kind = "password";

  constructor(private readonly db: Database.Database) {}

  async authenticate(credentials: unknown): Promise<AuthResult> {
    if (!isPasswordCredentials(credentials)) {
      return {
        ok: false,
        code: "INVALID_CREDENTIALS_SHAPE",
        message: "Expected { username, password }",
      };
    }

    const { username, password } = credentials;

    const row = this.db
      .prepare("SELECT id, username, password_hash, role FROM users WHERE username = ?")
      .get(username) as UserRow | undefined;

    const valid = row ? await verifyPassword(password, row.password_hash) : false;

    if (!row || !valid) {
      return { ok: false, code: "INVALID_CREDENTIALS", message: "Invalid credentials" };
    }

    return {
      ok: true,
      user: { id: row.id, username: row.username, role: row.role },
    };
  }
}

function isPasswordCredentials(value: unknown): value is PasswordCredentials {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v["username"] === "string" && typeof v["password"] === "string";
}
