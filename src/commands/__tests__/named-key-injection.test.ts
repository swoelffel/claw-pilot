import { describe, it, expect, afterEach } from "vitest";
import { injectNamedKeyForCli } from "../_named-key-inject.js";

describe("injectNamedKeyForCli", () => {
  afterEach(() => {
    // Clean up env vars set by tests
    delete process.env["ANTHROPIC_API_KEY"];
    delete process.env["OPENAI_API_KEY"];
  });

  it("injects the API key if the env var is not set", () => {
    injectNamedKeyForCli({ providerId: "anthropic", apiKey: "sk-test-123" });
    expect(process.env["ANTHROPIC_API_KEY"]).toBe("sk-test-123");
  });

  it("does NOT overwrite an existing env var", () => {
    process.env["ANTHROPIC_API_KEY"] = "existing-key";
    injectNamedKeyForCli({ providerId: "anthropic", apiKey: "sk-new-key" });
    expect(process.env["ANTHROPIC_API_KEY"]).toBe("existing-key");
  });

  it("handles unknown provider gracefully (no throw)", () => {
    expect(() =>
      injectNamedKeyForCli({ providerId: "unknown-provider", apiKey: "sk-x" }),
    ).not.toThrow();
  });

  it("injects OpenAI key correctly", () => {
    injectNamedKeyForCli({ providerId: "openai", apiKey: "sk-openai-test" });
    expect(process.env["OPENAI_API_KEY"]).toBe("sk-openai-test");
  });
});
