# H3 — ServerRegistry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Deliver `ServerRegistry` abstraction + `SingleServerRegistry` default impl + refactor 6 prod call-sites.

**Architecture:** Singleton registry cloned from `src/core/capabilities.ts`. Wraps existing `ServerConnection` + DB row `servers` id=1 (already populated by `Registry.upsertLocalServer`). Exposes `getLocal/list/get/route`.

**Tech Stack:** TS ESM NodeNext, vitest, better-sqlite3, Hono dashboard unchanged.

**Spec:** `docs/superpowers/specs/2026-04-21-h3-server-registry-design.md`.

**Discipline:** R1 (capability gate on register), R3 (Extension-Point: server-registry trailer on all commits touching `src/server/*`, `src/commands/*`, `src/runtime/*`).

---

## Task 1 — Contract + types

**Files:**
- Create: `src/server/registry.ts`
- Create: `src/server/__tests__/registry.test.ts`

Define the interfaces (`ServerKind`, `ServerNode`, `ResourceRef`, `ServerRegistry`) and the singleton accessors (`registerServerRegistry`, `resetServerRegistry`, `getServerRegistry`, `serverRegistry` proxy). No impl yet — just shape.

- [ ] **Step 1 — Write failing test** for singleton semantics:

```typescript
// src/server/__tests__/registry.test.ts
import { afterEach, describe, expect, it } from "vitest";
import {
  registerServerRegistry,
  resetServerRegistry,
  getServerRegistry,
  serverRegistry,
  type ServerRegistry,
  type ServerNode,
} from "../registry.js";

const fakeNode: ServerNode = {
  id: "1",
  kind: "local",
  hostname: "test-host",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connection: {} as any,
};

const fakeImpl: ServerRegistry = {
  list: () => [fakeNode],
  get: (id) => (id === "1" ? fakeNode : null),
  getLocal: () => fakeNode,
  route: () => fakeNode,
};

describe("serverRegistry singleton", () => {
  afterEach(() => resetServerRegistry());

  it("throws before bootstrap", () => {
    expect(() => getServerRegistry()).toThrow(/not.*registered/i);
  });

  it("locks after first registration", () => {
    registerServerRegistry(fakeImpl);
    expect(getServerRegistry().getLocal().hostname).toBe("test-host");
    expect(() => registerServerRegistry(fakeImpl)).toThrow(/locked/i);
  });

  it("proxy delegates to registered impl", () => {
    registerServerRegistry(fakeImpl);
    expect(serverRegistry.getLocal()).toBe(fakeNode);
    expect(serverRegistry.route({ kind: "instance", id: "foo" })).toBe(fakeNode);
  });
});
```

- [ ] **Step 2 — Run test, verify fail** (`pnpm vitest run src/server/__tests__/registry.test.ts`): expect module-not-found.

- [ ] **Step 3 — Implement** `src/server/registry.ts` mirroring `src/core/capabilities.ts`:

```typescript
// src/server/registry.ts
import { ClawPilotError } from "../lib/errors.js";
import type { ServerConnection } from "./connection.js";

export type ServerKind = "local" | "remote";

export interface ServerNode {
  id: string;
  kind: ServerKind;
  hostname: string;
  connection: ServerConnection;
}

export interface ResourceRef {
  kind: "instance" | "agent" | "session";
  id: string;
  orgId?: string;
}

export interface ServerRegistry {
  list(): readonly ServerNode[];
  get(id: string): ServerNode | null;
  getLocal(): ServerNode;
  route(resource: ResourceRef): ServerNode;
}

let current: ServerRegistry | null = null;
let locked = false;

export function registerServerRegistry(impl: ServerRegistry): void {
  if (locked) {
    throw new ClawPilotError(
      "ServerRegistry already locked — registerServerRegistry() must be called exactly once during bootstrap",
      "SERVER_REGISTRY_LOCKED",
    );
  }
  current = impl;
  locked = true;
}

/** Test-only: reset the singleton between tests. Never called in prod. */
export function resetServerRegistry(): void {
  current = null;
  locked = false;
}

export function getServerRegistry(): ServerRegistry {
  if (!current) {
    throw new ClawPilotError(
      "ServerRegistry not registered — call registerServerRegistry() during bootstrap",
      "SERVER_REGISTRY_NOT_REGISTERED",
    );
  }
  return current;
}

export const serverRegistry: ServerRegistry = {
  list: () => getServerRegistry().list(),
  get: (id) => getServerRegistry().get(id),
  getLocal: () => getServerRegistry().getLocal(),
  route: (r) => getServerRegistry().route(r),
};
```

