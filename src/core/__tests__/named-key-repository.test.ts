// src/core/__tests__/named-key-repository.test.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import { NamedKeyRepository } from "../repositories/named-key-repository.js";
import type Database from "better-sqlite3";

let tmpDir: string;
let db: Database.Database;
let repo: NamedKeyRepository;
let instanceId: number;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-named-key-test-"));
  const dbPath = path.join(tmpDir, "test.db");
  process.env.MASTER_ENCRYPTION_KEY = "a".repeat(64);
  db = initDatabase(dbPath);

  // Seed a minimal server + instance for assignment tests
  db.prepare(
    "INSERT INTO servers (id, hostname, openclaw_home) VALUES (1, 'test', '/opt/test')",
  ).run();
  const result = db
    .prepare(
      "INSERT INTO instances (server_id, slug, port, config_path, state_dir, systemd_unit) VALUES (1, 'test-inst', 18789, '/tmp/rt.json', '/tmp/state', 'claw-test.service')",
    )
    .run();
  instanceId = result.lastInsertRowid as number;

  repo = new NamedKeyRepository(db);
});

afterEach(() => {
  delete process.env.MASTER_ENCRYPTION_KEY;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// create / getById / listAll
// ---------------------------------------------------------------------------

describe("NamedKeyRepository", () => {
  describe("create", () => {
    it("creates a key and returns a record with masked key", () => {
      const record = repo.create({
        name: "My Anthropic Key",
        providerId: "anthropic",
        apiKey: "sk-ant-abc12345678901234567890123456789012345678901234",
        defaultModel: "claude-3-5-sonnet-20241022",
      });

      expect(record.id).toBeGreaterThan(0);
      expect(record.name).toBe("My Anthropic Key");
      expect(record.providerId).toBe("anthropic");
      expect(record.defaultModel).toBe("claude-3-5-sonnet-20241022");
      expect(record.baseUrl).toBeNull();
      expect(record.apiKeyMasked).not.toContain("sk-ant-abc123");
      expect(record.apiKeyMasked).toMatch(/^.{4}\*+.{4}$/);
      expect(record.createdAt).toBeDefined();
      expect(record.updatedAt).toBeDefined();
    });

    it("creates a key with optional baseUrl", () => {
      const record = repo.create({
        name: "OpenAI Proxy",
        providerId: "openai",
        apiKey: "sk-proj-abc123456789012345678",
        defaultModel: "gpt-4o",
        baseUrl: "https://proxy.example.com/v1",
      });

      expect(record.baseUrl).toBe("https://proxy.example.com/v1");
    });

    it("rejects duplicate name", () => {
      repo.create({
        name: "Duplicate Key",
        providerId: "anthropic",
        apiKey: "sk-ant-dup1234567890123456789",
        defaultModel: "claude-3-5-haiku-20241022",
      });

      expect(() =>
        repo.create({
          name: "Duplicate Key",
          providerId: "openai",
          apiKey: "sk-openai-dup1234567890123456789",
          defaultModel: "gpt-4o",
        }),
      ).toThrow();
    });
  });

  describe("getById", () => {
    it("returns null for non-existent id", () => {
      expect(repo.getById(99999)).toBeNull();
    });

    it("returns record with masked key", () => {
      const created = repo.create({
        name: "Test Key",
        providerId: "anthropic",
        apiKey: "sk-ant-test1234567890123456789012345",
        defaultModel: "claude-3-5-sonnet-20241022",
      });

      const fetched = repo.getById(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.name).toBe("Test Key");
      expect(fetched!.apiKeyMasked).toBe(created.apiKeyMasked);
    });
  });

  describe("listAll", () => {
    it("returns empty array when no keys", () => {
      expect(repo.listAll()).toEqual([]);
    });

    it("returns all keys with masked keys", () => {
      repo.create({
        name: "Key A",
        providerId: "anthropic",
        apiKey: "sk-ant-aaaaaa1234567890123456789",
        defaultModel: "claude-3-5-sonnet-20241022",
      });
      repo.create({
        name: "Key B",
        providerId: "openai",
        apiKey: "sk-proj-bbbbbbb1234567890123456789",
        defaultModel: "gpt-4o",
      });

      const all = repo.listAll();
      expect(all).toHaveLength(2);
      expect(all.map((k) => k.name)).toContain("Key A");
      expect(all.map((k) => k.name)).toContain("Key B");
      // Verify keys are masked
      for (const key of all) {
        expect(key.apiKeyMasked).toMatch(/\*/);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------

  describe("update", () => {
    it("updates name", () => {
      const created = repo.create({
        name: "Old Name",
        providerId: "anthropic",
        apiKey: "sk-ant-upd123456789012345678901234",
        defaultModel: "claude-3-5-sonnet-20241022",
      });

      const updated = repo.update(created.id, { name: "New Name" });
      expect(updated.name).toBe("New Name");
      expect(updated.defaultModel).toBe("claude-3-5-sonnet-20241022");
    });

    it("updates defaultModel", () => {
      const created = repo.create({
        name: "Model Key",
        providerId: "anthropic",
        apiKey: "sk-ant-mdl1234567890123456789012345",
        defaultModel: "claude-3-5-sonnet-20241022",
      });

      const updated = repo.update(created.id, { defaultModel: "claude-3-5-haiku-20241022" });
      expect(updated.defaultModel).toBe("claude-3-5-haiku-20241022");
    });

    it("rotates apiKey — decrypted value changes", () => {
      const created = repo.create({
        name: "Rotation Key",
        providerId: "anthropic",
        apiKey: "sk-ant-old123456789012345678901234",
        defaultModel: "claude-3-5-sonnet-20241022",
      });

      const oldDecrypted = repo.decryptApiKey(created.id);
      repo.update(created.id, { apiKey: "sk-ant-new123456789012345678901234" });
      const newDecrypted = repo.decryptApiKey(created.id);

      expect(oldDecrypted).toBe("sk-ant-old123456789012345678901234");
      expect(newDecrypted).toBe("sk-ant-new123456789012345678901234");
    });

    it("updates masked key display after rotation", () => {
      const created = repo.create({
        name: "Display Key",
        providerId: "anthropic",
        apiKey: "sk-ant-old-display12345678901234",
        defaultModel: "claude-3-5-sonnet-20241022",
      });

      const updated = repo.update(created.id, { apiKey: "sk-ant-new-display12345678901234" });
      // The masked key should reflect the new key's prefix and suffix
      expect(updated.apiKeyMasked).toMatch(/^sk-a/);
      expect(updated.apiKeyMasked).toMatch(/1234$/);
    });

    it("throws for non-existent id", () => {
      expect(() => repo.update(99999, { name: "Ghost" })).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // decryptApiKey
  // ---------------------------------------------------------------------------

  describe("decryptApiKey", () => {
    it("round-trips the raw API key", () => {
      const rawKey = "sk-ant-roundtrip1234567890123456789";
      const created = repo.create({
        name: "Round Trip",
        providerId: "anthropic",
        apiKey: rawKey,
        defaultModel: "claude-3-5-sonnet-20241022",
      });

      expect(repo.decryptApiKey(created.id)).toBe(rawKey);
    });

    it("throws for non-existent id", () => {
      expect(() => repo.decryptApiKey(99999)).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Instance default key (v25: simple FK on instances)
  // ---------------------------------------------------------------------------

  describe("getDefaultKeyForInstance", () => {
    it("returns null when no default is set", () => {
      expect(repo.getDefaultKeyForInstance(instanceId)).toBeNull();
    });

    it("returns the decrypted default key for an instance", () => {
      const rawKey = "sk-ant-inst-default1234567890123456";
      const created = repo.create({
        name: "Default Decrypt Key",
        providerId: "anthropic",
        apiKey: rawKey,
        defaultModel: "claude-3-5-sonnet-20241022",
      });

      repo.setDefaultKeyForInstance(instanceId, created.id);

      const defaultKey = repo.getDefaultKeyForInstance(instanceId);
      expect(defaultKey).not.toBeNull();
      expect(defaultKey!.id).toBe(created.id);
      expect(defaultKey!.apiKey).toBe(rawKey);
      expect(defaultKey!.providerId).toBe("anthropic");
      expect(defaultKey!.defaultModel).toBe("claude-3-5-sonnet-20241022");
      expect(defaultKey!.baseUrl).toBeNull();
    });

    it("returns key with baseUrl when set", () => {
      const created = repo.create({
        name: "Proxy Key",
        providerId: "openai",
        apiKey: "sk-proxy-123456789012345678901234",
        defaultModel: "gpt-4o",
        baseUrl: "https://proxy.example.com/v1",
      });

      repo.setDefaultKeyForInstance(instanceId, created.id);

      const defaultKey = repo.getDefaultKeyForInstance(instanceId);
      expect(defaultKey!.baseUrl).toBe("https://proxy.example.com/v1");
    });
  });

  describe("setDefaultKeyForInstance", () => {
    it("sets the default key", () => {
      const created = repo.create({
        name: "New Default",
        providerId: "anthropic",
        apiKey: "sk-ant-new-default123456789012345",
        defaultModel: "claude-3-5-sonnet-20241022",
      });

      repo.setDefaultKeyForInstance(instanceId, created.id);

      const row = db
        .prepare("SELECT default_named_key_id FROM instances WHERE id = ?")
        .get(instanceId) as { default_named_key_id: number | null };
      expect(row.default_named_key_id).toBe(created.id);
    });

    it("clears the default key when set to null", () => {
      const created = repo.create({
        name: "Clearable",
        providerId: "anthropic",
        apiKey: "sk-ant-clearable12345678901234567",
        defaultModel: "claude-3-5-sonnet-20241022",
      });

      repo.setDefaultKeyForInstance(instanceId, created.id);
      repo.setDefaultKeyForInstance(instanceId, null);

      const row = db
        .prepare("SELECT default_named_key_id FROM instances WHERE id = ?")
        .get(instanceId) as { default_named_key_id: number | null };
      expect(row.default_named_key_id).toBeNull();
    });

    it("changes the default key when called again", () => {
      const keyA = repo.create({
        name: "Key A",
        providerId: "anthropic",
        apiKey: "sk-ant-key-a1234567890123456789012",
        defaultModel: "claude-3-5-sonnet-20241022",
      });
      const keyB = repo.create({
        name: "Key B",
        providerId: "openai",
        apiKey: "sk-proj-key-b123456789012345678901",
        defaultModel: "gpt-4o",
      });

      repo.setDefaultKeyForInstance(instanceId, keyA.id);
      repo.setDefaultKeyForInstance(instanceId, keyB.id);

      const defaultKey = repo.getDefaultKeyForInstance(instanceId);
      expect(defaultKey!.id).toBe(keyB.id);
    });
  });

  describe("delete", () => {
    it("deletes an unassigned key without error", () => {
      const created = repo.create({
        name: "Delete Me",
        providerId: "anthropic",
        apiKey: "sk-ant-del1234567890123456789012345",
        defaultModel: "claude-3-5-sonnet-20241022",
      });

      repo.delete(created.id);
      expect(repo.getById(created.id)).toBeNull();
    });

    it("can delete a key that was default (ON DELETE SET NULL)", () => {
      const created = repo.create({
        name: "Default Then Delete",
        providerId: "anthropic",
        apiKey: "sk-ant-dtd12345678901234567890123456",
        defaultModel: "claude-3-5-sonnet-20241022",
      });

      repo.setDefaultKeyForInstance(instanceId, created.id);
      repo.delete(created.id);

      expect(repo.getById(created.id)).toBeNull();
      expect(repo.getDefaultKeyForInstance(instanceId)).toBeNull();
    });
  });

  describe("getDecryptedKey", () => {
    it("returns the raw API key by named key id", () => {
      const rawKey = "sk-ant-get-decrypt123456789012345678";
      const created = repo.create({
        name: "Decrypt By ID",
        providerId: "anthropic",
        apiKey: rawKey,
        defaultModel: "claude-3-5-sonnet-20241022",
      });

      expect(repo.getDecryptedKey(created.id)).toBe(rawKey);
    });
  });
});
