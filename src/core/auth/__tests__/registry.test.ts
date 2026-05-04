// src/core/auth/__tests__/registry.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  authenticate,
  clearAuthProviders,
  hasAuthProvider,
  listAuthProviderKinds,
  listLoginableProviders,
  registerAuthProvider,
  unregisterAuthProvider,
} from "../index.js";
import type { AuthProvider, AuthResult, LoginDescriptor } from "../provider.js";

function fakeProvider(kind: string, result: AuthResult): AuthProvider {
  return {
    kind,
    authenticate: async () => result,
  };
}

function fakeLoginableProvider(kind: string, descriptor: LoginDescriptor): AuthProvider {
  return {
    kind,
    authenticate: async () => ({ ok: false, code: "X", message: "" }),
    describeLogin: () => descriptor,
  };
}

describe("auth registry", () => {
  beforeEach(() => {
    clearAuthProviders();
  });

  it("registers and dispatches to the matching provider", async () => {
    const p = fakeProvider("stub", {
      ok: true,
      user: { id: 42, username: "alice", role: "admin" },
    });
    registerAuthProvider(p);

    const result = await authenticate("stub", {});
    expect(result).toEqual({ ok: true, user: { id: 42, username: "alice", role: "admin" } });
  });

  it("returns UNKNOWN_AUTH_KIND when no provider matches", async () => {
    const result = await authenticate("missing", {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("UNKNOWN_AUTH_KIND");
    }
  });

  it("throws when registering the same kind twice", () => {
    registerAuthProvider(fakeProvider("dup", { ok: false, code: "X", message: "" }));
    expect(() =>
      registerAuthProvider(fakeProvider("dup", { ok: false, code: "X", message: "" })),
    ).toThrow(/already registered/);
  });

  it("unregisterAuthProvider removes the provider and allows re-registration", () => {
    const p = fakeProvider("temp", { ok: false, code: "X", message: "" });
    registerAuthProvider(p);
    expect(hasAuthProvider("temp")).toBe(true);
    expect(unregisterAuthProvider("temp")).toBe(true);
    expect(hasAuthProvider("temp")).toBe(false);
    expect(unregisterAuthProvider("temp")).toBe(false);
    registerAuthProvider(p);
    expect(hasAuthProvider("temp")).toBe(true);
  });

  it("listAuthProviderKinds lists registered kinds", () => {
    registerAuthProvider(fakeProvider("a", { ok: false, code: "X", message: "" }));
    registerAuthProvider(fakeProvider("b", { ok: false, code: "X", message: "" }));
    expect(listAuthProviderKinds().sort()).toEqual(["a", "b"]);
  });

  it("clearAuthProviders empties the registry", () => {
    registerAuthProvider(fakeProvider("a", { ok: false, code: "X", message: "" }));
    clearAuthProviders();
    expect(listAuthProviderKinds()).toEqual([]);
  });

  describe("listLoginableProviders", () => {
    it("returns descriptors only for providers implementing describeLogin", () => {
      registerAuthProvider(fakeProvider("password", { ok: false, code: "X", message: "" }));
      registerAuthProvider(
        fakeLoginableProvider("oidc", {
          id: "entra-prod",
          kind: "oidc",
          display_name: "Sign in with Microsoft",
          login_url: "/api/auth/oidc/entra-prod/start",
        }),
      );

      const descriptors = listLoginableProviders();
      expect(descriptors).toHaveLength(1);
      expect(descriptors[0]).toEqual({
        id: "entra-prod",
        kind: "oidc",
        display_name: "Sign in with Microsoft",
        login_url: "/api/auth/oidc/entra-prod/start",
      });
    });

    it("returns an empty list when no provider exposes a login button", () => {
      registerAuthProvider(fakeProvider("password", { ok: false, code: "X", message: "" }));
      expect(listLoginableProviders()).toEqual([]);
    });

    it("returns an empty list when no provider is registered at all", () => {
      expect(listLoginableProviders()).toEqual([]);
    });

    it("returns one descriptor per provider when several are loginable", () => {
      registerAuthProvider(
        fakeLoginableProvider("oidc", {
          id: "entra-prod",
          kind: "oidc",
          display_name: "Sign in with Microsoft",
          login_url: "/api/auth/oidc/entra-prod/start",
        }),
      );
      registerAuthProvider(
        fakeLoginableProvider("saml", {
          id: "okta-prod",
          kind: "saml",
          display_name: "Sign in with Okta",
          login_url: "/api/auth/saml/okta-prod/start",
        }),
      );

      const ids = listLoginableProviders()
        .map((d) => d.id)
        .sort();
      expect(ids).toEqual(["entra-prod", "okta-prod"]);
    });
  });
});
