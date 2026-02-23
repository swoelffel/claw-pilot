# 07. Tests

meta:
  id: multi-provider-07
  feature: multi-provider
  priority: P1
  depends_on: [multi-provider-01, multi-provider-02]
  tags: [tests-required]

---

## Objective

Update `config-generator.test.ts` for the new `WizardAnswers` shape and create
`provisioner-providers.test.ts` to cover the provider-aware reuse logic.

---

## Files to modify / create

| File | Action |
|------|--------|
| `src/core/__tests__/config-generator.test.ts` | Update all tests for new WizardAnswers shape |
| `src/core/__tests__/provisioner-providers.test.ts` | New file — reuse logic tests |

---

## Part A: Update `config-generator.test.ts`

### 1. Update `baseAnswers` fixture

Old:
```ts
const baseAnswers: WizardAnswers = {
  // ...
  anthropicApiKey: "sk-ant-test123",
  // ...
};
```

New:
```ts
const baseAnswers: WizardAnswers = {
  slug: "demo1",
  displayName: "Demo One",
  port: 18789,
  agents: [{ id: "main", name: "Main", isDefault: true }],
  defaultModel: "anthropic/claude-sonnet-4-6",
  provider: "anthropic",
  apiKey: "sk-ant-test123",
  telegram: { enabled: false },
  nginx: { enabled: false },
  mem0: { enabled: false },
};
```

### 2. Update `generateConfig` tests

#### Test: "uses variable reference for API key (not literal)"

Old assertion:
```ts
expect(config.models.providers.anthropic.apiKey).toBe("${ANTHROPIC_API_KEY}");
```

Keep this assertion — it should still pass with the new implementation for `provider: "anthropic"`.

#### Add new test: "uses correct provider block for openai"

```ts
it("uses correct provider block for openai", () => {
  const answers: WizardAnswers = {
    ...baseAnswers,
    provider: "openai",
    apiKey: "sk-openai-test",
  };
  const config = JSON.parse(generateConfig(answers));
  expect(config.models.providers.openai.apiKey).toBe("${OPENAI_API_KEY}");
  expect(config.models.providers.anthropic).toBeUndefined();
});
```

#### Add new test: "uses opencode block when provider is opencode"

```ts
it("uses opencode block when provider is opencode", () => {
  const answers: WizardAnswers = {
    ...baseAnswers,
    provider: "opencode",
    apiKey: "",
  };
  const config = JSON.parse(generateConfig(answers));
  expect(config.models.providers.opencode.enabled).toBe(true);
  expect(config.models.providers.anthropic).toBeUndefined();
});
```

### 3. Update `generateEnv` tests

#### Update "includes all required vars"

Old:
```ts
const env = generateEnv({
  anthropicApiKey: "sk-ant-test",
  gatewayToken: "abcdef123456",
  telegramBotToken: "123:abc",
});
expect(env).toContain("ANTHROPIC_API_KEY=sk-ant-test");
```

New:
```ts
const env = generateEnv({
  provider: "anthropic",
  apiKey: "sk-ant-test",
  gatewayToken: "abcdef123456",
  telegramBotToken: "123:abc",
});
expect(env).toContain("ANTHROPIC_API_KEY=sk-ant-test");
expect(env).toContain("OPENCLAW_GW_AUTH_TOKEN=abcdef123456");
expect(env).toContain("TELEGRAM_BOT_TOKEN=123:abc");
```

#### Update "omits telegram token when not provided"

Old:
```ts
const env = generateEnv({
  anthropicApiKey: "sk-ant-test",
  gatewayToken: "token",
});
```

New:
```ts
const env = generateEnv({
  provider: "anthropic",
  apiKey: "sk-ant-test",
  gatewayToken: "token",
});
```

#### Add new test: "writes correct env var for openai"

```ts
it("writes correct env var for openai", () => {
  const env = generateEnv({
    provider: "openai",
    apiKey: "sk-openai-x",
    gatewayToken: "token",
  });
  expect(env).toContain("OPENAI_API_KEY=sk-openai-x");
  expect(env).not.toContain("ANTHROPIC_API_KEY");
});
```

#### Add new test: "omits API key line for opencode"

```ts
it("omits API key line for opencode", () => {
  const env = generateEnv({
    provider: "opencode",
    apiKey: "",
    gatewayToken: "token",
  });
  expect(env).not.toMatch(/[A-Z_]+=\n/);  // no empty var lines
  expect(env).not.toContain("ANTHROPIC_API_KEY");
  expect(env).not.toContain("OPENAI_API_KEY");
  expect(env).toContain("OPENCLAW_GW_AUTH_TOKEN=token");
});
```

---

## Part B: New `provisioner-providers.test.ts`

### File location

`src/core/__tests__/provisioner-providers.test.ts`

### Test setup

Use the existing `MockConnection` from `mock-connection.ts` (already used in other test files).
Inspect `mock-connection.ts` to understand its API before writing tests.

```ts
// src/core/__tests__/provisioner-providers.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { Provisioner } from "../provisioner.js";
import { MockConnection } from "./mock-connection.js";
// Import Registry and PortAllocator — check how other tests instantiate them
```