- [ ] **Step 4 — Run test, verify pass.**

- [ ] **Step 5 — Commit**

```bash
git add src/server/registry.ts src/server/__tests__/registry.test.ts
git commit -m "feat(server): add ServerRegistry contract + singleton accessors (H3)

Extension-Point: server-registry"
```

---

## Task 2 — `SingleServerRegistry` default impl + capability gate

**Files:**
- Modify: `src/server/registry.ts`
- Modify: `src/server/__tests__/registry.test.ts`

- [ ] **Step 1 — Extend test** with `SingleServerRegistry` behavior and the capability gate:

```typescript
// append to src/server/__tests__/registry.test.ts
import Database from "better-sqlite3";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../../core/registry.js";
import { LocalConnection } from "../local.js";
import { SingleServerRegistry } from "../registry.js";

function makeDb() {
  const db = initDatabase(":memory:");
  new Registry(db).upsertLocalServer("testhost", "/tmp/home");
  return db;
}

describe("SingleServerRegistry", () => {
  afterEach(() => resetServerRegistry());

  it("reads local server row from DB at construction", () => {
    const db = makeDb();
    const reg = new SingleServerRegistry(db, new LocalConnection());
    const local = reg.getLocal();
    expect(local.kind).toBe("local");
    expect(local.hostname).toBe("testhost");
    expect(local.id).toBe("1");
  });

  it("throws if servers row absent", () => {
    const db = initDatabase(":memory:");
    expect(() => new SingleServerRegistry(db, new LocalConnection())).toThrow(
      /SERVER_REGISTRY_NOT_BOOTSTRAPPED/,
    );
  });

  it("list/get/route behavior", () => {
    const db = makeDb();
    const reg = new SingleServerRegistry(db, new LocalConnection());
    expect(reg.list()).toHaveLength(1);
    expect(reg.get("1")).not.toBeNull();
    expect(reg.get("999")).toBeNull();
    expect(reg.route({ kind: "instance", id: "any" }).kind).toBe("local");
  });

  it("allows SingleServerRegistry without capability", () => {
    const db = makeDb();
    expect(() =>
      registerServerRegistry(new SingleServerRegistry(db, new LocalConnection())),
    ).not.toThrow();
  });

  it("rejects foreign impl without multi-server capability", () => {
    const foreign: ServerRegistry = { list: () => [], get: () => null, getLocal: () => fakeNode, route: () => fakeNode };
    expect(() => registerServerRegistry(foreign)).toThrow(/MULTI_SERVER_CAPABILITY_REQUIRED/);
  });
});
```

- [ ] **Step 2 — Run tests, verify fail.**

- [ ] **Step 3 — Implement** `SingleServerRegistry` in `src/server/registry.ts`:

```typescript
import type Database from "better-sqlite3";
import { capabilities } from "../core/capabilities.js";
import { ServerRepository } from "../core/repositories/server-repository.js";

const SINGLE_BRAND = Symbol("single-server-registry");

export class SingleServerRegistry implements ServerRegistry {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private readonly [SINGLE_BRAND] = true;
  private readonly node: ServerNode;

  constructor(db: Database.Database, connection: ServerConnection) {
    const row = new ServerRepository(db).getLocalServer();
    if (!row) {
      throw new ClawPilotError(
        "ServerRegistry requires a local server row — run Registry.upsertLocalServer() first",
        "SERVER_REGISTRY_NOT_BOOTSTRAPPED",
      );
    }
    this.node = { id: String(row.id), kind: "local", hostname: row.hostname, connection };
  }

  list(): readonly ServerNode[] { return [this.node]; }
  get(id: string): ServerNode | null { return id === this.node.id ? this.node : null; }
  getLocal(): ServerNode { return this.node; }
  route(_resource: ResourceRef): ServerNode { return this.node; }
}

function isSingle(impl: ServerRegistry): boolean {
  return (impl as unknown as Record<symbol, unknown>)[SINGLE_BRAND] === true;
}
```

