// src/core/secrets/__tests__/index.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  registerSecretProvider,
  getSecretProvider,
  resetSecretProvider,
  isSecretProviderRegistered,
  secretProvider,
  SecretNotFoundError,
} from "../index.js";
import { EnvSecretProvider } from "../providers/env.js";
import type { SecretProvider } from "../index.js";
import { ClawPilotError } from "../../../lib/errors.js";
import { capabilities } from "../../capabilities.js";

// A fake non-env provider used to exercise the capability gate.
class FakeVaultProvider implements SecretProvider {
  readonly kind = "vault";
  private readonly store = new Map<string, string>();
  has(name: string): Promise<boolean> {
    return Promise.resolve(this.store.has(name));
  }
  get(name: string): Promise<string> {
    const v = this.store.get(name);
    return v === undefined ? Promise.reject(new SecretNotFoundError(name)) : Promise.resolve(v);
  }
}

describe("SecretProvider singleton", () => {
  beforeEach(() => {
    resetSecretProvider();
  });

  it("throws SECRET_PROVIDER_NOT_REGISTERED before registration", () => {
    expect(isSecretProviderRegistered()).toBe(false);
    expect(() => getSecretProvider()).toThrowError(/SecretProvider not registered/);
  });

  it("accepts an EnvSecretProvider without the vault-secrets capability", () => {
    const p = new EnvSecretProvider("/tmp/irrelevant");
    expect(() => registerSecretProvider(p)).not.toThrow();
    expect(isSecretProviderRegistered()).toBe(true);
    expect(getSecretProvider()).toBe(p);
  });

  it("rejects a non-env provider when vault-secrets capability is missing", () => {
    // Community default: capabilities.has('vault-secrets') === false
    expect(capabilities.has("vault-secrets")).toBe(false);
    expect(() => registerSecretProvider(new FakeVaultProvider())).toThrow(/vault-secrets/);
  });

  it("refuses a second registration with SECRET_PROVIDER_LOCKED", () => {
    registerSecretProvider(new EnvSecretProvider("/tmp/a"));
    expect(() => registerSecretProvider(new EnvSecretProvider("/tmp/b"))).toThrow(/already locked/);
  });

  it("secretProvider proxy delegates to the registered implementation", async () => {
    const p = new EnvSecretProvider("/tmp/never-read");
    registerSecretProvider(p);
    expect(secretProvider.kind).toBe("env");

    process.env["TEST_PROXY_SECRET"] = "proxied-value";
    try {
      await expect(secretProvider.has("TEST_PROXY_SECRET")).resolves.toBe(true);
      await expect(secretProvider.get("TEST_PROXY_SECRET")).resolves.toBe("proxied-value");
    } finally {
      delete process.env["TEST_PROXY_SECRET"];
    }
  });

  it("SecretNotFoundError has stable code and message", () => {
    const err = new SecretNotFoundError("FOO");
    expect(err).toBeInstanceOf(ClawPilotError);
    expect(err.code).toBe("SECRET_NOT_FOUND");
    expect(err.message).toContain("FOO");
  });
});