### Test cases to implement

#### Group: "reuse logic — anthropic"

```ts
describe("reuse logic — anthropic", () => {
  it("reads ANTHROPIC_API_KEY from source instance .env when apiKey === 'reuse'", async () => {
    // Setup:
    // - registry has one existing instance with state_dir = "/opt/openclaw/oc-source"
    // - MockConnection.readFile("/opt/openclaw/oc-source/.env") returns
    //   "ANTHROPIC_API_KEY=sk-ant-real\nOPENCLAW_GW_AUTH_TOKEN=tok\n"
    // - answers.provider = "anthropic", answers.apiKey = "reuse"
    //
    // Assert:
    // - The .env written to the new instance contains "ANTHROPIC_API_KEY=sk-ant-real"
    // - No error is thrown
  });

  it("throws ClawPilotError(ENV_READ_FAILED) when source .env is unreadable", async () => {
    // Setup: MockConnection.readFile throws ENOENT
    // Assert: provision() rejects with ClawPilotError, err.code === "ENV_READ_FAILED"
  });

  it("throws ClawPilotError(API_KEY_READ_FAILED) when ANTHROPIC_API_KEY missing from .env", async () => {
    // Setup: .env content = "OPENCLAW_GW_AUTH_TOKEN=tok\n" (no ANTHROPIC_API_KEY)
    // Assert: provision() rejects with ClawPilotError, err.code === "API_KEY_READ_FAILED"
  });

  it("throws ClawPilotError(NO_EXISTING_INSTANCE) when registry is empty", async () => {
    // Setup: registry.listInstances() returns []
    // Assert: provision() rejects with ClawPilotError, err.code === "NO_EXISTING_INSTANCE"
  });
});
```

#### Group: "reuse logic — opencode"

```ts
describe("reuse logic — opencode", () => {
  it("skips .env read entirely when provider is opencode and apiKey === 'reuse'", async () => {
    // Setup:
    // - registry has one existing instance
    // - answers.provider = "opencode", answers.apiKey = "reuse"
    // - MockConnection.readFile is a spy
    //
    // Assert:
    // - readFile is NOT called with a .env path
    // - provision() succeeds (or at least does not throw a credential error)
  });

  it("skips .env read when provider is opencode and apiKey === ''", async () => {
    // Same as above but apiKey = "" (direct, not reuse)
  });
});
```

#### Group: "reuse logic — openai"

```ts
describe("reuse logic — openai", () => {
  it("reads OPENAI_API_KEY from source instance .env when apiKey === 'reuse'", async () => {
    // Setup: .env = "OPENAI_API_KEY=sk-openai-real\nOPENCLAW_GW_AUTH_TOKEN=tok\n"
    // answers.provider = "openai", answers.apiKey = "reuse"
    // Assert: written .env contains "OPENAI_API_KEY=sk-openai-real"
  });
});
```

### Implementation notes for test file

- The `Provisioner.provision()` method does many things (mkdir, writeFile, systemd, etc.).
  Use `MockConnection` to stub all filesystem operations.
- Focus assertions on the `.env` content written via `conn.writeFile(envPath, content, mode)`.
  Capture the `content` argument to verify the correct env var was written.
- If `MockConnection` does not support spying on `writeFile` calls, check if vitest's `vi.spyOn`
  can be used on the mock instance.
- The `Provisioner` also calls `OpenClawCLI.detect()` and `Lifecycle` methods. These may need
  to be stubbed. Check `dashboard-service.test.ts` for patterns used in existing tests.
- If full `provision()` integration is too complex to mock, consider extracting the reuse logic
  into a testable helper function `resolveApiKey(answers, registry, conn)` and testing that
  directly. This is acceptable as a refactor within task 02.

---

## Deliverables

- `config-generator.test.ts` updated: all tests pass with new `WizardAnswers` shape
- `provisioner-providers.test.ts` created with at least 7 test cases
- `pnpm test:run` exits 0

---

## Acceptance criteria

- [ ] `config-generator.test.ts` has no references to `anthropicApiKey`
- [ ] All existing `generateConfig` tests still pass
- [ ] All existing `generateEnv` tests updated and passing
- [ ] New `generateConfig` tests for openai and opencode pass
- [ ] New `generateEnv` tests for openai and opencode pass
- [ ] `provisioner-providers.test.ts` exists with at least 7 test cases
- [ ] All provisioner tests pass (or are skipped with a clear comment if full mock is infeasible)
- [ ] `pnpm test:run` exits 0

---

## Validation

```bash
cd src/claw-pilot
pnpm test:run -- config-generator
pnpm test:run -- provisioner-providers
pnpm test:run   # full suite — must exit 0
```

---

## Notes

- Run `config-generator` tests first (they are simpler and have no mocking complexity).
- The provisioner tests are the most complex. If `MockConnection` lacks the necessary stubs,
  add them to `mock-connection.ts` as part of this task.
- Do not modify `mock-connection.ts` in a way that breaks existing tests.
- Test file uses vitest (`describe`, `it`, `expect`, `vi`) — consistent with the rest of the
  test suite. No jest imports.