Update `registerServerRegistry` to enforce the gate:

```typescript
export function registerServerRegistry(impl: ServerRegistry): void {
  if (locked) { /* existing */ }
  if (!isSingle(impl) && !capabilities.has("multi-server")) {
    throw new ClawPilotError(
      "Non-single ServerRegistry requires the 'multi-server' capability",
      "MULTI_SERVER_CAPABILITY_REQUIRED",
    );
  }
  current = impl;
  locked = true;
}
```

Check `ServerRecord` field — the repo SELECT aliases `openclaw_home AS home_dir` but DB id is INTEGER. Coerce with `String(row.id)`. If the row comes from `getLocalServer()` where id is not selected, add `id` to the SELECT in the repo (additive-only, non-breaking) — but **only if needed**. Verify first.

- [ ] **Step 4 — Verify the SELECT returns `id`**: read `src/core/repositories/server-repository.ts` — the current SELECT is `SELECT id, hostname, ip, openclaw_home AS home_dir`. ✅ `id` is present.

- [ ] **Step 5 — Run tests, verify pass.**

- [ ] **Step 6 — Commit**

```bash
git add src/server/registry.ts src/server/__tests__/registry.test.ts
git commit -m "feat(server): add SingleServerRegistry + capability gate (H3)

Extension-Point: server-registry"
```

---

## Task 3 — Bootstrap in `withContext()` and dashboard

**Files:**
- Modify: `src/commands/_context.ts`
- Create: `src/server/__tests__/_helpers/with-registry.ts`
- Modify: `src/commands/__tests__/context-and-commands.test.ts`

`withContext()` already builds `db`, `registry`, `conn`. Insert `registerServerRegistry(new SingleServerRegistry(db, conn))` right after `registry` is built (so the local row is already upserted). Because the singleton is process-global and `withContext()` may be called multiple times in tests, wrap the register call to check `locked` and no-op on second call. Cleaner: expose a helper `bootstrapServerRegistry(db, conn)` in `src/server/registry.ts` that does `if (!locked) registerServerRegistry(...)`.

Add to `registry.ts`:

```typescript
export function bootstrapServerRegistry(db: Database.Database, conn: ServerConnection): void {
  if (locked) return;
  registerServerRegistry(new SingleServerRegistry(db, conn));
}
```

- [ ] **Step 1 — Update `_context.ts`**

```typescript
// src/commands/_context.ts
import { initDatabase } from "../db/schema.js";
import { Registry } from "../core/registry.js";
import { LocalConnection } from "../server/local.js";
import { bootstrapServerRegistry, serverRegistry } from "../server/registry.js";
import { resolveXdgRuntimeDir } from "../lib/xdg.js";
import { getDbPath } from "../lib/platform.js";
import type { Database } from "better-sqlite3";
import type { ServerConnection } from "../server/connection.js";

export interface CommandContext {
  db: Database;
  registry: Registry;
  conn: ServerConnection;   // now broadened from LocalConnection
  xdgRuntimeDir: string;
}

export async function withContext<T>(fn: (ctx: CommandContext) => Promise<T>): Promise<T> {
  const db = initDatabase(getDbPath());
  try {
    const registry = new Registry(db);
    const conn = new LocalConnection();
    bootstrapServerRegistry(db, conn);
    const xdgRuntimeDir = await resolveXdgRuntimeDir(serverRegistry.getLocal().connection);
    return await fn({ db, registry, conn: serverRegistry.getLocal().connection, xdgRuntimeDir });
  } finally {
    db.close();
  }
}
```

