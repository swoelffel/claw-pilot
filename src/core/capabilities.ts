// src/core/capabilities.ts
import { ClawPilotError } from "../lib/errors.js";

/**
 * Enterprise-only capabilities. Always false in the Community edition.
 *
 * This union is the single source of truth for differentiation between
 * Community and Enterprise behavior. Adding a new capability means adding
 * a member here, then updating `docs/architecture/capability-registry.md`.
 */
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
 *
 * Core capabilities (always-true in both editions) may be folded into this
 * union later, on demand, when a concrete gating need emerges. There is no
 * core capability today — the registry exists purely to gate enterprise
 * features without relying on forbidden `if (isEnterprise)` branches.
 */
export type Capability = EnterpriseCapability;

/**
 * Contract consumed by every call site that needs to know whether a given
 * capability is enabled in the current edition.
 */
export interface CapabilityRegistry {
  has(cap: Capability): boolean;
  /** Throws `CapabilityNotAvailableError` if the capability is disabled. */
  require(cap: Capability): void;
  list(): readonly Capability[];
}

/**
 * Thrown by `capabilities.require()` when the requested capability is not
 * enabled. Carries the standard `ClawPilotError` contract (string `code`).
 */
export class CapabilityNotAvailableError extends ClawPilotError {
  constructor(cap: Capability) {
    super(`Capability "${cap}" is not available in this edition`, "CAPABILITY_NOT_AVAILABLE");
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
 * throws a `ClawPilotError` with code `CAPABILITY_REGISTRY_LOCKED`.
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
 * Singleton accessor. Delegating proxy so consumers can import once and
 * keep a stable reference even though Enterprise may swap the underlying
 * registry at bootstrap.
 */
export const capabilities: CapabilityRegistry = {
  has: (cap) => current.has(cap),
  require: (cap) => current.require(cap),
  list: () => current.list(),
};
