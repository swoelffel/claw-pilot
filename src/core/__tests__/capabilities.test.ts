// src/core/__tests__/capabilities.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";

type CapabilitiesModule = typeof import("../capabilities.js");
type ErrorsModule = typeof import("../../lib/errors.js");

async function loadModules(): Promise<{ mod: CapabilitiesModule; errors: ErrorsModule }> {
  vi.resetModules();
  // Vitest 4.x's vi.resetModules() re-evaluates errors.ts on the dynamic import,
  // producing a fresh `ClawPilotError` class. A static `import { ClawPilotError }`
  // at the top of this file would bind to the *first* evaluation, so
  // `thrown instanceof ClawPilotError` would fail on every test after the first.
  // Loading errors dynamically inside the loader keeps both imports pointing at
  // the same post-reset class instance.
  const errors = await import("../../lib/errors.js");
  const mod = await import("../capabilities.js");
  return { mod, errors };
}

describe("capabilities — Community default registry", () => {
  let mod: CapabilitiesModule;
  let errors: ErrorsModule;

  beforeEach(async () => {
    ({ mod, errors } = await loadModules());
  });

  it("has() returns false for every enterprise capability", () => {
    expect(mod.capabilities.has("sso-oidc")).toBe(false);
    expect(mod.capabilities.has("rbac-fine")).toBe(false);
    expect(mod.capabilities.has("vault-secrets")).toBe(false);
  });

  it("require() throws CapabilityNotAvailableError with code CAPABILITY_NOT_AVAILABLE", () => {
    let thrown: unknown;
    try {
      mod.capabilities.require("rbac-fine");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(mod.CapabilityNotAvailableError);
    expect(thrown).toBeInstanceOf(errors.ClawPilotError);
    expect((thrown as InstanceType<typeof mod.CapabilityNotAvailableError>).code).toBe(
      "CAPABILITY_NOT_AVAILABLE",
    );
    expect((thrown as Error).message).toContain("rbac-fine");
  });

  it("list() returns an empty array", () => {
    expect(mod.capabilities.list()).toEqual([]);
  });

  it("list() return type is readonly at compile time", () => {
    const list = mod.capabilities.list();
    // @ts-expect-error readonly array must reject .push()
    list.push("sso-oidc");
    expect(Array.isArray(list)).toBe(true);
  });
});

describe("capabilities — setCapabilityRegistry()", () => {
  let mod: CapabilitiesModule;
  let errors: ErrorsModule;

  beforeEach(async () => {
    ({ mod, errors } = await loadModules());
  });

  it("replaces the default registry — proxy reflects the swap", () => {
    const fake: import("../capabilities.js").CapabilityRegistry = {
      has: (cap) => cap === "sso-oidc",
      require: (cap) => {
        if (cap !== "sso-oidc") throw new mod.CapabilityNotAvailableError(cap);
      },
      list: () => ["sso-oidc"],
    };

    mod.setCapabilityRegistry(fake);

    expect(mod.capabilities.has("sso-oidc")).toBe(true);
    expect(mod.capabilities.has("rbac-fine")).toBe(false);
    expect(mod.capabilities.list()).toEqual(["sso-oidc"]);
    expect(() => mod.capabilities.require("sso-oidc")).not.toThrow();
    expect(() => mod.capabilities.require("rbac-fine")).toThrow(mod.CapabilityNotAvailableError);
  });

  it("throws CAPABILITY_REGISTRY_LOCKED on a second call", () => {
    const fake1: import("../capabilities.js").CapabilityRegistry = {
      has: () => false,
      require: () => {},
      list: () => [],
    };
    const fake2: import("../capabilities.js").CapabilityRegistry = {
      has: () => true,
      require: () => {},
      list: () => ["audit-siem"],
    };

    mod.setCapabilityRegistry(fake1);

    // Exercise fake1 between the two set calls so that the spec §6.3 case #7
    // ("first registry remains active") is genuinely asserted rather than
    // incidentally satisfied after the lock throws.
    expect(mod.capabilities.has("sso-oidc")).toBe(false);

    let thrown: unknown;
    try {
      mod.setCapabilityRegistry(fake2);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(errors.ClawPilotError);
    expect((thrown as InstanceType<typeof errors.ClawPilotError>).code).toBe(
      "CAPABILITY_REGISTRY_LOCKED",
    );
    // First registry must still be active.
    expect(mod.capabilities.list()).toEqual([]);
    expect(mod.capabilities.has("audit-siem")).toBe(false);
  });
});
