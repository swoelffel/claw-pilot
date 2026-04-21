// src/core/secrets/__tests__/snapshot.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EnvSecretProvider } from "../providers/env.js";
import { buildSnapshot } from "../snapshot.js";

let stateDir: string;
const KEY = "MASTER_ENCRYPTION_KEY";

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-snapshot-"));
  delete process.env[KEY];
});

afterEach(() => {
  delete process.env[KEY];
  fs.rmSync(stateDir, { recursive: true, force: true });
});

describe("buildSnapshot", () => {
  it("returns the existing master key when one is already set", async () => {
    const existing = "a".repeat(64);
    process.env[KEY] = existing;
    const snapshot = await buildSnapshot(new EnvSecretProvider(stateDir));
    expect(snapshot.masterEncryptionKey).toBe(existing);
  });

  it("generates and persists a new 64-char hex key on first run", async () => {
    const provider = new EnvSecretProvider(stateDir);
    const snapshot = await buildSnapshot(provider);
    expect(snapshot.masterEncryptionKey).toMatch(/^[0-9a-f]{64}$/);

    const envFile = fs.readFileSync(path.join(stateDir, ".env"), "utf-8");
    expect(envFile).toContain(`${KEY}=${snapshot.masterEncryptionKey}`);
    expect(process.env[KEY]).toBe(snapshot.masterEncryptionKey);
  });

  it("refresh() re-reads the value from the provider", async () => {
    const provider = new EnvSecretProvider(stateDir);
    const snapshot = await buildSnapshot(provider);
    const first = snapshot.masterEncryptionKey;

    // Rotate via provider.set — emulates what an Enterprise rotation would do.
    const rotated = "b".repeat(64);
    await provider.set(KEY, rotated);
    await snapshot.refresh();
    expect(snapshot.masterEncryptionKey).toBe(rotated);
    expect(snapshot.masterEncryptionKey).not.toBe(first);
  });
});
