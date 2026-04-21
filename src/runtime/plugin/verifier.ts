// src/runtime/plugin/verifier.ts
//
// Plugin signature verifier (H7). Community ships `NullPluginVerifier` which
// accepts every plugin. Enterprise registers a capability-gated verifier
// (e.g. detached-signature CA or cosign) before any plugin is loaded.
//
// Extension point: Enterprise calls `registerPluginVerifier(new CAVerifier(...))`
// after enabling `plugin-signature` on the CapabilityRegistry. No modification
// of `loadPluginFromFile()` required.

import { ClawPilotError } from "../../lib/errors.js";
import { capabilities } from "../../core/capabilities.js";

/** Input to `PluginVerifier.verify()` — pre-computed once per load. */
export interface PluginManifest {
  /** Canonical absolute path of the plugin file being loaded. */
  path: string;
  /** Raw bytes of the plugin file. */
  bytes: Uint8Array;
  /** Hex-encoded SHA-256 of `bytes`. */
  hash: string;
}

/** Outcome of a verification attempt. */
export type VerificationResult = { ok: true } | { ok: false; reason: string };

/**
 * Pluggable verifier invoked by `loadPluginFromFile()` **before** the
 * dynamic `import()`. A failing result aborts the load — the plugin module
 * is never evaluated.
 */
export interface PluginVerifier {
  /** Short identifier, e.g. `"null"`, `"ca"`, `"cosign"`. */
  readonly kind: string;
  verify(manifest: PluginManifest): Promise<VerificationResult>;
}

/**
 * Community default — accepts every plugin unconditionally. Kept minimal so
 * Enterprise can swap the whole object at bootstrap without inheritance.
 */
export class NullPluginVerifier implements PluginVerifier {
  readonly kind = "null";
  verify(): Promise<VerificationResult> {
    return Promise.resolve({ ok: true });
  }
}

let current: PluginVerifier | null = null;

/**
 * Register the process-wide `PluginVerifier`. Called exactly once during
 * bootstrap with the Community `NullPluginVerifier`; Enterprise overrides
 * the registration later with a capability-gated verifier.
 *
 * Gating rules:
 *   - `kind === "null"` is always accepted (Community default + test resets)
 *   - any other kind requires `capabilities.has("plugin-signature") === true`,
 *     otherwise throws `PLUGIN_SIGNATURE_CAPABILITY_REQUIRED`.
 *
 * Re-registration with the same `kind` is allowed (idempotent bootstrap).
 */
export function registerPluginVerifier(verifier: PluginVerifier): void {
  if (verifier.kind !== "null" && !capabilities.has("plugin-signature")) {
    throw new ClawPilotError(
      `Registering PluginVerifier "${verifier.kind}" requires the 'plugin-signature' capability`,
      "PLUGIN_SIGNATURE_CAPABILITY_REQUIRED",
    );
  }
  current = verifier;
}

/**
 * Returns the registered verifier. Falls back to a lazily-constructed
 * `NullPluginVerifier` if no registration occurred yet — this keeps
 * `loadPluginFromFile()` usable in unit tests that bypass the bootstrap
 * path, while still letting the singleton be overridden in production.
 */
export function getPluginVerifier(): PluginVerifier {
  if (current === null) {
    current = new NullPluginVerifier();
  }
  return current;
}

/** Test helper — clear the singleton between tests. No-op outside NODE_ENV=test. */
export function resetPluginVerifier(): void {
  if (process.env.NODE_ENV !== "test") return;
  current = null;
}
