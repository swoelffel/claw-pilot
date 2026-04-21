// src/core/secrets/providers/env.ts
import * as path from "node:path";
import { ClawPilotError } from "../../../lib/errors.js";
import { readEnvVar, writeEnvVar } from "../../../lib/dotenv.js";
import type { SecretProvider } from "../index.js";
import { ENV_PROVIDER_BRAND, SecretNotFoundError } from "../index.js";

/**
 * Community default. Reads from `process.env` first, then falls back to the
 * global `<stateDir>/.env` file.
 *
 * Writes via `set()` are persisted to the `<stateDir>/.env` file (mode 0600)
 * and mirrored to `process.env` so downstream synchronous consumers (e.g.
 * `encrypt()`/`decrypt()` in `src/lib/crypto.ts`) observe the new value
 * without a second round-trip.
 *
 * `rotate()` is intentionally not implemented — secret rotation is an
 * Enterprise concern that requires the `vault-secrets` capability.
 */
export class EnvSecretProvider implements SecretProvider {
  readonly kind = "env";
  readonly [ENV_PROVIDER_BRAND] = true;

  private readonly envPath: string;

  constructor(stateDir: string) {
    this.envPath = path.join(stateDir, ".env");
  }

  has(name: string): Promise<boolean> {
    const value = this.lookup(name);
    return Promise.resolve(value !== null && value.length > 0);
  }

  get(name: string): Promise<string> {
    const value = this.lookup(name);
    if (value === null || value.length === 0) {
      return Promise.reject(new SecretNotFoundError(name));
    }
    return Promise.resolve(value);
  }

  async set(name: string, value: string): Promise<void> {
    await writeEnvVar(this.envPath, name, value);
    // Mirror into process.env so downstream sync consumers (e.g. getMasterKey)
    // observe the fresh value within the same process lifetime.
    process.env[name] = value;
  }

  rotate(_name: string): Promise<void> {
    return Promise.reject(
      new ClawPilotError(
        "rotate() is not supported by the Community env provider — requires the 'vault-secrets' capability",
        "NOT_SUPPORTED_IN_COMMUNITY",
      ),
    );
  }

  private lookup(name: string): string | null {
    const fromEnv = process.env[name];
    if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
    return readEnvVar(this.envPath, name);
  }
}
