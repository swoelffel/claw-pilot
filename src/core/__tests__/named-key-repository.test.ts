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
  // delete
  // ---------------------------------------------------------------------------

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

    it("throws when deleting a key still assigned to an instance (FK RESTRICT)", () => {
      const created = repo.create({
        name: "Assigned Key",
        providerId: "anthropic",
        apiKey: "sk-ant-assign12345678901234567890123",
        defaultModel: "claude-3-5-sonnet-20241022",
      });

      repo.assignToInstance(instanceId, created.id, false);

      expect(() => repo.delete(created.id)).toThrow();
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
  // Instance assignment
  // ---------------------------------------------------------------------------

  describe("instance assignment", () => {
    it("assigns a key to an instance", () => {
      const created = repo.create({
        name: "Instance Key",
        providerId: "anthropic",
        apiKey: "sk-ant-inst1234567890123456789012345",
        defaultModel: "claude-3-5-sonnet-20241022",
      });

      repo.assignToInstance(instanceId, created.id, false);

      const keys = repo.getInstanceKeys(instanceId);
      expect(keys).toHaveLength(1);
      expect(keys[0]!.namedKeyId).toBe(created.id);
      expect(keys[0]!.name).toBe("Instance Key");
      expect(keys[0]!.isDefault).toBe(false);
    });

    it("assigns a key as default", () => {
      const created = repo.create({
        name: "Default Key",
        providerId: "anthropic",
        apiKey: "sk-ant-default1234567890123456789012",
        defaultModel: "claude-3-5-sonnet-20241022",
      });

      repo.assignToInstance(instanceId, created.id, true);

      const keys = repo.getInstanceKeys(instanceId);
      expect(keys[0]!.isDefault).toBe(true);
    });

    it("lists multiple keys for an instance", () => {
      const keyA = repo.create({
        name: "Key List A",
        providerId: "anthropic",
        apiKey: "sk-ant-lista1234567890123456789012345",
        defaultModel: "claude-3-5-sonnet-20241022",
      });
      const keyB = repo.create({
        name: "Key List B",
        providerId: "openai",
        apiKey: "sk-proj-list-b1234567890123456789012",
        defaultModel: "gpt-4o",
      });

      repo.assignToInstance(instanceId, keyA.id, true);
      repo.assignToInstance(instanceId, keyB.id, false);

      const keys = repo.getInstanceKeys(instanceId);
      expect(keys).toHaveLength(2);
    });

    it("setInstanceDefault clears old default and sets new one", () => {
      const keyA = repo.create({
        name: "Default A",
        providerId: "anthropic",
        apiKey: "sk-ant-dfa12345678901234567890123456",
        defaultModel: "claude-3-5-sonnet-20241022",
      });
      const keyB = repo.create({
        name: "Default B",
        providerId: "anthropic",
        apiKey: "sk-ant-dfb12345678901234567890123456",
        defaultModel: "claude-3-5-haiku-20241022",
      });

      repo.assignToInstance(instanceId, keyA.id, true);
      repo.assignToInstance(instanceId, keyB.id, false);

      repo.setInstanceDefault(instanceId, keyB.id);

      const keys = repo.getInstanceKeys(instanceId);
      const a = keys.find((k) => k.namedKeyId === keyA.id)!;
      const b = keys.find((k) => k.namedKeyId === keyB.id)!;
      expect(a.isDefault).toBe(false);
      expect(b.isDefault).toBe(true);
    });

    it("removeFromInstance removes assignment", () => {
      const created = repo.create({
        name: "Remove Key",
        providerId: "anthropic",
        apiKey: "sk-ant-rmv12345678901234567890123456",
        defaultModel: "claude-3-5-sonnet-20241022",
      });

      repo.assignToInstance(instanceId, created.id, false);
      repo.removeFromInstance(instanceId, created.id);

      expect(repo.getInstanceKeys(instanceId)).toHaveLength(0);
    });

    it("getInstanceDefaultKey returns decrypted key for default", () => {
      const rawKey = "sk-ant-inst-default1234567890123456";
      const created = repo.create({
        name: "Default Decrypt Key",
        providerId: "anthropic",
        apiKey: rawKey,
        defaultModel: "claude-3-5-sonnet-20241022",
      });

      repo.assignToInstance(instanceId, created.id, true);

      const defaultKey = repo.getInstanceDefaultKey(instanceId);
      expect(defaultKey).not.toBeNull();
      expect(defaultKey!.decryptedKey).toBe(rawKey);
    });

    it("getInstanceDefaultKey returns null when no default assigned", () => {
      expect(repo.getInstanceDefaultKey(instanceId)).toBeNull();
    });

    it("prevents deleting a key assigned to an instance", () => {
      const created = repo.create({
        name: "Protected Key",
        providerId: "anthropic",
        apiKey: "sk-ant-protect12345678901234567890123",
        defaultModel: "claude-3-5-sonnet-20241022",
      });

      repo.assignToInstance(instanceId, created.id, false);
      expect(() => repo.delete(created.id)).toThrow();

      // After removal, delete should succeed
      repo.removeFromInstance(instanceId, created.id);
      expect(() => repo.delete(created.id)).not.toThrow();
    });

    it("getDecryptedKey returns the raw API key by named key id", () => {
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
