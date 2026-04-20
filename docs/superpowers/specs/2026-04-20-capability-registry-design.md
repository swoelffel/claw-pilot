# CapabilityRegistry (H5) — Design

**Date:** 2026-04-20
**Branch:** `feature/capability-registry`
**Status:** Spec approved, pending implementation plan
**Roadmap:** Hook H5 of 9 in the Enterprise-Edition preparation phase
**References:** `ai-docs/plan-enterprise-edition.md` §H5, root `CLAUDE.md` "Discipline Community ↔ Enterprise"

## 1. Problem

The ClawPilot Enterprise Edition will be built as a disciplined private fork of the Community repository. To keep the `upstream/develop` merge trivial forever, the Community codebase must contain zero `if (process.env.ENTERPRISE)`, `if (isEnterprise)`, or `license.tier === …` branches (discipline rule R1). Every future differentiation between Community and Enterprise behavior must flow through a single, well-defined contract.

H5 delivers that contract: a `CapabilityRegistry` that Community ships with a trivial "no enterprise capability enabled" implementation, and that Enterprise replaces at bootstrap with its own implementation (parsing a licence JWT).

No current code branches on "edition". H5 therefore introduces the mechanism only; consumers will appear progressively with H1–H4, H6, H7 and the subsequent Enterprise phases.

## 2. Goal

Ship a single module `src/core/capabilities.ts` that exposes:

- A strongly-typed `Capability` union listing every known enterprise capability.
- A `CapabilityRegistry` interface with three synchronous methods: `has`, `require`, `list`.
- A default Community implementation that reports zero enterprise capabilities enabled.
- A `setCapabilityRegistry(impl)` bootstrap hook that Enterprise calls exactly once to inject its own implementation.
- A singleton `capabilities` export that consumers import once and that transparently reflects whichever implementation is currently registered.

## 3. Non-goals

- No ESLint rule — rule R1 (`no-enterprise-flag`) is delivered by H9.
- No JWT parsing, no licence validation — that lives in the Enterprise repo.
- No "core" capabilities (e.g. `agents`, `workspaces`). They will be added one by one when a concrete gating need appears.
- No DB migration, no persistence — the registry is pure in-memory state.
- No runtime hot-swap: a single bootstrap-time replacement is supported; any attempt to re-register throws.
- No observability (logging, metrics) on `has()` / `require()` — can be added later if a need appears.
- No async API — Enterprise must preload its state synchronously during bootstrap.

## 4. Discipline alignment

| Rule | Status |
|---|---|
| R1 (no enterprise flag) | N/A — H5 provides the mechanism; enforcement ships in H9 |
| R2 (`org_id` slot on new resource tables) | N/A — no new table |
| R3 (frozen paths byte-identical) | `src/core/` is frozen → commit that adds `capabilities.ts` MUST carry the trailer `Extension-Point: CapabilityRegistry` |
| R4 (Enterprise consumes only existing Community hooks) | Satisfied by construction — `setCapabilityRegistry` is the hook |
| R5 (secrets via `SecretProvider`) | N/A — no secret access |

## 5. Architecture

### 5.1 Module layout

Single file, no subfolder:

```
src/core/capabilities.ts
src/core/__tests__/capabilities.test.ts
```

### 5.2 Public API

