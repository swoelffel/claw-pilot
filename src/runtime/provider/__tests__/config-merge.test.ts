// src/runtime/provider/__tests__/config-merge.test.ts
import { describe, it, expect } from "vitest";
import { mergeProviderConfig } from "../config-merge.js";
import { createDefaultRuntimeConfig } from "../../config/index.js";
import type { UserProviderConfig, UserModelAlias } from "../../profile/types.js";

describe("mergeProviderConfig", () => {
  it("returns instance config unchanged when no user data", () => {
    const config = createDefaultRuntimeConfig({});
    const result = mergeProviderConfig(config, [], [], undefined);

    expect(result.providers).toEqual(config.providers);
    expect(result.models).toEqual(config.models);
    expect(result.defaultModel).toBe(config.defaultModel);
  });

  it("adds user providers when instance has none", () => {
    const config = createDefaultRuntimeConfig({});
    const userProviders: UserProviderConfig[] = [
      {
        providerId: "openai",
        apiKeyEnvVar: "OPENAI_API_KEY",
        baseUrl: null,
        priority: 0,
        headers: null,
      },
    ];

    const result = mergeProviderConfig(config, userProviders, [], undefined);

    const openaiProvider = result.providers.find((p) => p.id === "openai");
    expect(openaiProvider).toBeDefined();
    expect(openaiProvider!.authProfiles[0]!.apiKeyEnvVar).toBe("OPENAI_API_KEY");
  });

  it("instance provider overrides user provider with same id", () => {
    const config = createDefaultRuntimeConfig({});
    // Add an anthropic provider to instance config
    config.providers = [
      {
        id: "anthropic",
        authProfiles: [
          {
            id: "instance-key",
            providerId: "anthropic",
            apiKeyEnvVar: "INSTANCE_KEY",
            priority: 0,
          },
        ],
      },
    ];

    const userProviders: UserProviderConfig[] = [
      {
        providerId: "anthropic",
        apiKeyEnvVar: "USER_KEY",
        baseUrl: null,
        priority: 0,
        headers: null,
      },
    ];

    const result = mergeProviderConfig(config, userProviders, [], undefined);

    // Only instance anthropic should be present (not duplicated)
    const anthropicProviders = result.providers.filter((p) => p.id === "anthropic");
    expect(anthropicProviders).toHaveLength(1);
    expect(anthropicProviders[0]!.authProfiles[0]!.apiKeyEnvVar).toBe("INSTANCE_KEY");
  });

  it("adds user model aliases when instance has none", () => {
    const config = createDefaultRuntimeConfig({});
    const userAliases: UserModelAlias[] = [
      { aliasId: "fast", provider: "anthropic", model: "claude-haiku-3-5", contextWindow: null },
    ];

    const result = mergeProviderConfig(config, [], userAliases, undefined);

    expect(result.models).toHaveLength(1);
    expect(result.models[0]!.id).toBe("fast");
  });

  it("instance alias overrides user alias with same id", () => {
    const config = createDefaultRuntimeConfig({});
    config.models = [{ id: "fast", provider: "openai", model: "gpt-4o-mini" }];

    const userAliases: UserModelAlias[] = [
      { aliasId: "fast", provider: "anthropic", model: "claude-haiku-3-5", contextWindow: null },
    ];

    const result = mergeProviderConfig(config, [], userAliases, undefined);

    const fastAliases = result.models.filter((m) => m.id === "fast");
    expect(fastAliases).toHaveLength(1);
    expect(fastAliases[0]!.provider).toBe("openai"); // instance wins
  });

  it("uses user defaultModel when instance has the default", () => {
    const config = createDefaultRuntimeConfig({});
    // Default model is "anthropic/claude-sonnet-4-5" — the schema default

    const result = mergeProviderConfig(config, [], [], "openai/gpt-4o");

    expect(result.defaultModel).toBe("openai/gpt-4o");
  });

  it("instance defaultModel wins over user when explicitly set", () => {
    const config = createDefaultRuntimeConfig({ defaultModel: "openai/gpt-4o" });

    const result = mergeProviderConfig(config, [], [], "anthropic/claude-haiku-3-5");

    expect(result.defaultModel).toBe("openai/gpt-4o");
  });
});
