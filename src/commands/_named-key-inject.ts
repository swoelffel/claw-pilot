// src/commands/_named-key-inject.ts
//
// Helper for the `runtime chat` CLI command: injects a Named API Key into
// process.env so the Vercel AI SDK's provider constructors can pick it up.
// Only injects if the env var is not already set (respects manual overrides).

import { PROVIDER_REGISTRY } from "../runtime/provider/provider.js";

export interface NamedKeyInfo {
  providerId: string;
  apiKey: string;
}

/**
 * If the provider's API key environment variable is not already set,
 * inject the decrypted key from the Named API Key record.
 *
 * This allows `claw-pilot runtime chat <slug>` to work when the instance
 * is configured via the Named Key system (DB-stored encrypted keys) rather
 * than raw environment variables.
 */
export function injectNamedKeyForCli(key: NamedKeyInfo): void {
  const descriptor = PROVIDER_REGISTRY.find((p) => p.id === key.providerId);
  if (!descriptor?.apiKeyEnvVar) return; // provider has no env var (e.g. Ollama)
  if (process.env[descriptor.apiKeyEnvVar]) return; // already set — don't overwrite
  process.env[descriptor.apiKeyEnvVar] = key.apiKey;
}
