// src/core/secrets/bootstrap.ts
import { getDataDir } from "../../lib/platform.js";
import { isSecretProviderRegistered, registerSecretProvider } from "./index.js";
import { EnvSecretProvider } from "./providers/env.js";

/**
 * Idempotent bootstrap used by every process entry point (`withContext`,
 * dashboard command, runtime command). No-ops if a `SecretProvider` is
 * already registered — matches the pattern of `bootstrapServerRegistry`.
 *
 * Extension point: Enterprise registers a `VaultProvider` /
 * `AwsSecretsProvider` before this function runs; the second call is a
 * no-op so every existing call site continues to work unchanged.
 */
export function bootstrapSecretProvider(stateDir: string = getDataDir()): void {
  if (isSecretProviderRegistered()) return;
  registerSecretProvider(new EnvSecretProvider(stateDir));
}
