// src/lib/__tests__/key-migration.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import type Database from "better-sqlite3";
import { initDatabase } from "../../db/schema.js";
import { NamedKeyRepository } from "../../core/repositories/named-key-repository.js";

// ---------------------------------------------------------------------------
// Mocks — partial: only override functions with side effects
// ---------------------------------------------------------------------------

vi.mock("../crypto.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../crypto.js")>();
  return { ...real, isCryptoAvailable: vi.fn() };
});

vi.mock("../dotenv.js", () => ({
  readEnvVar: vi.fn(),
  removeEnvVar: vi.fn(),
}));

vi.mock("../platform.js", () => ({
  getDataDir: vi.fn(),
}));

import { isCryptoAvailable } from "../crypto.js";
import { readEnvVar, removeEnvVar } from "../dotenv.js";
import { getDataDir } from "../platform.js";
import {
  migrateUserProvidersToNamedKeys,
  migrateInstanceProvidersToNamedKeys,
} from "../key-migration.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: Database.Database;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-key-migration-test-"));
  process.env.MASTER_ENCRYPTION_KEY = "a".repeat(64);
  db = initDatabase(path.join(tmpDir, "test.db"));

  // Seed server + instance
  db.prepare(
    "INSERT INTO servers (id, hostname, openclaw_home) VALUES (1, 'test', '/opt/test')",
  ).run();
  db.prepare(
    "INSERT INTO instances (server_id, slug, port, config_path, state_dir, systemd_unit) VALUES (1, 'test-inst', 18789, '/tmp/rt.json', '/tmp/state', 'claw-test.service')",
  ).run();

  // Default mock behaviour
  vi.mocked(isCryptoAvailable).mockReturnValue(true);
  vi.mocked(getDataDir).mockReturnValue(tmpDir);
  vi.mocked(readEnvVar).mockReturnValue(null);
  vi.mocked(removeEnvVar).mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.MASTER_ENCRYPTION_KEY;
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** Insert a row into user_providers (requires a user row for FK). */
function seedUserProvider(providerId: string, envVar: string, baseUrl: string | null = null): void {
  // Ensure a user row exists (id = 1)
  const existing = db.prepare("SELECT id FROM users WHERE id = 1").get();
  if (!existing) {
    db.prepare(
      "INSERT INTO users (id, username, password_hash, role) VALUES (1, 'admin', 'hash', 'admin')",
    ).run();
  }
  db.prepare(
    "INSERT INTO user_providers (user_id, provider_id, api_key_env_var, base_url) VALUES (1, ?, ?, ?)",
  ).run(providerId, envVar, baseUrl);
}

// ---------------------------------------------------------------------------
// migrateUserProvidersToNamedKeys
// ---------------------------------------------------------------------------

