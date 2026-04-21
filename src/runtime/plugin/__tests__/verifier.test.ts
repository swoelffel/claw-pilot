import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../core/capabilities.js", () => ({
  capabilities: { has: vi.fn().mockReturnValue(false) },
}));

import { capabilities } from "../../../core/capabilities.js";
import {
  NullPluginVerifier,
  getPluginVerifier,
  registerPluginVerifier,
  resetPluginVerifier,
  type PluginVerifier,
  type VerificationResult,
} from "../verifier.js";

class FakeCaVerifier implements PluginVerifier {
  readonly kind = "ca";
  async verify(): Promise<VerificationResult> {
    return { ok: true };
  }
}

beforeEach(() => {
  resetPluginVerifier();
  vi.mocked(capabilities.has).mockReturnValue(false);
});

describe("PluginVerifier registry", () => {
  it("falls back to NullPluginVerifier when none registered", async () => {
    const v = getPluginVerifier();
    expect(v.kind).toBe("null");
    const r = await v.verify({ path: "/x", bytes: new Uint8Array(), hash: "0" });
    expect(r).toEqual({ ok: true });
  });

  it("always accepts a NullPluginVerifier registration (no capability needed)", () => {
    expect(() => registerPluginVerifier(new NullPluginVerifier())).not.toThrow();
    expect(getPluginVerifier().kind).toBe("null");
  });

  it("refuses a non-null verifier when 'plugin-signature' capability is off", () => {
    expect(() => registerPluginVerifier(new FakeCaVerifier())).toThrow(
      /plugin-signature.*capability/i,
    );
  });

  it("accepts a non-null verifier when 'plugin-signature' capability is on", () => {
    vi.mocked(capabilities.has).mockReturnValue(true);
    expect(() => registerPluginVerifier(new FakeCaVerifier())).not.toThrow();
    expect(getPluginVerifier().kind).toBe("ca");
  });
});
