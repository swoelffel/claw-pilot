// src/runtime/profile/__tests__/community-resolver.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../../db/schema.js";
import { UserProfileRepository } from "../../../core/repositories/user-profile-repository.js";
import { CommunityProfileResolver } from "../community-resolver.js";
import { hashPassword } from "../../../core/auth.js";
import type Database from "better-sqlite3";

let tmpDir: string;
let db: Database.Database;
let resolver: CommunityProfileResolver;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-resolver-test-"));
  const dbPath = path.join(tmpDir, "test.db");
  db = initDatabase(dbPath);

  const hash = await hashPassword("test123");
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(
    "admin",
    hash,
  );

  const repo = new UserProfileRepository(db);

  // Create a profile for the admin user (migration backfill ran before user existed)
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin'").get() as { id: number };
  repo.upsertProfile(admin.id, { language: "fr" });

  resolver = new CommunityProfileResolver(repo);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("CommunityProfileResolver", () => {
  it("getActiveProfile returns admin profile without userId", () => {
    const profile = resolver.getActiveProfile();
    expect(profile).toBeDefined();
    expect(profile!.language).toBe("fr");
    expect(profile!.communicationStyle).toBe("concise");
  });

  it("updateProfile updates and returns full profile", () => {
    const updated = resolver.updateProfile({
      displayName: "Test User",
      language: "en",
      timezone: "Europe/Paris",
      customInstructions: "Be concise",
    });

    expect(updated.displayName).toBe("Test User");
    expect(updated.language).toBe("en");
    expect(updated.timezone).toBe("Europe/Paris");
    expect(updated.customInstructions).toBe("Be concise");
  });

  it("upsertProvider and getProviders work correctly", () => {
    resolver.upsertProvider({
      providerId: "anthropic",
      apiKeyEnvVar: "ANTHROPIC_API_KEY",
      baseUrl: null,
      priority: 0,
      headers: null,
    });

    const providers = resolver.getProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0]!.providerId).toBe("anthropic");
  });

  it("removeProvider removes provider", () => {
    resolver.upsertProvider({
      providerId: "openai",
      apiKeyEnvVar: "OPENAI_API_KEY",
      baseUrl: null,
      priority: 0,
      headers: null,
    });

    resolver.removeProvider("openai");
    expect(resolver.getProviders()).toHaveLength(0);
  });

  it("setModelAliases and getModelAliases work correctly", () => {
    resolver.setModelAliases([
      { aliasId: "fast", provider: "anthropic", model: "claude-haiku-3-5", contextWindow: null },
    ]);

    const aliases = resolver.getModelAliases();
    expect(aliases).toHaveLength(1);
    expect(aliases[0]!.aliasId).toBe("fast");
    expect(aliases[0]!.provider).toBe("anthropic");
  });

  it("handles JSON uiPreferences roundtrip", () => {
    const prefs = { theme: "dark", fontSize: 14 };
    resolver.updateProfile({ uiPreferences: prefs });

    const profile = resolver.getActiveProfile();
    expect(profile!.uiPreferences).toEqual(prefs);
  });

  it("handles JSON headers roundtrip on providers", () => {
    const headers = { "X-Custom": "value" };
    resolver.upsertProvider({
      providerId: "custom",
      apiKeyEnvVar: "CUSTOM_KEY",
      baseUrl: null,
      priority: 0,
      headers,
    });

    const providers = resolver.getProviders();
    expect(providers[0]!.headers).toEqual(headers);
  });

  it("returns undefined for empty DB (no users)", () => {
    // Create a fresh DB with no users
    const freshPath = path.join(tmpDir, "fresh.db");
    const freshDb = initDatabase(freshPath);
    const freshRepo = new UserProfileRepository(freshDb);
    const freshResolver = new CommunityProfileResolver(freshRepo);

    expect(freshResolver.getActiveProfile()).toBeUndefined();
    expect(freshResolver.getProviders()).toEqual([]);
    expect(freshResolver.getModelAliases()).toEqual([]);

    freshDb.close();
  });
});
