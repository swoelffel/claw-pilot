// src/core/repositories/named-key-repository.ts
//
// CRUD operations for named_api_keys and instance_named_keys tables.

import type Database from "better-sqlite3";
import { encrypt, decrypt } from "../../lib/crypto.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A named API key record as returned from the DB (with masked key). */
export interface NamedApiKeyRecord {
  id: number;
  name: string;
  providerId: string;
  defaultModel: string;
  baseUrl: string | null;
  apiKeyMasked: string;
  createdAt: string;
  updatedAt: string;
}

/** Input for creating a new named API key. */
export interface NamedKeyCreateData {
  name: string;
  providerId: string;
  apiKey: string;
  defaultModel: string;
  baseUrl?: string | null;
}

/** Input for updating an existing named API key. */
export interface NamedKeyUpdateData {
  name?: string;
  defaultModel?: string;
  baseUrl?: string | null;
  apiKey?: string;
}

/** Named key record as seen from an instance's perspective. */
export interface InstanceNamedKeyRecord {
  namedKeyId: number;
  name: string;
  providerId: string;
  defaultModel: string;
  baseUrl: string | null;
  isDefault: boolean;
}

// ---------------------------------------------------------------------------
// Raw DB row shapes (internal, snake_case columns)
// ---------------------------------------------------------------------------

interface RawNamedApiKeyRow {
  id: number;
  name: string;
  provider_id: string;
  encrypted_api_key: string;
  default_model: string;
  base_url: string | null;
  created_at: string;
  updated_at: string;
}

