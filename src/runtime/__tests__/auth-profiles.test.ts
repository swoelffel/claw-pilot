import { describe, it, expect, beforeEach } from "vitest";
import {
  upsertAuthProfile,
  getAuthProfiles,
  getNextAvailableProfile,
  markProfileFailed,
  markProfileSuccess,
  clearAuthProfiles,
  classifyFailure,
  exportAuthProfiles,
  importAuthProfiles,
} from "../provider/auth-profiles.js";
import type { AuthProfile } from "../types.js";

const SLUG = "auth-test-instance";

function makeProfile(overrides: Partial<AuthProfile> = {}): AuthProfile {
  return {
    id: "profile-1",
    instanceSlug: SLUG,
    providerId: "anthropic",
    apiKeyRef: "ANTHROPIC_API_KEY",
    priority: 0,
    failureCount: 0,
    cooldownUntil: undefined,
    lastError: undefined,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("auth profile CRUD", () => {
  beforeEach(() => clearAuthProfiles(SLUG));

  it("upsert and retrieve a profile", () => {
    upsertAuthProfile(makeProfile());
    const profiles = getAuthProfiles(SLUG, "anthropic");
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.id).toBe("profile-1");
  });

  it("returns empty array for unknown provider", () => {
    expect(getAuthProfiles(SLUG, "unknown")).toHaveLength(0);
  });

  it("sorts profiles by priority ascending", () => {
    upsertAuthProfile(makeProfile({ id: "p2", priority: 2 }));
    upsertAuthProfile(makeProfile({ id: "p0", priority: 0 }));
    upsertAuthProfile(makeProfile({ id: "p1", priority: 1 }));

    const profiles = getAuthProfiles(SLUG, "anthropic");
    expect(profiles.map((p) => p.id)).toEqual(["p0", "p1", "p2"]);
  });
});

describe("getNextAvailableProfile", () => {
  beforeEach(() => clearAuthProfiles(SLUG));

  it("returns the highest priority available profile", () => {
    upsertAuthProfile(makeProfile({ id: "p0", priority: 0 }));
    upsertAuthProfile(makeProfile({ id: "p1", priority: 1 }));

    const next = getNextAvailableProfile(SLUG, "anthropic");
    expect(next?.id).toBe("p0");
  });

  it("skips profiles in cooldown", () => {
    const future = new Date(Date.now() + 60_000);
    upsertAuthProfile(makeProfile({ id: "p0", priority: 0, cooldownUntil: future }));
    upsertAuthProfile(makeProfile({ id: "p1", priority: 1 }));

    const next = getNextAvailableProfile(SLUG, "anthropic");
    expect(next?.id).toBe("p1");
  });

  it("returns undefined when all profiles are in cooldown", () => {
    const future = new Date(Date.now() + 60_000);
    upsertAuthProfile(makeProfile({ id: "p0", cooldownUntil: future }));

    expect(getNextAvailableProfile(SLUG, "anthropic")).toBeUndefined();
  });

  it("returns profile whose cooldown has expired", () => {
    const past = new Date(Date.now() - 1000);
    upsertAuthProfile(makeProfile({ id: "p0", cooldownUntil: past }));

    const next = getNextAvailableProfile(SLUG, "anthropic");
    expect(next?.id).toBe("p0");
  });
});

describe("markProfileFailed", () => {
  beforeEach(() => clearAuthProfiles(SLUG));

  it("increments failure count and sets cooldown", () => {
    upsertAuthProfile(makeProfile({ id: "p0" }));
    markProfileFailed(SLUG, "p0", "rate_limit");

    const profiles = getAuthProfiles(SLUG, "anthropic");
    expect(profiles[0]!.failureCount).toBe(1);
    expect(profiles[0]!.lastError).toBe("rate_limit");
    expect(profiles[0]!.cooldownUntil).toBeDefined();
    expect(profiles[0]!.cooldownUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it("returns next available profile for failover", () => {
    upsertAuthProfile(makeProfile({ id: "p0", priority: 0 }));
    upsertAuthProfile(makeProfile({ id: "p1", priority: 1 }));

    const next = markProfileFailed(SLUG, "p0", "rate_limit");
    expect(next?.id).toBe("p1");
  });

  it("returns undefined when no other profile available", () => {
    upsertAuthProfile(makeProfile({ id: "p0" }));
    const next = markProfileFailed(SLUG, "p0", "rate_limit");
    expect(next).toBeUndefined();
  });

  it("context_overflow does not set cooldown", () => {
    upsertAuthProfile(makeProfile({ id: "p0" }));
    markProfileFailed(SLUG, "p0", "context_overflow");

    const profiles = getAuthProfiles(SLUG, "anthropic");
    expect(profiles[0]!.cooldownUntil).toBeUndefined();
  });
});

describe("markProfileSuccess", () => {
  beforeEach(() => clearAuthProfiles(SLUG));

  it("resets failure count and cooldown", () => {
    const future = new Date(Date.now() + 60_000);
    upsertAuthProfile(
      makeProfile({ id: "p0", failureCount: 3, cooldownUntil: future, lastError: "rate_limit" }),
    );

    markProfileSuccess(SLUG, "p0");

    const profiles = getAuthProfiles(SLUG, "anthropic");
    expect(profiles[0]!.failureCount).toBe(0);
    expect(profiles[0]!.cooldownUntil).toBeUndefined();
    expect(profiles[0]!.lastError).toBeUndefined();
  });
});

describe("classifyFailure", () => {
  it("classifies HTTP 401 as auth_invalid", () => {
    expect(classifyFailure({ status: 401 })).toBe("auth_invalid");
  });

  it("classifies HTTP 429 as rate_limit", () => {
    expect(classifyFailure({ status: 429 })).toBe("rate_limit");
  });

  it("classifies HTTP 402 as billing", () => {
    expect(classifyFailure({ status: 402 })).toBe("billing");
  });

  it("classifies HTTP 500 as server_error", () => {
    expect(classifyFailure({ status: 500 })).toBe("server_error");
  });

  it("classifies rate limit message", () => {
    expect(classifyFailure({ message: "Rate limit exceeded" })).toBe("rate_limit");
  });

  it("classifies context length message", () => {
    expect(classifyFailure({ message: "context length exceeded" })).toBe("context_overflow");
  });

  it("returns unknown for unrecognized errors", () => {
    expect(classifyFailure({ message: "something weird" })).toBe("unknown");
    expect(classifyFailure(null)).toBe("unknown");
    expect(classifyFailure("string error")).toBe("unknown");
  });
});

describe("export/import", () => {
  beforeEach(() => clearAuthProfiles(SLUG));

  it("round-trips profiles through export/import", () => {
    upsertAuthProfile(makeProfile({ id: "p0" }));
    upsertAuthProfile(makeProfile({ id: "p1", priority: 1 }));

    const exported = exportAuthProfiles(SLUG);
    clearAuthProfiles(SLUG);
    expect(getAuthProfiles(SLUG, "anthropic")).toHaveLength(0);

    importAuthProfiles(exported);
    expect(getAuthProfiles(SLUG, "anthropic")).toHaveLength(2);
  });
});
