# H3 — ServerRegistry abstraction — Design

**Goal:** Introduce `ServerRegistry` as the sole entry point for "which server?" in Community, so Enterprise can plug a `FederatedServerRegistry` without touching frozen paths (R3).

**Base:** `develop` @ v0.80.6 (H1/H2/H5 merged).

**Brief:** `ai-docs/brief-h3-server-registry.md`.

## Decisions (validated with user)

1. **Two separate abstractions**: `ServerRegistry` (business entities) vs `ServerConnection` (transport). Kept intact.
2. **Minimal `ServerNode`**: `{ id, kind, hostname, connection }`. No `region`/`capabilities` slots (YAGNI — additive trivial later).
3. **`route(resource)`** in the API + unit test. Zero Community call-sites; exists as extension point.
4. **Singleton pattern** cloned from `src/core/capabilities.ts` (single-set-locked + proxy).
5. **Scope monolithique**: 6 prod call-sites of `new LocalConnection()`, 1 of `os.hostname()` outside `server/local.ts`, refactored in this PR.
6. **DB `servers` already populated** by `Registry.upsertLocalServer()` via `ServerRepository`. `SingleServerRegistry` **reads** that row; does NOT re-populate.
7. **Bootstrap order**: `openDb → Registry (upserts local server row) → registerServerRegistry(new SingleServerRegistry(db, new LocalConnection()))`. Registry accessor then available to all downstream consumers.

## Contract

```typescript
// src/server/registry.ts
export type ServerKind = "local" | "remote";

export interface ServerNode {
  id: string;                      // numeric id coerced to string ("1" in Community)
  kind: ServerKind;
  hostname: string;
  connection: ServerConnection;
}

export interface ResourceRef {
  kind: "instance" | "agent" | "session";
  id: string;
  orgId?: string;                  // R2 slot for Enterprise; unused in Community
}

export interface ServerRegistry {
  list(): readonly ServerNode[];
  get(id: string): ServerNode | null;
  getLocal(): ServerNode;
  route(resource: ResourceRef): ServerNode;
}

export function registerServerRegistry(impl: ServerRegistry): void; // single-set-locked
export function resetServerRegistry(): void;                         // tests only
export function getServerRegistry(): ServerRegistry;
export const serverRegistry: ServerRegistry;                          // proxy
```

`list`/`get`/`route` are **synchronous** (identical in spirit to `capabilities`). The DB read happens once at bootstrap; after that the `ServerNode` is cached in memory.

## Default impl — `SingleServerRegistry`

- Constructor: `(db: Database.Database, conn: ServerConnection)`
- At construction: reads row `servers` id=1 via `ServerRepository.getLocalServer()`; throws `ClawPilotError("SERVER_REGISTRY_NOT_BOOTSTRAPPED")` if absent (means `Registry` bootstrap didn't run first — misuse).
- Builds a single `ServerNode { id: "1", kind: "local", hostname, connection }`.
- `getLocal()` / `list()` return this cached node; `get("1")` → node, else `null`; `route()` always → local.

## Capability gate

`registerServerRegistry()` enforces **R1**:
- If `capabilities.has("multi-server") === false` and caller tries to register a non-`SingleServerRegistry` instance → throw `ClawPilotError("MULTI_SERVER_CAPABILITY_REQUIRED")`.
- Mechanism: tag `SingleServerRegistry` with a private brand; the gate checks the brand. Enterprise enables the capability first, then registers its federated impl.

## Refactor scope

| File | Change |
|---|---|
| `src/commands/_context.ts` | Bootstrap `registerServerRegistry` after `Registry` construction; `conn` in `CommandContext` now sourced from `serverRegistry.getLocal().connection`. |
| `src/commands/update.ts`, `dashboard.ts`, `init.ts` | Replace `new LocalConnection()` with `serverRegistry.getLocal().connection`. |
| `src/runtime/plugin/system-tools/tools.ts:939` | Same replacement. |
| `src/server/local.ts` | Unchanged (legitimate `os.hostname()` inside transport impl). |
| Tests | Update fixtures to call `resetServerRegistry()` in `beforeEach`; bootstrap a `SingleServerRegistry` on the test DB. Shared helper in `src/server/__tests__/_helpers/with-registry.ts`. |

## Deliverables

- `src/server/registry.ts` — contract + `SingleServerRegistry` + singleton.
- `src/server/__tests__/registry.test.ts` — contract + gate + route() returns local.
- `src/server/__tests__/_helpers/with-registry.ts` — test bootstrap helper.
- Refactored 6 prod call-sites + impacted tests.
- `docs/architecture/server-registry.md` — pattern doc (mirror `capability-registry.md`).
- Link from `docs/architecture/README.md`.
- CHANGELOG `[Unreleased] ### Added` entry.
- Commit trailer `Extension-Point: server-registry` on every commit touching frozen paths.

## Out of scope

Federated impl, heartbeat, SSH transport, consensus, UI, Organizations/Teams, migrations.

## Completion gates

`pnpm typecheck:all && pnpm lint:all && pnpm spellcheck && pnpm test:run --coverage && pnpm test:e2e && pnpm knip --reporter compact && pnpm check:circular && pnpm build` — all green.

Acceptance greps:
- `grep -rn "new LocalConnection" src/` returns only `registry.ts` bootstrap + `server/__tests__/local.test.ts` + registry test helper.
- `grep -rn "os\.hostname\|process\.env\.HOSTNAME" src/` returns only `server/local.ts` + its test.
