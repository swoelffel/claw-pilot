// src/core/secrets/snapshot.ts
import { randomBytes } from "node:crypto";
import type { SecretProvider } from "./index.js";

/**
 * Frozen, synchronously-readable view of the secrets required at bootstrap.
 *
 * Motivation: `encrypt()` / `decrypt()` in `src/lib/crypto.ts` are
 * synchronous and run on the hot path (every `named_api_keys` read/write).
 * Introducing a blanket async provider would force an `await` cascade
 * through 3–4 layers of callers. Instead, we resolve the handful of
 * always-needed global secrets once at bootstrap and expose them as a
 * frozen object. Per-instance secrets (Telegram bot token, web-chat
 * token) stay lazy — they are already read in async contexts.
 *
 * Enterprise implementations can replace `refresh()` to re-fetch from
 * Vault on a TTL; Community treats the snapshot as effectively immutable
 * for the process lifetime.
 */
export interface SecretsSnapshot {
  /** 64-char hex (32 bytes) AES-256-GCM master key. */
  readonly masterEncryptionKey: string;
  /** Re-read global secrets from the provider. No-op for env. */
  refresh(): Promise<void>;
}

const MASTER_ENCRYPTION_KEY = "MASTER_ENCRYPTION_KEY";

/**
 * Build a secrets snapshot. Generates and persists the master encryption
 * key on first run if it is absent.
 */
export async function buildSnapshot(provider: SecretProvider): Promise<SecretsSnapshot> {
  let master = await resolveMasterKey(provider);

  const snapshot: SecretsSnapshot = {
    get masterEncryptionKey() {
      return master;
    },
    async refresh() {
      master = await resolveMasterKey(provider);
    },
  };
  return snapshot;
}

async function resolveMasterKey(provider: SecretProvider): Promise<string> {
  if (await provider.has(MASTER_ENCRYPTION_KEY)) {
    const value = await provider.get(MASTER_ENCRYPTION_KEY);
    if (value.length >= 64) return value;
  }
  // First run — generate and persist.
  const key = randomBytes(32).toString("hex");
  if (!provider.set) {
    throw new Error(
      `SecretProvider "${provider.kind}" cannot persist a new MASTER_ENCRYPTION_KEY (set() not implemented)`,
    );
  }
  await provider.set(MASTER_ENCRYPTION_KEY, key);
  return key;
}
