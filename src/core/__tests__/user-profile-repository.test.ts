// src/core/__tests__/user-profile-repository.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import { UserProfileRepository } from "../repositories/user-profile-repository.js";
import { hashPassword } from "../auth.js";

let tmpDir: string;
let dbPath: string;
let repo: UserProfileRepository;
let adminUserId: number;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-profile-test-"));
  dbPath = path.join(tmpDir, "test.db");
  const db = initDatabase(dbPath);

  // Create an admin user for tests
  const hash = await hashPassword("test123");
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(
    "admin",
    hash,
  );
  const user = db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: number };
  adminUserId = user.id;

  repo = new UserProfileRepository(db);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Profile CRUD
// ---------------------------------------------------------------------------

describe("UserProfileRepository", () => {
  describe("profile", () => {
    it("getAdminProfile returns profile after upsert", () => {
      // Note: migration v17 backfill runs before the test user is created,
      // so we need to explicitly create a profile
      repo.upsertProfile(adminUserId, { language: "fr" });

      const profile = repo.getAdminProfile();
      expect(profile).toBeDefined();
      expect(profile!.user_id).toBe(adminUserId);
      expect(profile!.language).toBe("fr");
      expect(profile!.communication_style).toBe("concise");
    });

    it("getProfile returns undefined for non-existent user", () => {
      expect(repo.getProfile(99999)).toBeUndefined();
    });

    it("upsertProfile updates existing profile", () => {
      const updated = repo.upsertProfile(adminUserId, {
        display_name: "John",
        language: "en",
        timezone: "Europe/Paris",
        communication_style: "detailed",
        custom_instructions: "Always respond in French",
      });

      expect(updated.display_name).toBe("John");
      expect(updated.language).toBe("en");
      expect(updated.timezone).toBe("Europe/Paris");
      expect(updated.communication_style).toBe("detailed");
      expect(updated.custom_instructions).toBe("Always respond in French");
    });

    it("upsertProfile creates profile for new user", () => {
      // Create another user
      const db = repo["db"];
      db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'viewer')").run(
        "viewer",
        "hash123",
      );
      const viewer = db.prepare("SELECT id FROM users WHERE username = 'viewer'").get() as {
        id: number;
      };

      const profile = repo.upsertProfile(viewer.id, {
        display_name: "Viewer",
        language: "en",
      });

      expect(profile.user_id).toBe(viewer.id);
      expect(profile.display_name).toBe("Viewer");
      expect(profile.language).toBe("en");
    });
  });

  // ---------------------------------------------------------------------------
  // Providers
  // ---------------------------------------------------------------------------

  describe("providers", () => {
    it("getProviders returns empty array for user with no providers", () => {
      expect(repo.getProviders(adminUserId)).toEqual([]);
    });

    it("upsertProvider creates and retrieves a provider", () => {
      repo.upsertProvider(adminUserId, {
        provider_id: "anthropic",
        api_key_env_var: "ANTHROPIC_API_KEY",
        base_url: null,
        priority: 0,
      });

      const providers = repo.getProviders(adminUserId);
      expect(providers).toHaveLength(1);
      expect(providers[0]!.provider_id).toBe("anthropic");
      expect(providers[0]!.api_key_env_var).toBe("ANTHROPIC_API_KEY");
    });

    it("upsertProvider updates existing provider on conflict", () => {
      repo.upsertProvider(adminUserId, {
        provider_id: "anthropic",
        api_key_env_var: "ANTHROPIC_API_KEY",
        priority: 0,
      });

      repo.upsertProvider(adminUserId, {
        provider_id: "anthropic",
        api_key_env_var: "ANTHROPIC_API_KEY_V2",
        priority: 1,
      });

      const providers = repo.getProviders(adminUserId);
      expect(providers).toHaveLength(1);
      expect(providers[0]!.api_key_env_var).toBe("ANTHROPIC_API_KEY_V2");
      expect(providers[0]!.priority).toBe(1);
    });

    it("removeProvider deletes a provider", () => {
      repo.upsertProvider(adminUserId, {
        provider_id: "openai",
        api_key_env_var: "OPENAI_API_KEY",
      });

      repo.removeProvider(adminUserId, "openai");
      expect(repo.getProviders(adminUserId)).toHaveLength(0);
    });

    it("providers are ordered by priority", () => {
      repo.upsertProvider(adminUserId, {
        provider_id: "openai",
        api_key_env_var: "OPENAI_API_KEY",
        priority: 2,
      });
      repo.upsertProvider(adminUserId, {
        provider_id: "anthropic",
        api_key_env_var: "ANTHROPIC_API_KEY",
        priority: 0,
      });

      const providers = repo.getProviders(adminUserId);
      expect(providers[0]!.provider_id).toBe("anthropic");
      expect(providers[1]!.provider_id).toBe("openai");
    });
  });

  // ---------------------------------------------------------------------------
  // Model Aliases
  // ---------------------------------------------------------------------------

  describe("model aliases", () => {
    it("getModelAliases returns empty array initially", () => {
      expect(repo.getModelAliases(adminUserId)).toEqual([]);
    });

    it("setModelAliases replaces all aliases", () => {
      repo.setModelAliases(adminUserId, [
        { alias_id: "fast", provider: "anthropic", model: "claude-haiku-3-5" },
        { alias_id: "smart", provider: "anthropic", model: "claude-sonnet-4-5" },
      ]);

      const aliases = repo.getModelAliases(adminUserId);
      expect(aliases).toHaveLength(2);
      expect(aliases[0]!.alias_id).toBe("fast");
      expect(aliases[1]!.alias_id).toBe("smart");
    });

    it("setModelAliases replaces previous aliases", () => {
      repo.setModelAliases(adminUserId, [
        { alias_id: "fast", provider: "anthropic", model: "claude-haiku-3-5" },
      ]);

      repo.setModelAliases(adminUserId, [
        { alias_id: "local", provider: "ollama", model: "llama3.2" },
      ]);

      const aliases = repo.getModelAliases(adminUserId);
      expect(aliases).toHaveLength(1);
      expect(aliases[0]!.alias_id).toBe("local");
    });

    it("supports context_window override", () => {
      repo.setModelAliases(adminUserId, [
        {
          alias_id: "fast",
          provider: "anthropic",
          model: "claude-haiku-3-5",
          context_window: 128000,
        },
      ]);

      const aliases = repo.getModelAliases(adminUserId);
      expect(aliases[0]!.context_window).toBe(128000);
    });
  });
});
