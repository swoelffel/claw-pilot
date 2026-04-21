// src/core/secrets/index.ts
import { ClawPilotError } from "../../lib/errors.js";
import { capabilities } from "../capabilities.js";

/**
 * Pluggable contract for reading and (optionally) writing infrastructure
 * secrets. Community ships a single implementation — `EnvSecretProvider` —
 * which reads from `process.env` and the state-dir `.env` file. Enterprise
 * swaps in a Vault / AWS Secrets Manager / Azure Key Vault backed provider
 * at bootstrap, gated by the `vault-secrets` capability.
 *
 * Naming convention for secret keys:
 *   - Global secrets: SCREAMING_SNAKE (e.g. `MASTER_ENCRYPTION_KEY`)
 *   - Per-instance: composite `<KIND>_TOKEN:<slug>`
 *     (e.g. `TELEGRAM_BOT_TOKEN:my-instance`)
 */
export interface SecretProvider {
  /** Short identifier of the backing implementation. */
  readonly kind: string;

  /** Returns true iff the secret exists and is non-empty. */
  has(name: string): Promise<boolean>;

  /**
   * Returns the secret value. Throws `SECRET_NOT_FOUND` if the secret is
   * absent — callers must use `has()` first when absence is expected.
   */
  get(name: string): Promise<string>;

  /**
   * Persist a secret. Used for auto-generated secrets (dashboard token,
   * master encryption key on first run). Optional — providers that are
   * read-only (e.g. a future read-only Vault role) may omit it and throw.
   */
  set?(name: string, value: string): Promise<void>;

  /**
   * Rotate a secret in-place. Enterprise-only by design — the Community
   * env provider throws `NOT_SUPPORTED_IN_COMMUNITY`.
   */
  rotate?(name: string): Promise<void>;
}

/** Brand symbol identifying the Community env-backed provider. */
export const ENV_PROVIDER_BRAND: unique symbol = Symbol("env-secret-provider");

function isEnvProvider(p: SecretProvider): boolean {
  return (p as unknown as Record<symbol, unknown>)[ENV_PROVIDER_BRAND] === true;
}

let current: SecretProvider | null = null;
let locked = false;

/**
 * Register the process-wide `SecretProvider`. Must be called exactly once
 * during bootstrap, before any consumer reads a secret.
 *
 * The Community `EnvSecretProvider` (brand `ENV_PROVIDER_BRAND`) is always
 * accepted. Any other implementation requires the `vault-secrets`
 * capability — otherwise the registration is rejected with
 * `VAULT_SECRETS_CAPABILITY_REQUIRED`.
 */
export function registerSecretProvider(provider: SecretProvider): void {
  if (locked) {
    throw new ClawPilotError(
      "SecretProvider already locked — registerSecretProvider() must be called exactly once during bootstrap",
      "SECRET_PROVIDER_LOCKED",
    );
  }
  if (!isEnvProvider(provider) && !capabilities.has("vault-secrets")) {
    throw new ClawPilotError(
      "Registering a non-env SecretProvider requires the 'vault-secrets' capability",
      "VAULT_SECRETS_CAPABILITY_REQUIRED",
    );
  }
  current = provider;
  locked = true;
}

/**
 * Returns true iff a `SecretProvider` has been registered. Consumers that
 * can tolerate bootstrap-before-registration (e.g. tests, early logging)
 * should check this before calling `getSecretProvider()`.
 */
export function isSecretProviderRegistered(): boolean {
  return current !== null;
}

/**
 * Test-only: reset the singleton between tests. Silently no-ops outside
 * NODE_ENV=test.
 */
export function resetSecretProvider(): void {
  if (process.env.NODE_ENV !== "test") return;
  current = null;
  locked = false;
}

/**
 * Returns the registered provider. Throws `SECRET_PROVIDER_NOT_REGISTERED`
 * if no provider was registered during bootstrap.
 */
export function getSecretProvider(): SecretProvider {
  if (current === null) {
    throw new ClawPilotError(
      "SecretProvider not registered — call registerSecretProvider() during bootstrap",
      "SECRET_PROVIDER_NOT_REGISTERED",
    );
  }
  return current;
}

/**
 * Thrown by `SecretProvider.get()` when the requested secret is absent.
 */
export class SecretNotFoundError extends ClawPilotError {
  constructor(name: string) {
    super(`Secret "${name}" not found`, "SECRET_NOT_FOUND");
  }
}

/**
 * Singleton proxy — delegates every call to the registered provider.
 * Consumers can import once and keep a stable reference even though the
 * underlying implementation is set at bootstrap.
 */
export const secretProvider: SecretProvider = {
  get kind() {
    return getSecretProvider().kind;
  },
  has: (name) => getSecretProvider().has(name),
  get: (name) => getSecretProvider().get(name),
  set: (name, value) => {
    const p = getSecretProvider();
    if (!p.set) {
      return Promise.reject(
        new ClawPilotError(
          `SecretProvider "${p.kind}" does not support set()`,
          "SET_NOT_SUPPORTED",
        ),
      );
    }
    return p.set(name, value);
  },
  rotate: (name) => {
    const p = getSecretProvider();
    if (!p.rotate) {
      return Promise.reject(
        new ClawPilotError(
          `SecretProvider "${p.kind}" does not support rotate()`,
          "ROTATE_NOT_SUPPORTED",
        ),
      );
    }
    return p.rotate(name);
  },
};