- [ ] **Step 2 — Create test helper** `src/server/__tests__/_helpers/with-registry.ts`:

```typescript
import type Database from "better-sqlite3";
import { Registry } from "../../../core/registry.js";
import { LocalConnection } from "../../local.js";
import { resetServerRegistry, bootstrapServerRegistry } from "../../registry.js";

/** Test helper: upsert a local server row and bootstrap the registry. */
export function bootstrapTestRegistry(db: Database.Database, hostname = "localhost", home = "/tmp") {
  new Registry(db).upsertLocalServer(hostname, home);
  resetServerRegistry();
  bootstrapServerRegistry(db, new LocalConnection());
}

export { resetServerRegistry };
```

- [ ] **Step 3 — Run existing command tests** — fix any broken ones. `context-and-commands.test.ts` may need a `resetServerRegistry()` in `beforeEach`.

- [ ] **Step 4 — Commit**

```bash
git add src/commands/_context.ts src/server/registry.ts src/server/__tests__/_helpers/with-registry.ts src/commands/__tests__/context-and-commands.test.ts
git commit -m "feat(server): bootstrap ServerRegistry from withContext() (H3)

Extension-Point: server-registry"
```

---

## Task 4 — Refactor remaining `new LocalConnection()` call-sites

**Files:**
- Modify: `src/commands/update.ts:66`
- Modify: `src/commands/dashboard.ts:24`
- Modify: `src/commands/init.ts:115`
- Modify: `src/runtime/plugin/system-tools/tools.ts:939`

Each site currently does `const conn = new LocalConnection();` standalone (outside `withContext`). Replace by `const conn = serverRegistry.getLocal().connection;`. If the file does not yet have the registry bootstrapped (i.e., runs before `withContext`), wrap the registry construction on demand.

**Audit first**: for each of the 4 files, check whether the code runs inside a `withContext` callback. If yes → just use `serverRegistry.getLocal().connection`. If no (e.g., `init.ts` creates the DB before any context) → keep `new LocalConnection()` but add a `// legitimate: runs before registry bootstrap` comment.

- [ ] **Step 1 — Audit each file**: read surrounding context and classify (inside vs outside withContext).
- [ ] **Step 2 — Apply refactor** to those inside withContext.
- [ ] **Step 3 — Update tests**: replace raw `new LocalConnection()` in tests with `bootstrapTestRegistry(db)` + `serverRegistry.getLocal().connection`.
- [ ] **Step 4 — Run tests**: `pnpm vitest run src/commands src/runtime/plugin/system-tools`.
- [ ] **Step 5 — Commit**

```bash
git commit -m "refactor(server): route LocalConnection through serverRegistry (H3)

Extension-Point: server-registry"
```

---

## Task 5 — Docs + CHANGELOG

**Files:**
- Create: `docs/architecture/server-registry.md`
- Modify: `docs/architecture/README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1** — Write `docs/architecture/server-registry.md` mirroring `docs/architecture/capability-registry.md`: purpose, contract, default impl, Enterprise consumption, gate, file locations.
- [ ] **Step 2** — Add index line in `docs/architecture/README.md`.
- [ ] **Step 3** — Add `## [Unreleased] → ### Added` entry pointing to the plan.
- [ ] **Step 4 — Commit**

```bash
git commit -m "docs(server): document ServerRegistry architecture (H3)"
```

---

## Task 6 — Final gates + rebase + PR

- [ ] `pnpm typecheck:all && pnpm lint:all && pnpm spellcheck && pnpm test:run --coverage && pnpm test:e2e && pnpm knip --reporter compact && pnpm check:circular && pnpm build`
- [ ] `git fetch origin && git rebase origin/develop`
- [ ] Re-run `pnpm test:run` after rebase.
- [ ] `git push -u origin feature/server-registry`
- [ ] `gh pr create --base develop --title "feat(server): introduce ServerRegistry abstraction (H3)" --body "..."`
- [ ] Report PR number to user; stop.
