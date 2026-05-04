import { afterEach, describe, expect, it } from "vitest";
import {
  clearPublicAuthPaths,
  getRegisteredPublicAuthPaths,
  isPublicAuthPath,
  registerPublicAuthPath,
} from "../public-paths.js";

describe("public-paths registry", () => {
  afterEach(() => {
    clearPublicAuthPaths();
  });

  it("starts empty", () => {
    expect(getRegisteredPublicAuthPaths()).toEqual([]);
    expect(isPublicAuthPath("/api/auth/oidc/start")).toBe(false);
  });

  it("registers a prefix and matches exact + sub-paths", () => {
    registerPublicAuthPath("/api/auth/oidc");
    expect(isPublicAuthPath("/api/auth/oidc")).toBe(true);
    expect(isPublicAuthPath("/api/auth/oidc/callback")).toBe(true);
    expect(isPublicAuthPath("/api/auth/oidc/entra/start")).toBe(true);
  });

  it("does not match sibling prefixes", () => {
    registerPublicAuthPath("/api/auth/oidc");
    expect(isPublicAuthPath("/api/auth/oidc-extra")).toBe(false);
    expect(isPublicAuthPath("/api/auth/login")).toBe(false);
    expect(isPublicAuthPath("/api/instances")).toBe(false);
  });

  it("rejects prefixes that do not start with /", () => {
    expect(() => registerPublicAuthPath("api/auth/oidc")).toThrow(/must start with "\/"/);
  });

  it("is idempotent on repeat registration", () => {
    registerPublicAuthPath("/api/auth/oidc");
    registerPublicAuthPath("/api/auth/oidc");
    expect(getRegisteredPublicAuthPaths()).toEqual(["/api/auth/oidc"]);
  });

  it("supports multiple distinct prefixes", () => {
    registerPublicAuthPath("/api/auth/oidc");
    registerPublicAuthPath("/api/auth/saml");
    expect(getRegisteredPublicAuthPaths()).toEqual(["/api/auth/oidc", "/api/auth/saml"]);
    expect(isPublicAuthPath("/api/auth/saml/acs")).toBe(true);
  });

  it("clearPublicAuthPaths resets the registry", () => {
    registerPublicAuthPath("/api/auth/oidc");
    clearPublicAuthPaths();
    expect(getRegisteredPublicAuthPaths()).toEqual([]);
    expect(isPublicAuthPath("/api/auth/oidc/x")).toBe(false);
  });
});