describe("migrateUserProvidersToNamedKeys", () => {
  it("returns 0 when crypto is not available", async () => {
    vi.mocked(isCryptoAvailable).mockReturnValue(false);
    seedUserProvider("anthropic", "ANTHROPIC_API_KEY");
    vi.mocked(readEnvVar).mockReturnValue("sk-ant-xxx");

    const count = await migrateUserProvidersToNamedKeys(db);
    expect(count).toBe(0);
  });

  it("returns 0 when user_providers is empty", async () => {
    const count = await migrateUserProvidersToNamedKeys(db);
    expect(count).toBe(0);
  });

  it("migrates a single provider key", async () => {
    seedUserProvider("anthropic", "ANTHROPIC_API_KEY");
    vi.mocked(readEnvVar).mockReturnValue("sk-ant-test-key-12345678");

    const count = await migrateUserProvidersToNamedKeys(db);
    expect(count).toBe(1);

    const repo = new NamedKeyRepository(db);
    const keys = repo.listAll();
    expect(keys).toHaveLength(1);
    expect(keys[0]!.name).toBe("Anthropic (migrated)");
    expect(keys[0]!.providerId).toBe("anthropic");
    // Verify the key was stored encrypted and can be decrypted
    const raw = repo.decryptApiKey(keys[0]!.id);
    expect(raw).toBe("sk-ant-test-key-12345678");
  });

  it("skips providers with no key in .env", async () => {
    seedUserProvider("anthropic", "ANTHROPIC_API_KEY");
    // readEnvVar already returns null by default

    const count = await migrateUserProvidersToNamedKeys(db);
    expect(count).toBe(0);

    const repo = new NamedKeyRepository(db);
    expect(repo.listAll()).toHaveLength(0);
  });

  it("is idempotent — does not migrate already-existing named keys", async () => {
    seedUserProvider("anthropic", "ANTHROPIC_API_KEY");
    vi.mocked(readEnvVar).mockReturnValue("sk-ant-test-key-12345678");

    // First migration
    await migrateUserProvidersToNamedKeys(db);

    // Re-seed user_providers (simulate partial state)
    seedUserProvider("openai", "OPENAI_API_KEY");
    // But also re-insert the anthropic row (deleted by first migration, re-add to test idempotency)
    db.prepare(
      "INSERT INTO user_providers (user_id, provider_id, api_key_env_var) VALUES (1, 'anthropic', 'ANTHROPIC_API_KEY')",
    ).run();

    const count = await migrateUserProvidersToNamedKeys(db);
    // anthropic should be skipped (same name exists), openai migrated
    expect(count).toBe(1);

    const repo = new NamedKeyRepository(db);
    const keys = repo.listAll();
    expect(keys).toHaveLength(2);
    const names = keys.map((k) => k.name);
    expect(names).toContain("Anthropic (migrated)");
    expect(names).toContain("OpenAI (migrated)");
  });

  it("removes env var after migration", async () => {
    seedUserProvider("anthropic", "ANTHROPIC_API_KEY");
    vi.mocked(readEnvVar).mockReturnValue("sk-ant-key");

    await migrateUserProvidersToNamedKeys(db);

    const envPath = path.join(tmpDir, ".env");
    expect(removeEnvVar).toHaveBeenCalledWith(envPath, "ANTHROPIC_API_KEY");
  });

  it("deletes user_providers row after migration", async () => {
    seedUserProvider("anthropic", "ANTHROPIC_API_KEY");
    vi.mocked(readEnvVar).mockReturnValue("sk-ant-key");

    await migrateUserProvidersToNamedKeys(db);

    const remaining = db.prepare("SELECT * FROM user_providers").all();
    expect(remaining).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// migrateInstanceProvidersToNamedKeys
// ---------------------------------------------------------------------------

describe("migrateInstanceProvidersToNamedKeys", () => {
  it("returns 0 when crypto is not available", async () => {
    vi.mocked(isCryptoAvailable).mockReturnValue(false);

    const count = await migrateInstanceProvidersToNamedKeys(db);
    expect(count).toBe(0);
  });

  it("returns 0 when no instances exist", async () => {
    // Clear all instances so the query returns an empty list
    db.prepare("DELETE FROM instances").run();

    const count = await migrateInstanceProvidersToNamedKeys(db);
    expect(count).toBe(0);
  });

  it("migrates instance API key from .env", async () => {
    vi.mocked(readEnvVar).mockImplementation((_envPath: string, varName: string) => {
      if (varName === "ANTHROPIC_API_KEY") return "sk-ant-inst-key-1234";
      return null;
    });

    const count = await migrateInstanceProvidersToNamedKeys(db);
    expect(count).toBe(1);

    const repo = new NamedKeyRepository(db);
    const keys = repo.listAll();
    expect(keys).toHaveLength(1);
    expect(keys[0]!.name).toBe("Anthropic");
    expect(keys[0]!.providerId).toBe("anthropic");

    const raw = repo.decryptApiKey(keys[0]!.id);
    expect(raw).toBe("sk-ant-inst-key-1234");
  });

  it("skips instances already with default_named_key_id", async () => {
    // Pre-create a named key and assign it
    const repo = new NamedKeyRepository(db);
    const key = repo.create({
      name: "Pre-existing Key",
      providerId: "anthropic",
      apiKey: "sk-pre-existing",
      defaultModel: "anthropic/claude-haiku-4-5",
    });
    db.prepare("UPDATE instances SET default_named_key_id = ? WHERE slug = 'test-inst'").run(
      key.id,
    );

    vi.mocked(readEnvVar).mockReturnValue("sk-ant-should-not-migrate");

    const count = await migrateInstanceProvidersToNamedKeys(db);
    expect(count).toBe(0);
  });

  it("deduplicates same API key across instances", async () => {
    // Add a second instance
    db.prepare(
      "INSERT INTO instances (server_id, slug, port, config_path, state_dir, systemd_unit) VALUES (1, 'inst-2', 18790, '/tmp/rt2.json', '/tmp/state2', 'claw-2.service')",
    ).run();

    // Both instances have the same anthropic key
    vi.mocked(readEnvVar).mockImplementation((_envPath: string, varName: string) => {
      if (varName === "ANTHROPIC_API_KEY") return "sk-ant-shared-key";
      return null;
    });

    const count = await migrateInstanceProvidersToNamedKeys(db);
    // 2 env vars removed (one per instance), but only 1 named key created
    expect(count).toBe(2);

    const repo = new NamedKeyRepository(db);
    const keys = repo.listAll();
    expect(keys).toHaveLength(1);
    expect(keys[0]!.name).toBe("Anthropic");
  });

  it("handles unique name collision by appending suffix", async () => {
    // Pre-create a named key with the default name "Anthropic"
    const repo = new NamedKeyRepository(db);
    repo.create({
      name: "Anthropic",
      providerId: "anthropic",
      apiKey: "sk-ant-existing-different-key",
      defaultModel: "anthropic/claude-haiku-4-5",
    });

    vi.mocked(readEnvVar).mockImplementation((_envPath: string, varName: string) => {
      if (varName === "ANTHROPIC_API_KEY") return "sk-ant-new-key-9999";
      return null;
    });

    const count = await migrateInstanceProvidersToNamedKeys(db);
    expect(count).toBe(1);

    const keys = repo.listAll();
    expect(keys).toHaveLength(2);
    const names = keys.map((k) => k.name).sort();
    expect(names).toContain("Anthropic");
    expect(names).toContain("Anthropic (2)");
  });

  it("sets default_named_key_id when instance default_model matches provider", async () => {
    // Set instance default_model to an anthropic model
    db.prepare(
      "UPDATE instances SET default_model = 'anthropic/claude-haiku-4-5' WHERE slug = 'test-inst'",
    ).run();

    vi.mocked(readEnvVar).mockImplementation((_envPath: string, varName: string) => {
      if (varName === "ANTHROPIC_API_KEY") return "sk-ant-default-key";
      return null;
    });

    await migrateInstanceProvidersToNamedKeys(db);

    const row = db
      .prepare("SELECT default_named_key_id FROM instances WHERE slug = 'test-inst'")
      .get() as { default_named_key_id: number | null };
    expect(row.default_named_key_id).not.toBeNull();

    // Verify the assigned key is the one we just created
    const repo = new NamedKeyRepository(db);
    const key = repo.getById(row.default_named_key_id!);
    expect(key).not.toBeNull();
    expect(key!.providerId).toBe("anthropic");
  });
});
