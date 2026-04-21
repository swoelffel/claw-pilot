# Plugin Signature

> **Status**: hook H7 shipped in Community. Enterprise ships `CAVerifier` separately.
> **Extension point**: `registerPluginVerifier(v)` / `getPluginVerifier()` in [`src/runtime/plugin/verifier.ts`](../../src/runtime/plugin/verifier.ts).

## Why

`loadPluginFromFile()` dynamically `import()`s arbitrary JavaScript with full Node.js privileges. For a B2B customer auditing every plugin deployed on-prem, this is a supply-chain attack surface. H7 introduces a pluggable `PluginVerifier` invoked **before** the `import()` so unsigned or tampered plugins never execute.

Community ships `NullPluginVerifier` (accepts everything — behaviour unchanged). Enterprise registers a capability-gated `CAVerifier` (or cosign) at bootstrap, which enforces a detached-signature policy against an internal CA.

## Contract

```typescript
export interface PluginManifest {
  path: string;          // canonical absolute path of the plugin file
  bytes: Uint8Array;     // raw bytes (already read from disk)
  hash: string;          // sha256 hex of bytes
}

export type VerificationResult = { ok: true } | { ok: false; reason: string };

export interface PluginVerifier {
  readonly kind: string; // "null" | "ca" | "cosign" | ...
  verify(manifest: PluginManifest): Promise<VerificationResult>;
}

export function registerPluginVerifier(v: PluginVerifier): void;
export function getPluginVerifier(): PluginVerifier;
```

## Timing — verify before `import()`

`loadPluginFromFile()` performs the following, in order:

1. Resolve the file path (supports absolute paths and `file://` URLs).
2. Read bytes + compute `sha256` hex.
3. Call `verifier.verify({ path, bytes, hash })`.
4. If `{ ok: false }` → emit `plugin.rejected` audit event and throw `ClawPilotError("PLUGIN_REJECTED")`. **The module is never passed to `import()`.**
5. If `{ ok: true }` → `await import(pluginUrl)` and register the exported factory.

Verifying after `import()` would be too late: the plugin's top-level code would have already executed.

## Signature convention (detached `.sig`)

Community does not impose a signature format. Enterprise `CAVerifier` uses the simplest possible convention:

- The signature for `/opt/claw-pilot/plugins/foo.js` lives at `/opt/claw-pilot/plugins/foo.js.sig`.
- The `.sig` file contains a base64-encoded detached signature over the plugin's raw bytes.
- Absence of the `.sig` file yields `{ ok: false, reason: "signature file missing" }`.

This convention lets operators script signing/provisioning independently of the plugin source tree. Enterprise variants may choose a richer `<plugin>.manifest.json` format — the `verify(manifest)` contract accepts the canonical `path`, so any sidecar scheme works without touching the core loader.

## Capability gate

`registerPluginVerifier(v)`:

- **Always accepts** `v.kind === "null"` — Community default + test resets never require a capability.
- **Refuses any other `kind`** unless `capabilities.has("plugin-signature") === true`, throwing `PLUGIN_SIGNATURE_CAPABILITY_REQUIRED`.

Bootstrap order (identical at all three entry points — `_context.ts`, `dashboard.ts`, `runtime.ts`):

```typescript
bootstrapServerRegistry(db, conn);
bootstrapSecretProvider();
bootstrapAuditBus(db);
registerPluginVerifier(new NullPluginVerifier());
```

Enterprise swaps the registration in its own `src/index.ts` after enabling `plugin-signature` on the capability registry:

```typescript
setCapabilityRegistry(enterpriseRegistry);
// ...later, after audit + secret providers are up:
registerPluginVerifier(new CAVerifier({ caPath: "/etc/claw-pilot/ca.pem" }));
```

## Failure mode — throw + audit

A rejection is a hard fail:

- `loadPluginFromFile()` throws `ClawPilotError("PLUGIN_REJECTED")` with message `Plugin rejected by verifier "<kind>": <reason>`.
- `emitAudit({ kind: "plugin.rejected", path, verifierKind, reason })` is emitted (see [Audit Event Bus](audit-event-bus.md)) — the dashboard's audit view surfaces the rejection.
- Callers are expected to catch `PLUGIN_REJECTED` and surface it to the operator (dashboard notification, log warning). The session that attempted the load continues; the plugin is simply absent from the hook registry.

Successful loads are intentionally **not** audited — plugin loads are frequent at boot and would drown the audit log. Rejections are rare and signal.

## Enterprise extension example

```typescript
import { subtle } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { PluginVerifier, VerificationResult } from "claw-pilot/runtime/plugin/verifier";

export class CAVerifier implements PluginVerifier {
  readonly kind = "ca";
  constructor(private readonly caPublicKey: CryptoKey) {}

  async verify({ path, bytes }: PluginManifest): Promise<VerificationResult> {
    try {
      const sigB64 = await readFile(`${path}.sig`, "utf-8");
      const signature = Buffer.from(sigB64.trim(), "base64");
      const valid = await subtle.verify(
        { name: "RSA-PSS", saltLength: 32 },
        this.caPublicKey,
        signature,
        bytes,
      );
      return valid ? { ok: true } : { ok: false, reason: "invalid signature" };
    } catch (err) {
      return { ok: false, reason: `signature file missing or unreadable: ${String(err)}` };
    }
  }
}
```

## Discipline

- **R1** — no `if (isEnterprise)`; gating is `capabilities.has("plugin-signature")`.
- **R2** — no new DB tables.
- **R3** — `src/runtime/plugin/plugin.ts` is a frozen path; H7 commits carry the `Extension-Point: plugin-signature` trailer.
- **R4** — Community ships the hook first; Enterprise lands its `CAVerifier` against this public surface without touching core.
- **R5** — unaffected. Secrets used by Enterprise verifiers (e.g. CA private key for signing tooling, not for `verify()`) flow through `SecretProvider`.
