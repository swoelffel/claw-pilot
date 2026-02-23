# 01. Config-Generator Refactor

meta:
  id: multi-provider-01
  feature: multi-provider
  priority: P1
  depends_on: []
  tags: [implementation, tests-required, breaking-change]

---

## Objective

Replace the `anthropicApiKey` field in `WizardAnswers` and the hardcoded Anthropic-only
`generateEnv()` / `generateConfig()` output with a provider-agnostic system driven by a
`PROVIDER_ENV_VARS` map.

---

## Files to modify

| File | Action |
|------|--------|
| `src/core/config-generator.ts` | Refactor interface + both generator functions |
| `src/core/__tests__/config-generator.test.ts` | Update all tests for new shape |

---

## Exact changes

### 1. `WizardAnswers` interface

Remove:
```ts
anthropicApiKey: "reuse" | string;
```

Add:
```ts
provider: string;   // e.g. "anthropic" | "openai" | "openrouter" | "gemini" | "mistral" | "opencode"
apiKey: string;     // literal key value, "reuse", or "" for opencode
```

### 2. Add `PROVIDER_ENV_VARS` constant (exported)

```ts
export const PROVIDER_ENV_VARS: Record<string, string> = {
  anthropic:   "ANTHROPIC_API_KEY",
  openai:      "OPENAI_API_KEY",
  openrouter:  "OPENROUTER_API_KEY",
  gemini:      "GEMINI_API_KEY",
  mistral:     "MISTRAL_API_KEY",
  opencode:    "",   // no env var needed
};
```

### 3. `generateEnv()` signature change

Old:
```ts
export function generateEnv(options: {
  anthropicApiKey: string;
  gatewayToken: string;
  telegramBotToken?: string;
}): string
```

New:
```ts
export function generateEnv(options: {
  provider: string;
  apiKey: string;
  gatewayToken: string;
  telegramBotToken?: string;
}): string
```

New body logic:
```ts
const lines: string[] = [];
const envVar = PROVIDER_ENV_VARS[options.provider] ?? "";
if (envVar && options.apiKey) {
  lines.push(`${envVar}=${options.apiKey}`);
}
lines.push(`OPENCLAW_GW_AUTH_TOKEN=${options.gatewayToken}`);
if (options.telegramBotToken) {
  lines.push(`TELEGRAM_BOT_TOKEN=${options.telegramBotToken}`);
}
return lines.join("\n") + "\n";
```

Key rules:
- If `provider === "opencode"` (envVar is `""`): skip the API key line entirely.
- If `envVar` is non-empty but `apiKey` is empty: also skip (defensive).

### 4. `generateConfig()` — `models.providers` block

Old (hardcoded):
```ts
models: {
  providers: {
    anthropic: {
      apiKey: "${ANTHROPIC_API_KEY}",
      models: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"],
    },
  },
},
```

New (provider-driven):
```ts
// Build provider config block
const envVar = PROVIDER_ENV_VARS[answers.provider] ?? "";
const providerBlock: Record<string, unknown> = {};

if (answers.provider === "opencode") {
  // opencode uses no API key — empty provider block signals "use system opencode"
  providerBlock["opencode"] = { enabled: true };
} else if (envVar) {
  providerBlock[answers.provider] = {
    apiKey: `\${${envVar}}`,
  };
}

// Then in config object:
models: {
  providers: providerBlock,
},
```

Note: The `models` array inside the provider block is intentionally omitted here — OpenClaw
resolves available models from the provider at runtime. The `agents.defaults.model` field
(already set from `answers.defaultModel`) is the only model reference needed.

---

## Deliverables

- `WizardAnswers` no longer has `anthropicApiKey`; has `provider: string` + `apiKey: string`
- `PROVIDER_ENV_VARS` is exported from `config-generator.ts`
- `generateEnv()` accepts `{ provider, apiKey, gatewayToken, telegramBotToken? }`
- `generateConfig()` writes the correct `models.providers` block for any provider
- All tests in `config-generator.test.ts` updated and passing

---

## Acceptance criteria

- [ ] `WizardAnswers` compiles without `anthropicApiKey` field
- [ ] `generateEnv({ provider: "anthropic", apiKey: "sk-ant-x", gatewayToken: "t" })` returns a string containing `ANTHROPIC_API_KEY=sk-ant-x`
- [ ] `generateEnv({ provider: "openai", apiKey: "sk-x", gatewayToken: "t" })` returns `OPENAI_API_KEY=sk-x`
- [ ] `generateEnv({ provider: "opencode", apiKey: "", gatewayToken: "t" })` does NOT contain any `=` line for an API key
- [ ] `generateConfig({ ...answers, provider: "openai", apiKey: "..." })` produces JSON where `models.providers.openai.apiKey === "${OPENAI_API_KEY}"`
- [ ] `generateConfig({ ...answers, provider: "opencode", apiKey: "" })` produces JSON where `models.providers.opencode.enabled === true`
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test:run` exits 0

---

## Validation

```bash
cd src/claw-pilot
pnpm typecheck
pnpm test:run -- config-generator
```

---

## Notes

- This is a **breaking change** to `WizardAnswers`. Tasks 02, 03, 04 all depend on this shape.
  Complete and verify this task before starting any of the others.
- The `PROVIDER_ENV_VARS` map is the single source of truth for provider → env var mapping.
  Both `generateEnv()` (writes the .env) and the provisioner "reuse" logic (reads the .env)
  must use this same map.
- Do not add a `models` array inside the provider block in `generateConfig()`. OpenClaw
  discovers models from the provider; the only model reference is `agents.defaults.model`.