```typescript
// src/core/capabilities.ts

import { ClawPilotError } from "@/lib/errors";

/** Enterprise-only capabilities. Always false in the Community edition. */
export type EnterpriseCapability =
  | "sso-oidc"
  | "sso-saml"
  | "sso-azuread"
  | "rbac-fine"
  | "abac"
  | "audit-siem"
  | "audit-immutable"
  | "multi-server"
  | "multi-tenant"
  | "plugin-signature"
  | "vault-secrets";

/**
 * Every known capability.
 * Core capabilities (always-true in both editions) may be folded into this
 * union later, on demand, when a concrete gating need emerges.
 */
export type Capability = EnterpriseCapability;

export interface CapabilityRegistry {
  has(cap: Capability): boolean;
  /** Throws CapabilityNotAvailableError if the capability is disabled. */
  require(cap: Capability): void;
  list(): readonly Capability[];
}

export class CapabilityNotAvailableError extends ClawPilotError {
  constructor(cap: Capability) {
    super(
      `Capability "${cap}" is not available in this edition`,
      "CAPABILITY_NOT_AVAILABLE",
    );
    this.name = "CapabilityNotAvailableError";
  }
}

/** Default Community implementation: no enterprise capability enabled. */
class CommunityCapabilityRegistry implements CapabilityRegistry {
  has(_cap: Capability): boolean {
    return false;
  }
  require(cap: Capability): void {
    throw new CapabilityNotAvailableError(cap);
  }
  list(): readonly Capability[] {
    return [];
  }
}

let current: CapabilityRegistry = new CommunityCapabilityRegistry();
let locked = false;

/**
 * Replace the default registry. Must be called exactly once, early in the
 * bootstrap path, before any consumer reads `capabilities`. A second call
 * throws `ClawPilotError(code: "CAPABILITY_REGISTRY_LOCKED")`.
 *
 * Community never calls this function. Enterprise calls it from its own
 * `src/index.ts` before any other core module is imported transitively.
 */
export function setCapabilityRegistry(impl: CapabilityRegistry): void {
  if (locked) {
    throw new ClawPilotError(
      "CapabilityRegistry already locked — setCapabilityRegistry() must be called exactly once during bootstrap",
      "CAPABILITY_REGISTRY_LOCKED",
    );
  }
  current = impl;
  locked = true;
}

/**
 * Singleton accessor. Delegating proxy so consumers can import once and keep
 * a stable reference even though Enterprise may swap the underlying registry
 * at bootstrap.
 */
export const capabilities: CapabilityRegistry = {
  has: (cap) => current.has(cap),
  require: (cap) => current.require(cap),
  list: () => current.list(),
};
```

### 5.3 Design notes

- **Proxy singleton.** `capabilities` is a plain object whose methods close over a module-level `current` variable. This indirection lets Enterprise swap the registry after consumers have already imported `capabilities`.
- **One-shot lock.** `locked` is a module-scoped boolean. `setCapabilityRegistry` flips it on first successful call; a second call throws. This mirrors the plan's requirement that differentiation happens exactly once and eliminates the risk of mid-run registry changes.
- **Synchronous API.** Matches the plan. Enterprise is responsible for preloading any async state (JWT parse, network fetch) before calling `setCapabilityRegistry`.
- **Error class co-located with `Capability`.** `CapabilityNotAvailableError` lives in `capabilities.ts` rather than `src/lib/errors.ts`, because its constructor references the `Capability` type. `src/lib/errors.ts` is untouched; we only import `ClawPilotError` from it.
- **`readonly` return from `list()`.** Prevents accidental mutation of the enabled-cap list by consumers.

### 5.4 Enterprise-side usage (illustrative, not shipped here)

```typescript
// src/index.ts — Enterprise repo only
import { setCapabilityRegistry, Capability, CapabilityRegistry } from "@/core/capabilities";
import { parseLicence } from "./licence";

const enabled: Set<Capability> = parseLicence(process.env.CP_LICENCE_JWT);

const enterpriseRegistry: CapabilityRegistry = {
  has: (cap) => enabled.has(cap),
  require: (cap) => {
    if (!enabled.has(cap)) throw new CapabilityNotAvailableError(cap);
  },
  list: () => Array.from(enabled),
};

setCapabilityRegistry(enterpriseRegistry);
// … rest of the boot sequence …
```

This example lives in the Enterprise repo; nothing in Community needs to know about it.

## 6. Testing

### 6.1 Strategy

Unit tests only. No integration test: there is no consumer yet. Consumers delivered by H1–H4, H6, H7 will test their own usage of `capabilities.has()` / `require()`.

### 6.2 Test isolation

The module holds a `locked` boolean that must be reset between tests. Instead of exposing a test-only `__reset()` helper, tests use `vi.resetModules()` and re-import `@/core/capabilities` in a `beforeEach`. Rationale: zero test-only surface on the public API.

### 6.3 Cases

