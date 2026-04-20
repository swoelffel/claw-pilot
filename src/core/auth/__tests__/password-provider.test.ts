// src/core/auth/__tests__/password-provider.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDatabase } from "../../../db/schema.js";
import { hashPassword, PasswordProvider } from "../index.js";
import type Database from "better-sqlite3";

let db: Database.Database;
let provider: PasswordProvider;

beforeEach(async () => {
  db = initDatabase(":memory:");
  provider = new PasswordProvider(db);
  const hash = await hashPassword("s3cret-password");
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(
    "alice",
    hash,
  );
});

afterEach(() => {
  db.close();
});

describe("PasswordProvider", () => {
  it("kind is 'password'", () => {
    expect(provider.kind).toBe("password");
  });

  it("authenticates a valid user", async () => {
    const res = await provider.authenticate({ username: "alice", password: "s3cret-password" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.user.username).toBe("alice");
      expect(res.user.role).toBe("admin");
      expect(typeof res.user.id).toBe("number");
    }
  });

  it("rejects wrong password with INVALID_CREDENTIALS", async () => {
    const res = await provider.authenticate({ username: "alice", password: "wrong" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("INVALID_CREDENTIALS");
    }
  });

  it("rejects unknown username with INVALID_CREDENTIALS", async () => {
    const res = await provider.authenticate({ username: "bob", password: "anything" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("INVALID_CREDENTIALS");
    }
  });

  it("rejects malformed credentials with INVALID_CREDENTIALS_SHAPE", async () => {
    const res = await provider.authenticate({ foo: "bar" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("INVALID_CREDENTIALS_SHAPE");
    }
  });

  it("rejects null credentials with INVALID_CREDENTIALS_SHAPE", async () => {
    const res = await provider.authenticate(null);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("INVALID_CREDENTIALS_SHAPE");
    }
  });
});
