# Secret Provider

> Part of [claw-pilot Functional Architecture](README.md)

---

## Purpose

The `SecretProvider` is the **single read path** for infrastructure secrets
in claw-pilot. Every module that needs a master key, channel token, or
API credential goes through it — no direct `process.env.XXX` or
`fs.readFileSync('.env')` lookups anywhere else in the codebase.

In Community edition the single implementation, `EnvSecretProvider`, reads
from `process.env` and the global `~/.claw-pilot/.env` file — matching
the pre-H4 behaviour. The abstraction exists so the Enterprise fork can
drop in a `VaultProvider`, `AwsSecretsProvider`, or `AzureKeyVaultProvider`
**without touching any frozen-path source file** (discipline rule R3).

This mechanism is also the technical enforcement of **discipline rule R5**
(no direct secret access): every call site goes through `secretProvider`,
and the H9 lint rule `no-direct-secret-access` will forbid re-introducing
a raw `process.env` read.

## Module

`src/core/secrets/` — three files:

- `index.ts` — interface + singleton registration
- `providers/env.ts` — Community default (`EnvSecretProvider`)
- `snapshot.ts` — sync-readable bootstrap view
- `bootstrap.ts` — idempotent `bootstrapSecretProvider()`

## Contract

### Interface

```typescript
export interface SecretProvider {
  readonly kind: string;                            // "env" | "vault" | ...
  has(name: string): Promise<boolean>;
  get(name: string): Promise<string>;               // throws SecretNotFoundError
  set?(name: string, value: string): Promise<void>; // optional
  rotate?(name: string): Promise<void>;             // optional (Enterprise)
}
```

### Exports

| Symbol | Description |
|---|---|
| `SecretProvider` | Interface all implementations must satisfy |
| `secretProvider` | Singleton proxy — import this in consumer code |
| `registerSecretProvider(impl)` | Bootstrap setter — exactly one call per process |
| `getSecretProvider()` | Returns the live singleton (throws if not bootstrapped) |
| `isSecretProviderRegistered()` | Non-throwing check for tolerant callers |
| `SecretNotFoundError` | `ClawPilotError` with code `SECRET_NOT_FOUND` |
| `EnvSecretProvider` | Community default implementation |
| `bootstrapSecretProvider(stateDir?)` | Idempotent wiring — safe to call from every entry point |
| `buildSnapshot(provider)` | Frozen sync view for hot-path callers |

## Naming convention

All secret keys use **SCREAMING_SNAKE**, matching the historical `process.env`
conventions (so the env provider remains a transparent drop-in):

- **Global secrets** — `MASTER_ENCRYPTION_KEY`, `CLAW_RUNTIME_INTERNAL_TOKEN`,
  `CLAW_RUNTIME_WEB_TOKEN`
- **Per-instance secrets** — composite `<KIND>_TOKEN:<slug>` or
  `<KIND>_TOKEN_<SLUG_UPPER>`, e.g. `TELEGRAM_BOT_TOKEN:my-instance`,
  `CLAW_RUNTIME_WEB_TOKEN_MY_INSTANCE`

The `:` separator is accepted by Vault and AWS Secrets Manager; the
`_<SLUG_UPPER>` variant preserves backward compatibility with the
legacy per-instance env vars.

## Bootstrap

Every process entry point calls `bootstrapSecretProvider()` once — the
function is idempotent, so nested command invocations are safe:

- `src/commands/_context.ts::withContext()` — CLI commands
- `src/commands/dashboard.ts` — dashboard daemon
- `src/commands/runtime.ts::startForeground()` — runtime daemon

Enterprise swaps the default by registering a custom provider **before**
any of these entry points runs (from `src/index.ts` in the private repo):

```typescript
registerSecretProvider(new VaultProvider({ ... }));
// bootstrapSecretProvider() becomes a no-op from here on.
```

The gate in `registerSecretProvider()` rejects any non-env provider unless
`capabilities.has("vault-secrets")` returns `true` — the Community build
cannot silently delegate to a non-env backend.

## Capability gate

| Provider kind | Capability required | Notes |
|---|---|---|
| `env` (`EnvSecretProvider`) | none | always registerable |
| anything else | `vault-secrets` | Enterprise-only |

## SecretsSnapshot

Some hot-path callers (`src/lib/crypto.ts::encrypt()/decrypt()`) are
synchronous and run on every `named_api_keys` read/write. Making them
async would cascade through 3–4 layers of callers. Instead:

1. At bootstrap, `ensureMasterEncryptionKey()` resolves the master key
   via `secretProvider.has()`/`get()`/`set()` and mirrors it into
   `process.env.MASTER_ENCRYPTION_KEY`.
2. `encrypt()`/`decrypt()` read from `process.env` synchronously — the
   snapshot pattern preserves the legacy synchronous contract.

`buildSnapshot(provider)` exposes the same idea as a first-class object
for Enterprise to layer TTL-driven `refresh()` on top.

Per-instance secrets (Telegram bot token, web-chat token) stay lazy —
they are read in async contexts already.

## Consumer call sites

| File | Secret | Notes |
|---|---|---|
| `src/lib/crypto.ts::ensureMasterEncryptionKey()` | `MASTER_ENCRYPTION_KEY` | Async bootstrap; hot path (`encrypt`/`decrypt`) stays sync via `process.env` mirror |
| `src/lib/platform.ts::resolveInternalApiToken()` | `CLAW_RUNTIME_INTERNAL_TOKEN` | Dashboard↔runtime IPC; falls back to `internal-dev-<slug>` for local dev |
| `src/runtime/channel/telegram/channel.ts::resolveBotToken()` | `<botTokenEnvVar>` | Tolerates missing bootstrap (graceful degradation) |
| `src/runtime/engine/channel-factory.ts::resolveWebChatToken()` | `CLAW_RUNTIME_WEB_TOKEN[_<SLUG>]` | Lazy, async |
| `src/core/model-discovery/service.ts::_resolveCredentials()` | `PROVIDER_ENV_VARS[providerId]` | Fallback when no named API key is stored |

## Discipline

- **R1** — no `if (isEnterprise)` anywhere; the gate is `capabilities.has("vault-secrets")`.
- **R2** — no new DB tables introduced by this module.
- **R3** — `src/core/secrets/` is a frozen path; Enterprise extends by
  implementing `SecretProvider`, never by editing files under `src/core/`.
  Commits that touch frozen paths carry the trailer `Extension-Point: secret-provider`.
- **R4** — Enterprise consumers ride on this Community hook.
- **R5** — this module **is** R5 for the codebase. The H9 lint rule
  `no-direct-secret-access` will mechanically enforce "no `process.env`
  secret reads outside `src/core/secrets/providers/env.ts`".
