// src/core/secrets/__tests__/env-provider.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EnvSecretProvider } from "../providers/env.js";
import { SecretNotFoundError } from "../index.js";

const TEST_KEY = "CLAW_TEST_SECRET_PROVIDER_KEY";

let stateDir: string;
let provider: EnvSecretProvider;

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-env-provider-"));
  provider = new EnvSecretProvider(stateDir);
  delete process.env[TEST_KEY];
});

afterEach(() => {
  delete process.env[TEST_KEY];
  fs.rmSync(stateDir, { recursive: true, force: true });
});

describe("EnvSecretProvider", () => {
  it("kind is 'env'", () => {
    expect(provider.kind).toBe("env");
  });

  it("has() returns false when the secret is absent", async () => {
    await expect(provider.has(TEST_KEY)).resolves.toBe(false);
  });

  it("has() + get() resolve values from process.env", async () => {
    process.env[TEST_KEY] = "from-env";
    await expect(provider.has(TEST_KEY)).resolves.toBe(true);
    await expect(provider.get(TEST_KEY)).resolves.toBe("from-env");
  });

  it("falls back to <stateDir>/.env when process.env is unset", async () => {
    fs.writeFileSync(path.join(stateDir, ".env"), `${TEST_KEY}=from-file\n`);
    await expect(provider.has(TEST_KEY)).resolves.toBe(true);
    await expect(provider.get(TEST_KEY)).resolves.toBe("from-file");
  });

  it("prefers process.env over the .env file", async () => {
    fs.writeFileSync(path.join(stateDir, ".env"), `${TEST_KEY}=from-file\n`);
    process.env[TEST_KEY] = "from-env";
    await expect(provider.get(TEST_KEY)).resolves.toBe("from-env");
  });

  it("get() rejects with SecretNotFoundError when absent", async () => {
    await expect(provider.get(TEST_KEY)).rejects.toBeInstanceOf(SecretNotFoundError);
  });

  it("set() persists to the .env file with mode 0o600 and mirrors into process.env", async () => {
    await provider.set(TEST_KEY, "persisted");
    expect(process.env[TEST_KEY]).toBe("persisted");

    const envPath = path.join(stateDir, ".env");
    const contents = fs.readFileSync(envPath, "utf-8");
    expect(contents).toContain(`${TEST_KEY}=persisted`);

    if (process.platform !== "win32") {
      const stat = fs.statSync(envPath);
      // Only check the low 9 permission bits (mask out file-type bits)
      expect(stat.mode & 0o777).toBe(0o600);
    }
  });

  it("rotate() throws NOT_SUPPORTED_IN_COMMUNITY", async () => {
    await expect(provider.rotate(TEST_KEY)).rejects.toThrow(/vault-secrets/);
  });
});