interface RawInstanceNamedKeyRow {
  named_key_id: number;
  name: string;
  provider_id: string;
  default_model: string;
  base_url: string | null;
  is_default: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Produce a display-safe masked version of an API key.
 * Shows first 4 and last 4 chars; replaces the middle with asterisks (max 20).
 */
function maskApiKey(plaintext: string): string {
  if (plaintext.length <= 8) return "****";
  return (
    plaintext.slice(0, 4) + "*".repeat(Math.min(plaintext.length - 8, 20)) + plaintext.slice(-4)
  );
}

function rowToRecord(row: RawNamedApiKeyRow): NamedApiKeyRecord {
  return {
    id: row.id,
    name: row.name,
    providerId: row.provider_id,
    defaultModel: row.default_model,
    baseUrl: row.base_url,
    apiKeyMasked: maskApiKey(decrypt(row.encrypted_api_key)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class NamedKeyRepository {
  constructor(private db: Database.Database) {}

  // --- named_api_keys CRUD ---

  /**
   * Create a new named API key. The raw apiKey is encrypted before storage.
   * Returns the record with a masked key.
   */
  create(data: NamedKeyCreateData): NamedApiKeyRecord {
    const encryptedKey = encrypt(data.apiKey);
    const result = this.db
      .prepare(
        `INSERT INTO named_api_keys (name, provider_id, encrypted_api_key, default_model, base_url)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(data.name, data.providerId, encryptedKey, data.defaultModel, data.baseUrl ?? null);

    return this.getById(result.lastInsertRowid as number)!;
  }

  /**
   * Get a named API key by id. Returns null if not found.
   * The returned record has a masked key (not the raw API key).
   */
  getById(id: number): NamedApiKeyRecord | null {
    const row = this.db.prepare("SELECT * FROM named_api_keys WHERE id = ?").get(id) as
      | RawNamedApiKeyRow
      | undefined;
    return row ? rowToRecord(row) : null;
  }

  /**
   * List all named API keys, ordered by name.
   * All records have masked keys.
   */
  listAll(): NamedApiKeyRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM named_api_keys ORDER BY name ASC")
      .all() as RawNamedApiKeyRow[];
    return rows.map(rowToRecord);
  }

  /**
   * Update fields on an existing named API key.
   * If apiKey is provided it is re-encrypted.
   * Throws if the key does not exist.
   */
  update(id: number, data: NamedKeyUpdateData): NamedApiKeyRecord {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (data.name !== undefined) {
      sets.push("name = ?");
      values.push(data.name);
    }
    if (data.defaultModel !== undefined) {
      sets.push("default_model = ?");
      values.push(data.defaultModel);
    }
    if (data.baseUrl !== undefined) {
      sets.push("base_url = ?");
      values.push(data.baseUrl);
    }
    if (data.apiKey !== undefined) {
      sets.push("encrypted_api_key = ?");
      values.push(encrypt(data.apiKey));
    }

    if (sets.length === 0) {
      // Nothing to update — still verify existence
      const existing = this.getById(id);
      if (!existing) throw new Error(`Named API key not found: ${id}`);
      return existing;
    }

    sets.push("updated_at = datetime('now')");
    values.push(id);

    const info = this.db
      .prepare(`UPDATE named_api_keys SET ${sets.join(", ")} WHERE id = ?`)
      .run(...values);

    if (info.changes === 0) {
      throw new Error(`Named API key not found: ${id}`);
    }

    return this.getById(id)!;
  }

  /**
   * Delete a named API key by id.
   * Throws (FK RESTRICT) if the key is still assigned to any instance.
   */
  delete(id: number): void {
    this.db.prepare("DELETE FROM named_api_keys WHERE id = ?").run(id);
  }

  /**
   * Decrypt and return the raw API key for the given named key id.
   * Throws if the key does not exist.
   */
  decryptApiKey(id: number): string {
    const row = this.db
      .prepare("SELECT encrypted_api_key FROM named_api_keys WHERE id = ?")
      .get(id) as Pick<RawNamedApiKeyRow, "encrypted_api_key"> | undefined;

    if (!row) throw new Error(`Named API key not found: ${id}`);
    return decrypt(row.encrypted_api_key);
  }

  // --- instance_named_keys ---

  /**
   * Assign a named key to an instance.
   * If isDefault is true the key will be marked as default for that instance;
   * it is the caller's responsibility to clear any previous default first
   * (or use setInstanceDefault for atomic swap).
   */
  assignToInstance(instanceId: number, namedKeyId: number, isDefault: boolean): void {
    this.db
      .prepare(
        `INSERT INTO instance_named_keys (instance_id, named_key_id, is_default)
         VALUES (?, ?, ?)`,
      )
      .run(instanceId, namedKeyId, isDefault ? 1 : 0);
  }

  /**
   * Remove a named key assignment from an instance.
   */
  removeFromInstance(instanceId: number, namedKeyId: number): void {
    this.db
      .prepare("DELETE FROM instance_named_keys WHERE instance_id = ? AND named_key_id = ?")
      .run(instanceId, namedKeyId);
  }

  /**
   * Atomically clear the current default and set a new one for an instance.
   */
  setInstanceDefault(instanceId: number, namedKeyId: number): void {
    const clearDefault = this.db.prepare(
      "UPDATE instance_named_keys SET is_default = 0 WHERE instance_id = ?",
    );
    const setDefault = this.db.prepare(
      "UPDATE instance_named_keys SET is_default = 1 WHERE instance_id = ? AND named_key_id = ?",
    );

    const run = this.db.transaction(() => {
      clearDefault.run(instanceId);
      setDefault.run(instanceId, namedKeyId);
    });
    run();
  }

  /**
   * List all named keys assigned to an instance, with their metadata.
   */
  getInstanceKeys(instanceId: number): InstanceNamedKeyRecord[] {
    const rows = this.db
      .prepare(
        `SELECT ink.named_key_id, nak.name, nak.provider_id, nak.default_model, nak.base_url, ink.is_default
         FROM instance_named_keys ink
         JOIN named_api_keys nak ON nak.id = ink.named_key_id
         WHERE ink.instance_id = ?
         ORDER BY nak.name ASC`,
      )
      .all(instanceId) as RawInstanceNamedKeyRow[];

    return rows.map((row) => ({
      namedKeyId: row.named_key_id,
      name: row.name,
      providerId: row.provider_id,
      defaultModel: row.default_model,
      baseUrl: row.base_url,
      isDefault: row.is_default === 1,
    }));
  }

  /**
   * Get the default named key for an instance, with its decrypted API key.
   * Returns null if no default is set.
   */
  getInstanceDefaultKey(instanceId: number): {
    namedKeyId: number;
    decryptedKey: string;
    providerId: string;
    defaultModel: string;
    baseUrl: string | null;
  } | null {
    const row = this.db
      .prepare(
        `SELECT nak.id, nak.encrypted_api_key, nak.provider_id, nak.default_model, nak.base_url
         FROM instance_named_keys ink
         JOIN named_api_keys nak ON nak.id = ink.named_key_id
         WHERE ink.instance_id = ? AND ink.is_default = 1
         LIMIT 1`,
      )
      .get(instanceId) as
      | {
          id: number;
          encrypted_api_key: string;
          provider_id: string;
          default_model: string;
          base_url: string | null;
        }
      | undefined;

    if (!row) return null;

    return {
      namedKeyId: row.id,
      decryptedKey: decrypt(row.encrypted_api_key),
      providerId: row.provider_id,
      defaultModel: row.default_model,
      baseUrl: row.base_url,
    };
  }

  /**
   * Return the decrypted API key for a named key by its id.
   * Alias for decryptApiKey, for callers that look up by namedKeyId.
   */
  getDecryptedKey(namedKeyId: number): string {
    return this.decryptApiKey(namedKeyId);
  }
}
