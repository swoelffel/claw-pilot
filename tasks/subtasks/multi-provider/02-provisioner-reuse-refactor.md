# 02. Provisioner Reuse-Logic Refactor

meta:
  id: multi-provider-02
  feature: multi-provider
  priority: P1
  depends_on: [multi-provider-01]
  tags: [implementation, tests-required]

---

## Objective

Replace the hardcoded `ANTHROPIC_API_KEY` reuse logic in `Provisioner.provision()` with a
provider-aware version that reads the correct env var from the source instance's `.env` file,
and skips `.env` reading entirely for providers that need no API key (opencode).

---

## Files to modify

| File | Action |
|------|--------|
| `src/core/provisioner.ts` | Refactor "reuse" block + `generateEnv()` call |

---

## Exact changes

### 1. Remove old `anthropicApiKey` variable

Old block (lines 84–111):
```ts
let anthropicApiKey = answers.anthropicApiKey;
if (anthropicApiKey === "reuse") {
  const existing = this.registry.listInstances();
  if (existing.length === 0) {
    throw new ClawPilotError("No existing instance to reuse API key from", "NO_EXISTING_INSTANCE");
  }
  const existingInst = existing[0]!;
  const existingEnvPath = path.join(existingInst.state_dir, ".env");
  const envContent = await this.conn.readFile(existingEnvPath);
  const match = envContent.match(/ANTHROPIC_API_KEY=(.+)/);
  anthropicApiKey = match?.[1]?.trim() ?? "";
  if (!anthropicApiKey) {
    throw new ClawPilotError("Could not read ANTHROPIC_API_KEY from existing instance", "API_KEY_READ_FAILED");
  }
}

const envContent = generateEnv({
  anthropicApiKey,
  gatewayToken,
  telegramBotToken: answers.telegram.botToken,
});
```

### 2. New provider-aware block

Add import at top of file (alongside existing imports):
```ts
import { generateConfig, generateEnv, PROVIDER_ENV_VARS } from "./config-generator.js";
```
(Replace the existing import of `generateConfig, generateEnv` — just add `PROVIDER_ENV_VARS`.)

New reuse block:
```ts
// Resolve API key
let resolvedApiKey = answers.apiKey;

if (resolvedApiKey === "reuse") {
  const envVar = PROVIDER_ENV_VARS[answers.provider] ?? "";

  if (!envVar) {
    // Provider needs no API key (e.g. opencode) — nothing to reuse
    resolvedApiKey = "";
  } else {
    const existing = this.registry.listInstances();
    if (existing.length === 0) {
      throw new ClawPilotError(
        "No existing instance to reuse API key from",
        "NO_EXISTING_INSTANCE",
      );
    }
    const existingInst = existing[0]!;
    const existingEnvPath = path.join(existingInst.state_dir, ".env");

    let envContent: string;
    try {
      envContent = await this.conn.readFile(existingEnvPath);
    } catch (err) {
      throw new ClawPilotError(
        `Could not read .env from existing instance "${existingInst.slug}": ${err instanceof Error ? err.message : String(err)}`,
        "ENV_READ_FAILED",
      );
    }

    const match = envContent.match(new RegExp(`${envVar}=(.+)`));
    resolvedApiKey = match?.[1]?.trim() ?? "";
    if (!resolvedApiKey) {
      throw new ClawPilotError(
        `Could not find ${envVar} in existing instance "${existingInst.slug}" .env`,
        "API_KEY_READ_FAILED",
      );
    }
  }
}

const envContent = generateEnv({
  provider: answers.provider,
  apiKey: resolvedApiKey,
  gatewayToken,
  telegramBotToken: answers.telegram.botToken,
});
```

### 3. Error classification

The two new `ClawPilotError` throws (`ENV_READ_FAILED`, `API_KEY_READ_FAILED`) must be caught
by the POST handler and returned as **400** (not 500). See task 04 for the handler change.

---

## Deliverables

- `provisioner.ts` no longer references `anthropicApiKey` or `ANTHROPIC_API_KEY`
- `PROVIDER_ENV_VARS` is imported from `config-generator.ts`
- `readFile` is wrapped in try/catch with a descriptive error message
- `generateEnv()` is called with `{ provider, apiKey, gatewayToken, telegramBotToken? }`
- opencode path: when `PROVIDER_ENV_VARS[provider] === ""`, `resolvedApiKey` is set to `""` and no `.env` read is attempted

---

## Acceptance criteria

- [ ] `provisioner.ts` compiles without `anthropicApiKey` references
- [ ] When `answers.apiKey === "reuse"` and `answers.provider === "anthropic"`: reads `ANTHROPIC_API_KEY` from source instance `.env`
- [ ] When `answers.apiKey === "reuse"` and `answers.provider === "openai"`: reads `OPENAI_API_KEY` from source instance `.env`
- [ ] When `answers.apiKey === "reuse"` and `answers.provider === "opencode"`: skips `.env` read, sets `resolvedApiKey = ""`
- [ ] When source instance `.env` is unreadable: throws `ClawPilotError` with code `ENV_READ_FAILED` (not a raw fs error)
- [ ] When env var is missing from `.env`: throws `ClawPilotError` with code `API_KEY_READ_FAILED`
- [ ] When no existing instances: throws `ClawPilotError` with code `NO_EXISTING_INSTANCE`
- [ ] `pnpm typecheck` exits 0

---

## Validation

```bash
cd src/claw-pilot
pnpm typecheck
# Manual: inspect that no string "ANTHROPIC_API_KEY" appears in provisioner.ts
grep -n "ANTHROPIC_API_KEY" src/core/provisioner.ts   # must return nothing
grep -n "anthropicApiKey" src/core/provisioner.ts      # must return nothing
```

---

## Notes

- `this.conn.readFile()` is the SSH-aware file reader (see `ServerConnection`). Do NOT use
  `fs.readFile` directly — the provisioner runs against a remote server.
- The regex `new RegExp(\`${envVar}=(.+)\`)` is safe here because `PROVIDER_ENV_VARS` values
  are all uppercase ASCII with underscores — no regex special chars.
- `ClawPilotError` is already imported from `../lib/errors.js`. No new imports needed beyond
  adding `PROVIDER_ENV_VARS` to the existing config-generator import.
