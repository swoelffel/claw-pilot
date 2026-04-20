# Capability Registry

> Part of [claw-pilot Functional Architecture](README.md)

---

## Purpose

The `CapabilityRegistry` is the **single differentiation point** between the
Community edition (this repository, MIT) and the Enterprise edition (private
fork). Every feature that must behave differently between editions — SSO,
fine-grained RBAC, multi-server, audit SIEM export, plugin signature
verification, and so on — calls `capabilities.has(...)` or
`capabilities.require(...)` instead of branching on an edition flag.

This mechanism replaces every `if (isEnterprise)`, `if (process.env.ENTERPRISE)`,
or `license.tier === …` pattern. The discipline rule R1 (`no-enterprise-flag`,
documented in the root `CLAUDE.md`) forbids those patterns everywhere in the
codebase; `capabilities.has(...)` is the only supported alternative.

## Module

`src/core/capabilities.ts` — single file, no subfolder.

## API reference

### Types

```typescript
export type EnterpriseCapability =
  | "sso-oidc" | "sso-saml" | "sso-azuread"
  | "rbac-fine" | "abac"
  | "audit-siem" | "audit-immutable"
  | "multi-server" | "multi-tenant"
  | "plugin-signature" | "vault-secrets";

export type Capability = EnterpriseCapability;

export interface CapabilityRegistry {
  has(cap: Capability): boolean;
  require(cap: Capability): void;  // throws CapabilityNotAvailableError
  list(): readonly Capability[];
}
```

### Errors

- `CapabilityNotAvailableError` — subclass of `ClawPilotError`, `code === "CAPABILITY_NOT_AVAILABLE"`. Thrown by `require()` when the capability is disabled.
- `ClawPilotError` with `code === "CAPABILITY_REGISTRY_LOCKED"` — thrown by `setCapabilityRegistry` when invoked a second time.

### Exports

- `capabilities: CapabilityRegistry` — the proxy singleton. Import this in consumer code.
- `setCapabilityRegistry(impl: CapabilityRegistry): void` — bootstrap-time setter. **Never called from Community code.**

## Usage pattern

### Reading a capability

Import the singleton once at the top of the module:

```typescript
import { capabilities } from "../core/capabilities.js";
```

Branch on availability:

```typescript
if (capabilities.has("sso-oidc")) {
  // enterprise-only branch
}
```

Or fail fast at the top of a code path that cannot run without the capability:

```typescript
capabilities.require("audit-siem");
// proceed, knowing the capability is enabled
```

### Do not

- `CommunityCapabilityRegistry` is intentionally not exported — the default implementation is not part of the public surface.
- Do **not** call `setCapabilityRegistry` from Community code. It is the Enterprise override hook.
- Do **not** cache the result of `capabilities.has()` across process lifetimes — Enterprise may call `setCapabilityRegistry` across process restarts, but never within a running process.

### Destructuring is safe

Writing `const { has } = capabilities` is safe — the proxy's methods are
arrow functions that close over the live `current` reference. After an
Enterprise `setCapabilityRegistry` call, the extracted `has` still routes
to the newly-registered implementation.

## Adding a new capability

1. Add the new string literal to the `EnterpriseCapability` union in `src/core/capabilities.ts`.
2. Update the "API reference → Types" section above with the new member.
3. That is all — no DB migration, no config entry, no wiring.

## Enterprise override mechanism

Enterprise ships its own bootstrap file (`src/index.ts` in the private repo)
that calls `setCapabilityRegistry` once, **before any other core module is
imported transitively**. The recommended pattern:

```typescript
// Enterprise repo — src/index.ts
import { setCapabilityRegistry, type Capability, type CapabilityRegistry, CapabilityNotAvailableError } from "./core/capabilities.js";
import { parseLicence } from "./licence.js";

// TODO(H4): once SecretProvider ships, replace with `await secretProvider.get("CP_LICENCE_JWT")`.
const enabled: Set<Capability> = parseLicence(process.env.CP_LICENCE_JWT);

const enterpriseRegistry: CapabilityRegistry = {
  has: (cap) => enabled.has(cap),
  require: (cap) => {
    if (!enabled.has(cap)) throw new CapabilityNotAvailableError(cap);
  },
  list: () => Array.from(enabled),
};

setCapabilityRegistry(enterpriseRegistry);
// … rest of bootstrap
```

The `capabilities` proxy singleton transparently routes all subsequent
`has`/`require`/`list` calls to the newly registered implementation, even
for modules that imported `capabilities` before the `setCapabilityRegistry`
call. This is achieved by closing over a module-level `current` reference
rather than exporting the registry object directly.

### Lock semantics

The first successful call to `setCapabilityRegistry` flips a module-scoped
`locked` boolean. Any later call throws `ClawPilotError(code: "CAPABILITY_REGISTRY_LOCKED")`.
This guarantees that the registry is stable for the lifetime of the
process and that no test, plugin, or runtime hook can replace it mid-run.

### Timing

Enterprise must call `setCapabilityRegistry` **before**:
- Any route handler runs.
- Any CLI command dispatches to `src/commands/`.
- Any long-lived subsystem (dashboard HTTP server, daemon, scheduler) starts
  importing modules that read `capabilities`.

In practice this means calling it at the top of `src/index.ts` of the
Enterprise distribution, above all other imports that transitively touch
`src/core/`.

## Testing guidance

Consumer tests that depend on a specific capability being enabled should
use `vi.resetModules()` followed by a dynamic re-import of
`../core/capabilities.js`, register a fake registry with the required `has`
behavior, and only then import the module under test. See
`src/core/__tests__/capabilities.test.ts` for the pattern — note that
`errors.ts` must also be dynamically imported inside the same loader so
that cross-module `instanceof ClawPilotError` assertions work under
Vitest 4.x.

## Relationship to other hooks

| Hook | Consumes `capabilities.has(...)` for … |
|---|---|
| H1 — permission middleware | `rbac-fine`, `abac` |
| H2 — `AuthProvider` | `sso-oidc`, `sso-saml`, `sso-azuread` |
| H3 — `ServerRegistry` | `multi-server`, `multi-tenant` |
| H4 — `SecretProvider` | `vault-secrets` |
| H6 — audit event bus | `audit-siem`, `audit-immutable` |
| H7 — plugin signature hook | `plugin-signature` |

Each of those hooks ships in its own PR after H5 is merged.