| # | Case | Expected |
|---|---|---|
| 1 | Default registry → `has("sso-oidc")` | `false` |
| 2 | Default registry → `require("rbac-fine")` | throws `CapabilityNotAvailableError` with `code === "CAPABILITY_NOT_AVAILABLE"` |
| 3 | Default registry → `list()` | `[]` |
| 4 | After `setCapabilityRegistry(fake)` enabling `"sso-oidc"` → `capabilities.has("sso-oidc")` | `true` (proxy reflects swap) |
| 5 | After `setCapabilityRegistry(fake)` enabling `"rbac-fine"` → `capabilities.require("rbac-fine")` | does not throw |
| 6 | Calling `setCapabilityRegistry` twice | second call throws `ClawPilotError` with `code === "CAPABILITY_REGISTRY_LOCKED"` |
| 7 | Calling `setCapabilityRegistry` once then `has` once, then a second `setCapabilityRegistry` call | second call still throws, first registry remains active |
| 8 | `list()` return type | compile-time: `// @ts-expect-error` proves `.push(...)` is rejected |

### 6.4 No spellcheck exceptions expected

`cspell` dictionaries already cover `siem`, `oidc`, `saml`, `rbac`, `abac`, `azuread`, `tenant`, `tenancy`. The file will go through CI spellcheck unchanged.

## 7. Documentation

### 7.1 New doc

`docs/architecture/capability-registry.md` — ~150 lines, sections:

1. **Purpose.** Single differentiation point between Community and Enterprise; replaces any `if (isEnterprise)` branching.
2. **API reference.** `Capability`, `CapabilityRegistry`, `capabilities` singleton, `setCapabilityRegistry`, `CapabilityNotAvailableError`.
3. **Usage pattern.** `import { capabilities } from "@/core/capabilities"`, `capabilities.has(cap)` for optional branches, `capabilities.require(cap)` at the top of code paths that must fail fast.
4. **Adding a new capability.** Checklist: extend the `EnterpriseCapability` union; update this doc's API reference section. No DB migration, no config entry.
5. **Enterprise override.** Expected call from Enterprise `src/index.ts`, lock semantics, timing (before any core import that reads `capabilities`).
6. **Why a proxy singleton.** Short rationale on late-binding and import order.

### 7.2 CLAUDE.md update

Single line added under the existing `src/` directory listing, pointing to the new `capability-registry.md`.

### 7.3 No change to `ai-docs/plan-enterprise-edition.md`

That document already describes H5 (§H5) and is the source spec. The present document is the implementation design that stems from it.

## 8. Scope of changes

| Area | File(s) | Change |
|---|---|---|
| Core module | `src/core/capabilities.ts` | add |
| Tests | `src/core/__tests__/capabilities.test.ts` | add |
| Architecture doc | `docs/architecture/capability-registry.md` | add |
| Listing | `CLAUDE.md` (worktree root, not `ai-docs/` parent) | edit (1 line) |

No other files are touched. `src/lib/errors.ts` remains unchanged; we only import `ClawPilotError` from it.

## 9. Commit discipline

Single commit (or small series) with this trailer on the commit that adds `src/core/capabilities.ts`:

```
Extension-Point: CapabilityRegistry
```

Rationale: `src/core/` is a frozen path under rule R3. The trailer documents that this addition is an intentional extension point for the Enterprise fork, not a breaking modification of existing logic.

Commit message prefix: `feat(core): ` per conventional commits.

## 10. PR checklist

- [ ] Branch `feature/capability-registry` pushed to origin.
- [ ] CI green (typecheck, lint, test, spellcheck, build).
- [ ] Commit trailer `Extension-Point: CapabilityRegistry` present on the core-module commit.
- [ ] PR opened against `develop` via `gh pr create` (never merged locally).
- [ ] MAC deploy of the feature branch for manual validation (though H5 has no user-facing surface, we still follow the workflow).
- [ ] PR description links to this spec and to `ai-docs/plan-enterprise-edition.md` §H5.

## 11. Open points deferred to implementation plan

- Exact import path used throughout the codebase (`@/core/capabilities` vs `../../core/capabilities`) — decided by the existing `tsconfig.paths` configuration at implementation time.
- Whether `CapabilityNotAvailableError.name` should read `"CapabilityNotAvailableError"` (matching the class name) vs inherit `"ClawPilotError"` — default to the former for parity with `InstanceNotFoundError` style, but confirm by reading how existing subclasses are thrown and caught in tests.
- Whether to add a `describe.concurrent` block or keep the tests serial — depends on `vi.resetModules()` behavior under parallel test runners; to be decided when writing the tests.
