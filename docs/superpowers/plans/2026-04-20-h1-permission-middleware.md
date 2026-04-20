# H1 — Permission Middleware Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the H1 extension point — a pluggable permission checker behind a Hono middleware factory — so Enterprise can later register a `FineGrainedRBACChecker` without modifying any dashboard route file. Community ships a `NullPermissionChecker` (always allow) because Community is mono-user admin by design.

**Architecture:** New module `src/dashboard/middleware/permission.ts` exports `PermissionChecker`, `PermissionContext`, `PermissionDecision`, a `registerPermissionChecker()` registration seam, and a `permission(spec)` middleware factory. A companion `permission-actions.ts` exports an `ACTIONS` const (ergonomic catalogue of Community actions). The auth middleware in `src/dashboard/server.ts` is enriched to publish an `AuthenticatedUser` (with `source: "session" | "bearer"`) on the Hono context. Every mutation route and sensitive read route is annotated with `permission({ action, resource })`.

**Tech Stack:** TypeScript, Hono (router), Vitest, better-sqlite3 (for `users` table), ESM NodeNext, oxlint, lefthook pre-commit hooks.

**Reference:** [2026-04-20-h1-permission-middleware-design.md](../specs/2026-04-20-h1-permission-middleware-design.md)

**Discipline:** Every commit touching `src/dashboard/server.ts` or `src/dashboard/routes/**` MUST carry the `Extension-Point: permission-middleware` trailer (rule R3).

---

## File Structure

**New files:**
- `src/dashboard/middleware/permission.ts` — core contract, registration, middleware factory
- `src/dashboard/middleware/permission-actions.ts` — `ACTIONS` const catalogue + convention docstring
- `src/dashboard/middleware/__tests__/permission.test.ts` — contract tests (registration, null behaviour, dispatch)
- `src/dashboard/middleware/__tests__/permission-middleware.test.ts` — middleware factory tests (happy path, 403, context shape)
- `src/dashboard/__tests__/auth-context.test.ts` — auth middleware publishes `user` on context (session + bearer paths)
- `docs/architecture/permission-middleware.md` — public architecture doc

**Modified files:**
- `src/dashboard/server.ts` — enrich auth middleware to publish `AuthenticatedUser` on context
- All ~40 files under `src/dashboard/routes/**` — add `permission()` middleware per route
- `CHANGELOG.md` — add entry under Unreleased

---

## Pre-flight

- [ ] **Step 0.1: Confirm branch and clean state**

Run:
```bash
git status --short
git branch --show-current
```
Expected: clean working tree, branch `feature/permission-middleware-dashboard`, at commit `4826c34` or later (spec commits).

- [ ] **Step 0.2: Baseline the test suite**

Run: `pnpm test:run`
Record the passing-test count at the bottom of the output. Every subsequent task must leave this count unchanged or greater.

- [ ] **Step 0.3: Baseline the typecheck + lint**

Run: `pnpm typecheck:all && pnpm lint:all`
Expected: both exit 0. If not, fix before proceeding — you need a clean baseline.

---

## Task 1: Core permission module (types + registration + NullPermissionChecker)

**Files:**
- Create: `src/dashboard/middleware/permission.ts`
- Test: `src/dashboard/middleware/__tests__/permission.test.ts`

- [ ] **Step 1.1: Write the failing test**

Create `src/dashboard/middleware/__tests__/permission.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from "vitest";
import {
  registerPermissionChecker,
  resetPermissionChecker,
  getPermissionChecker,
  type PermissionChecker,
  type PermissionContext,
} from "../permission.js";

describe("permission checker registry", () => {
  beforeEach(() => {
    resetPermissionChecker();
  });

  it("defaults to NullPermissionChecker that allows everything", async () => {
    const ctx: PermissionContext = {
      user: { id: "u1", username: "alice", role: "admin", source: "session" },
      action: "agent.create",
      resource: { kind: "agent" },
    };
    const decision = await getPermissionChecker().check(ctx);
    expect(decision).toEqual({ allow: true });
  });

  it("dispatches to the registered checker", async () => {
    const calls: PermissionContext[] = [];
    const checker: PermissionChecker = {
      async check(ctx) {
        calls.push(ctx);
        return { allow: false, reason: "nope" };
      },
    };
    registerPermissionChecker(checker);
    const ctx: PermissionContext = {
      user: { id: "u1", username: "alice", role: "admin", source: "session" },
      action: "agent.delete",
      resource: { kind: "agent", id: "a42" },
    };
    const decision = await getPermissionChecker().check(ctx);
    expect(decision).toEqual({ allow: false, reason: "nope" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(ctx);
  });

  it("throws on double registration", () => {
    const checker: PermissionChecker = {
      async check() {
        return { allow: true };
      },
    };
    registerPermissionChecker(checker);
    expect(() => registerPermissionChecker(checker)).toThrow(/already registered/i);
  });

  it("resetPermissionChecker restores NullPermissionChecker", async () => {
    registerPermissionChecker({
      async check() {
        return { allow: false, reason: "x" };
      },
    });
    resetPermissionChecker();
    const decision = await getPermissionChecker().check({
      user: { id: "u1", username: "alice", role: "admin", source: "session" },
      action: "x",
      resource: { kind: "y" },
    });
    expect(decision).toEqual({ allow: true });
  });
});
```

- [ ] **Step 1.2: Run the test to verify failure**

Run: `pnpm vitest run src/dashboard/middleware/__tests__/permission.test.ts`
Expected: FAIL with "Cannot find module '../permission.js'".

- [ ] **Step 1.3: Implement the module**

Create `src/dashboard/middleware/permission.ts`:

```typescript
// src/dashboard/middleware/permission.ts
//
// H1 extension point — pluggable permission checker for dashboard routes.
//
// Community ships NullPermissionChecker (always allow) because Community is
// mono-user admin by design. Enterprise registers a FineGrainedRBACChecker
// via registerPermissionChecker() without modifying any route file.
//
// Note: this module is orthogonal to src/runtime/permission/* which handles
// tool-call permissions persisted in the rt_permissions table. Do not merge
// the two concerns.

import { ClawPilotError } from "../../lib/errors.js";

export interface AuthenticatedUser {
  id: string;
  username: string;
  /** "admin" | "operator" | "viewer" — schema slot, Community is always admin. */
  role: string;
  /** How the request authenticated. */
  source: "session" | "bearer";
}

export interface PermissionContext {
  user: AuthenticatedUser;
  /** Dotted action identifier, e.g. "agent.create", "named-key.read". */
  action: string;
  resource: {
    kind: string;
    id?: string;
    orgId?: string;
  };
  attributes?: Record<string, unknown>;
}

export type PermissionDecision =
  | { allow: true }
  | { allow: false; reason: string; requiresApproval?: boolean };

export interface PermissionChecker {
  check(ctx: PermissionContext): Promise<PermissionDecision>;
}

class NullPermissionChecker implements PermissionChecker {
  async check(_ctx: PermissionContext): Promise<PermissionDecision> {
    return { allow: true };
  }
}

const DEFAULT: PermissionChecker = new NullPermissionChecker();
let current: PermissionChecker = DEFAULT;
let registered = false;

/**
 * Replace the default checker. Called exactly once at bootstrap by editions
 * that ship a non-null checker (e.g. Enterprise). A second call throws a
 * ClawPilotError with code "PERMISSION_CHECKER_ALREADY_REGISTERED".
 */
export function registerPermissionChecker(checker: PermissionChecker): void {
  if (registered) {
    throw new ClawPilotError(
      "PermissionChecker already registered",
      "PERMISSION_CHECKER_ALREADY_REGISTERED",
    );
  }
  current = checker;
  registered = true;
}

/** Test helper — clears registration and restores NullPermissionChecker. */
export function resetPermissionChecker(): void {
  current = DEFAULT;
  registered = false;
}

/** Access the current checker. Route middleware calls this on every request. */
export function getPermissionChecker(): PermissionChecker {
  return current;
}
```

- [ ] **Step 1.4: Run the test to verify pass**

Run: `pnpm vitest run src/dashboard/middleware/__tests__/permission.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 1.5: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: exit 0.

- [ ] **Step 1.6: Commit**

```bash
git add src/dashboard/middleware/permission.ts src/dashboard/middleware/__tests__/permission.test.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): add PermissionChecker extension point (H1)

Ship the contract + registration seam + NullPermissionChecker default.
Community stays mono-user admin; Enterprise will register its own
checker via registerPermissionChecker().

Extension-Point: permission-middleware
EOF
)"
```

---

## Task 2: ACTIONS const catalogue

**Files:**
- Create: `src/dashboard/middleware/permission-actions.ts`

No dedicated test file — the ACTIONS const is data, imported by route files and exercised through their tests.

- [ ] **Step 2.1: Create the file**

Create `src/dashboard/middleware/permission-actions.ts`:

```typescript
// src/dashboard/middleware/permission-actions.ts
//
// Catalogue of action identifiers that Community route modules pass to the
// permission middleware. Convention: "<resource-kind>.<verb>", lowercase,
// dot-separated, singular resource name.
//
// The `action` field of PermissionContext is typed as plain `string` — this
// const is purely an ergonomic catalogue; Enterprise may register its own
// actions without depending on this file (preserves R3 byte-identity on
// frozen paths).

export const ACTIONS = {
  // auth
  AUTH_LOGIN: "auth.login",
  AUTH_LOGOUT: "auth.logout",
  AUTH_ME: "auth.me",

  // profile
  PROFILE_READ: "profile.read",
  PROFILE_UPDATE: "profile.update",

  // named keys (sensitive: even reads are annotated)
  NAMED_KEY_READ: "named-key.read",
  NAMED_KEY_CREATE: "named-key.create",
  NAMED_KEY_UPDATE: "named-key.update",
  NAMED_KEY_DELETE: "named-key.delete",

  // system
  SYSTEM_HEALTH: "system.health",
  SYSTEM_UPDATE_STATUS: "system.update-status",
  SYSTEM_UPDATE_APPLY: "system.update-apply",

  // system instance
  SYSTEM_INSTANCE_STATUS: "system-instance.status",
  SYSTEM_INSTANCE_ENSURE: "system-instance.ensure",
  SYSTEM_INSTANCE_QUERY: "system-instance.query",
  SYSTEM_INSTANCE_READY: "system-instance.ready",

  // notifications
  NOTIFICATION_LIST: "notification.list",
  NOTIFICATION_UNREAD_COUNT: "notification.unread-count",
  NOTIFICATION_MARK_READ: "notification.mark-read",
  NOTIFICATION_MARK_ALL_READ: "notification.mark-all-read",

  // search
  SEARCH_QUERY: "search.query",

  // teams
  TEAM_EXPORT: "team.export",
  TEAM_IMPORT: "team.import",

  // agent blueprints
  AGENT_BLUEPRINT_LIST: "agent-blueprint.list",
  AGENT_BLUEPRINT_READ: "agent-blueprint.read",
  AGENT_BLUEPRINT_CREATE: "agent-blueprint.create",
  AGENT_BLUEPRINT_UPDATE: "agent-blueprint.update",
  AGENT_BLUEPRINT_DELETE: "agent-blueprint.delete",
  AGENT_BLUEPRINT_CLONE: "agent-blueprint.clone",
  AGENT_BLUEPRINT_FILE_READ: "agent-blueprint.file-read",
  AGENT_BLUEPRINT_FILE_UPDATE: "agent-blueprint.file-update",
  AGENT_BLUEPRINT_FILE_DELETE: "agent-blueprint.file-delete",
  AGENT_BLUEPRINT_FROM_AGENT: "agent-blueprint.from-agent",
  AGENT_BLUEPRINT_EXPORT: "agent-blueprint.export",
  AGENT_BLUEPRINT_IMPORT: "agent-blueprint.import",

  // blueprints (team templates)
  BLUEPRINT_LIST: "blueprint.list",
  BLUEPRINT_READ: "blueprint.read",
  BLUEPRINT_CREATE: "blueprint.create",
  BLUEPRINT_UPDATE: "blueprint.update",
  BLUEPRINT_DELETE: "blueprint.delete",
  BLUEPRINT_IMPORT_BUILTIN: "blueprint.import-builtin",
  BLUEPRINT_BUILDER_READ: "blueprint.builder-read",
  BLUEPRINT_AGENT_CREATE: "blueprint.agent-create",
  BLUEPRINT_AGENT_UPDATE: "blueprint.agent-update",
  BLUEPRINT_AGENT_DELETE: "blueprint.agent-delete",
  BLUEPRINT_AGENT_FILE_READ: "blueprint.agent-file-read",
  BLUEPRINT_AGENT_FILE_UPDATE: "blueprint.agent-file-update",

  // instances
  INSTANCE_LIST: "instance.list",
  INSTANCE_READ: "instance.read",
  INSTANCE_CREATE: "instance.create",
  INSTANCE_DELETE: "instance.delete",
  INSTANCE_START: "instance.start",
  INSTANCE_STOP: "instance.stop",
  INSTANCE_RESTART: "instance.restart",
  INSTANCE_HEALTH: "instance.health",
  INSTANCE_NEXT_PORT: "instance.next-port",
  INSTANCE_CONVERSATIONS_READ: "instance.conversations-read",
  INSTANCE_CONFIG_READ: "instance.config-read",
  INSTANCE_CONFIG_UPDATE: "instance.config-update",
  INSTANCE_CONFIG_TELEGRAM_TOKEN_UPDATE: "instance.config-telegram-token-update",

  // providers (listed under instances per URL)
  PROVIDER_LIST: "provider.list",

  // discover
  INSTANCE_DISCOVER: "instance.discover",
  INSTANCE_DISCOVER_ADOPT: "instance.discover-adopt",

  // mcp
  INSTANCE_MCP_TOOLS_READ: "instance.mcp-tools-read",
  INSTANCE_MCP_STATUS: "instance.mcp-status",

  // telegram
  INSTANCE_TELEGRAM_PAIRING_READ: "instance.telegram-pairing-read",
  INSTANCE_TELEGRAM_PAIRING_APPROVE: "instance.telegram-pairing-approve",
  INSTANCE_TELEGRAM_PAIRING_DELETE: "instance.telegram-pairing-delete",

  // budgets
  INSTANCE_BUDGET_LIST: "instance.budget-list",
  INSTANCE_BUDGET_CREATE: "instance.budget-create",
  INSTANCE_BUDGET_UPDATE: "instance.budget-update",
  INSTANCE_BUDGET_DELETE: "instance.budget-delete",
  INSTANCE_BUDGET_OVERRIDE: "instance.budget-override",
  INSTANCE_BUDGET_EVENTS_READ: "instance.budget-events-read",
  INSTANCE_BUDGET_RECONCILE: "instance.budget-reconcile",

  // runtime permissions (tool-call permission rules — orthogonal to route perms)
  INSTANCE_RUNTIME_PERMISSION_LIST: "instance.runtime-permission-list",
  INSTANCE_RUNTIME_PERMISSION_DELETE: "instance.runtime-permission-delete",
  INSTANCE_RUNTIME_PERMISSION_REPLY: "instance.runtime-permission-reply",

  // costs
  INSTANCE_COSTS_SUMMARY: "instance.costs-summary",
  INSTANCE_COSTS_DAILY: "instance.costs-daily",
  INSTANCE_COSTS_BY_AGENT: "instance.costs-by-agent",
  INSTANCE_COSTS_BY_MODEL: "instance.costs-by-model",

  // agents
  AGENT_LIST: "agent.list",
  AGENT_BUILDER_READ: "agent.builder-read",
  AGENT_CREATE: "agent.create",
  AGENT_FROM_TEMPLATE: "agent.from-template",
  AGENT_UPDATE_META: "agent.update-meta",
  AGENT_UPDATE_POSITION: "agent.update-position",
  AGENT_UPDATE_SPAWN_LINKS: "agent.update-spawn-links",
  AGENT_SYNC: "agent.sync",
  AGENT_DELETE: "agent.delete",
  AGENT_KICKOFF: "agent.kickoff",
  AGENT_FILES_READ: "agent.files-read",
  AGENT_FILE_READ: "agent.file-read",
  AGENT_FILE_UPDATE: "agent.file-update",
  AGENT_FILE_DELETE: "agent.file-delete",

  // skills
  SKILL_LIST: "skill.list",
  SKILL_UPLOAD: "skill.upload",
  SKILL_INSTALL: "skill.install",
  SKILL_DELETE: "skill.delete",

  // flows
  FLOW_LIST: "flow.list",
  FLOW_READ: "flow.read",
  FLOW_CREATE: "flow.create",
  FLOW_UPDATE: "flow.update",
  FLOW_DELETE: "flow.delete",
  FLOW_RUN: "flow.run",
  FLOW_RUNS_LIST: "flow.runs-list",
  FLOW_RUN_READ: "flow.run-read",
  FLOW_RUN_CANCEL: "flow.run-cancel",
  FLOW_SESSIONS_LIST: "flow.sessions-list",

  // tasks
  TASK_LIST: "task.list",
  TASK_COUNTS: "task.counts",
  TASK_READ: "task.read",
  TASK_CREATE: "task.create",
  TASK_UPDATE: "task.update",
  TASK_DELETE: "task.delete",
  TASK_STATUS: "task.status",
  TASK_REORDER: "task.reorder",
  TASK_COMMENT: "task.comment",
  TASK_TIMELINE_READ: "task.timeline-read",
  EPIC_LIST: "epic.list",
  EPIC_CHILDREN: "epic.children",

  // shared files
  SHARED_FILES_LIST: "shared-files.list",
  SHARED_FILE_READ: "shared-files.read",
  SHARED_FILE_UPDATE: "shared-files.update",
  SHARED_FILE_DELETE: "shared-files.delete",

  // workspace
  WORKSPACE_DOWNLOAD: "workspace.download",

  // memory
  MEMORY_AGENTS_LIST: "memory.agents-list",
  MEMORY_AGENT_FILES_LIST: "memory.agent-files-list",
  MEMORY_AGENT_FILE_READ: "memory.agent-file-read",
  MEMORY_SEARCH: "memory.search",

  // heartbeat
  HEARTBEAT_SCHEDULE_READ: "heartbeat.schedule-read",
  HEARTBEAT_HEATMAP_READ: "heartbeat.heatmap-read",
  HEARTBEAT_HISTORY_READ: "heartbeat.history-read",

  // events
  EVENT_LIST: "event.list",
  EVENT_STREAM: "event.stream",

  // runtime
  RUNTIME_STATUS: "runtime.status",
  RUNTIME_SESSIONS_LIST: "runtime.sessions-list",
  RUNTIME_SESSIONS_CLEAR: "runtime.sessions-clear",
  RUNTIME_SESSION_MESSAGES_READ: "runtime.session-messages-read",
  RUNTIME_SESSION_CONTEXT_READ: "runtime.session-context-read",
  RUNTIME_CHAT: "runtime.chat",
  RUNTIME_CHAT_ABORT: "runtime.chat-abort",
  RUNTIME_CHAT_STREAM: "runtime.chat-stream",
  RUNTIME_TOOLS_READ: "runtime.tools-read",
  RUNTIME_QUESTION_ANSWER: "runtime.question-answer",
} as const;

export type Action = (typeof ACTIONS)[keyof typeof ACTIONS];
```

- [ ] **Step 2.2: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: exit 0.

- [ ] **Step 2.3: Commit**

```bash
git add src/dashboard/middleware/permission-actions.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): add ACTIONS catalogue for permission middleware (H1)

Central list of action identifiers used by Community route annotations.
Convention: "<resource-kind>.<verb>", lowercase, dot-separated.

Extension-Point: permission-middleware
EOF
)"
```

---

## Task 3: `permission()` Hono middleware factory

**Files:**
- Modify: `src/dashboard/middleware/permission.ts`
- Test: `src/dashboard/middleware/__tests__/permission-middleware.test.ts`

- [ ] **Step 3.1: Write the failing test**

Create `src/dashboard/middleware/__tests__/permission-middleware.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from "vitest";
import { Hono } from "hono";
import {
  permission,
  registerPermissionChecker,
  resetPermissionChecker,
  type AuthenticatedUser,
  type PermissionContext,
} from "../permission.js";

function mkApp(user: AuthenticatedUser | null, mw: ReturnType<typeof permission>): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (user) c.set("user", user);
    await next();
  });
  app.post("/agents", mw, (c) => c.json({ ok: true }));
  return app;
}

const ADMIN: AuthenticatedUser = {
  id: "u1",
  username: "admin",
  role: "admin",
  source: "session",
};

describe("permission() middleware", () => {
  beforeEach(() => {
    resetPermissionChecker();
  });

  it("calls the registered checker with the expected context and allows on { allow: true }", async () => {
    const calls: PermissionContext[] = [];
    registerPermissionChecker({
      async check(ctx) {
        calls.push(ctx);
        return { allow: true };
      },
    });
    const app = mkApp(
      ADMIN,
      permission({ action: "agent.create", resource: { kind: "agent" } }),
    );
    const res = await app.request("/agents", { method: "POST" });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      user: ADMIN,
      action: "agent.create",
      resource: { kind: "agent" },
    });
  });

  it("returns 403 PERMISSION_DENIED on { allow: false }", async () => {
    registerPermissionChecker({
      async check() {
        return { allow: false, reason: "forbidden by policy" };
      },
    });
    const app = mkApp(
      ADMIN,
      permission({ action: "agent.delete", resource: { kind: "agent" } }),
    );
    const res = await app.request("/agents", { method: "POST" });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe("PERMISSION_DENIED");
    expect(body.error).toBe("forbidden by policy");
  });

  it("surfaces requiresApproval in the response body", async () => {
    registerPermissionChecker({
      async check() {
        return { allow: false, reason: "needs approval", requiresApproval: true };
      },
    });
    const app = mkApp(
      ADMIN,
      permission({ action: "agent.delete", resource: { kind: "agent" } }),
    );
    const res = await app.request("/agents", { method: "POST" });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { requiresApproval?: boolean };
    expect(body.requiresApproval).toBe(true);
  });

  it("resolves resource.id and resource.orgId from context lazily", async () => {
    const calls: PermissionContext[] = [];
    registerPermissionChecker({
      async check(ctx) {
        calls.push(ctx);
        return { allow: true };
      },
    });
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("user", ADMIN);
      await next();
    });
    app.delete(
      "/agents/:id",
      permission({
        action: "agent.delete",
        resource: {
          kind: "agent",
          id: (c) => c.req.param("id"),
          orgId: () => "org-42",
        },
      }),
      (c) => c.json({ ok: true }),
    );
    const res = await app.request("/agents/a42", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(calls[0]?.resource).toEqual({ kind: "agent", id: "a42", orgId: "org-42" });
  });

  it("passes attributes through when attributes() is provided", async () => {
    const calls: PermissionContext[] = [];
    registerPermissionChecker({
      async check(ctx) {
        calls.push(ctx);
        return { allow: true };
      },
    });
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("user", ADMIN);
      await next();
    });
    app.post(
      "/x",
      permission({
        action: "agent.create",
        resource: { kind: "agent" },
        attributes: () => ({ tag: "sensitive" }),
      }),
      (c) => c.json({ ok: true }),
    );
    const res = await app.request("/x", { method: "POST" });
    expect(res.status).toBe(200);
    expect(calls[0]?.attributes).toEqual({ tag: "sensitive" });
  });

  it("returns 401 UNAUTHENTICATED when no user is present on context", async () => {
    const app = mkApp(
      null,
      permission({ action: "agent.create", resource: { kind: "agent" } }),
    );
    const res = await app.request("/agents", { method: "POST" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("UNAUTHENTICATED");
  });
});
```

- [ ] **Step 3.2: Run the test to verify failure**

Run: `pnpm vitest run src/dashboard/middleware/__tests__/permission-middleware.test.ts`
Expected: FAIL — `permission` export does not exist.

- [ ] **Step 3.3: Extend `permission.ts` with the middleware factory**

Append to `src/dashboard/middleware/permission.ts`:

```typescript
import type { Context, MiddlewareHandler } from "hono";

export interface PermissionSpec {
  action: string;
  resource: {
    kind: string;
    /** Resolve the resource id from the request context (params, body, etc.). */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    id?: (c: Context<any, any, any>) => string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    orgId?: (c: Context<any, any, any>) => string | undefined;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attributes?: (c: Context<any, any, any>) => Record<string, unknown>;
}

/**
 * Hono middleware factory. Each annotated route declares its permission
 * metadata explicitly; the middleware reads the authenticated user from the
 * Hono context (`c.get("user")`, published by the auth middleware), builds a
 * PermissionContext, dispatches to the registered PermissionChecker, and
 * either calls next() or returns 403 PERMISSION_DENIED.
 */
export function permission(spec: PermissionSpec): MiddlewareHandler {
  return async (c, next) => {
    const user = c.get("user") as AuthenticatedUser | undefined;
    if (!user) {
      return c.json({ error: "Unauthenticated", code: "UNAUTHENTICATED" }, 401);
    }

    const id = spec.resource.id?.(c);
    const orgId = spec.resource.orgId?.(c);
    const attributes = spec.attributes?.(c);

    const ctx: PermissionContext = {
      user,
      action: spec.action,
      resource: {
        kind: spec.resource.kind,
        ...(id !== undefined ? { id } : {}),
        ...(orgId !== undefined ? { orgId } : {}),
      },
      ...(attributes !== undefined ? { attributes } : {}),
    };

    const decision = await getPermissionChecker().check(ctx);
    if (decision.allow) {
      return next();
    }

    return c.json(
      {
        error: decision.reason,
        code: "PERMISSION_DENIED",
        ...(decision.requiresApproval ? { requiresApproval: true } : {}),
      },
      403,
    );
  };
}
```

- [ ] **Step 3.4: Run the tests to verify pass**

Run: `pnpm vitest run src/dashboard/middleware/__tests__/`
Expected: PASS, all tests (4 from Task 1 + 6 from this task).

- [ ] **Step 3.5: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: exit 0.

- [ ] **Step 3.6: Commit**

```bash
git add src/dashboard/middleware/permission.ts src/dashboard/middleware/__tests__/permission-middleware.test.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): add permission() Hono middleware factory (H1)

Per-route annotation: app.post(path, permission({ action, resource }), handler).
Reads AuthenticatedUser from c.get("user"), dispatches to the registered
checker, short-circuits with 403 PERMISSION_DENIED on refusal.

Extension-Point: permission-middleware
EOF
)"
```

---

## Task 4: Publish `AuthenticatedUser` on Hono context

**Files:**
- Modify: `src/dashboard/server.ts` (auth middleware block, lines ~200–240)
- Test: `src/dashboard/__tests__/auth-context.test.ts`

- [ ] **Step 4.1: Inspect the current auth middleware**

Run: `grep -n "Auth middleware" src/dashboard/server.ts`
Open the file at that line and read the surrounding 50 lines so you see exactly the block to change.

- [ ] **Step 4.2: Write the failing test**

Create `src/dashboard/__tests__/auth-context.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { Hono } from "hono";
import { buildTestDb } from "./helpers/test-db.js"; // see note below
// If helpers/test-db.ts does not exist yet, fall back to existing dashboard
// test harness (search for other tests under src/dashboard/__tests__ that
// instantiate RouteDeps + createDashboardApp or similar). Use the same
// pattern here so the test mirrors real server wiring.

// Intent: POST /api/auth/login with a valid admin user, capture the user
// published on the context by a probe route. Repeat with a bearer token
// (no session) and assert the synthetic admin identity.

describe("auth middleware publishes AuthenticatedUser on context", () => {
  // Pseudocode shape — adapt to the existing harness:
  //
  // const app = new Hono();
  // const probe = async (c: any) => c.json({ user: c.get("user") });
  // setupDashboardServer(app, { ...deps, token: "BEARER_TOKEN" });
  // app.get("/api/_probe", probe);
  //
  // 1. Login admin → cookie session
  // const loginRes = await app.request("/api/auth/login", { method: "POST", body: JSON.stringify({ username: "admin", password: "..." }) });
  // const cookie = loginRes.headers.get("set-cookie")!;
  // const res = await app.request("/api/_probe", { headers: { cookie } });
  // const body = await res.json();
  // expect(body.user).toMatchObject({ username: "admin", role: "admin", source: "session" });
  //
  // 2. Bearer path
  // const res2 = await app.request("/api/_probe", { headers: { authorization: "Bearer BEARER_TOKEN" } });
  // const body2 = await res2.json();
  // expect(body2.user).toEqual({ id: "bearer", username: "bearer", role: "admin", source: "bearer" });

  it("session auth attaches the DB user row", async () => {
    // IMPLEMENT using the existing dashboard test harness — mirror the
    // pattern in src/dashboard/__tests__/*.test.ts (e.g. routes.test.ts).
    // Assertion: c.get("user") === { id, username, role, source: "session" }.
    expect(true).toBe(true); // replace once harness is wired
  });

  it("bearer-only auth attaches the synthetic admin identity", async () => {
    // Assertion: c.get("user") === { id: "bearer", username: "bearer", role: "admin", source: "bearer" }.
    expect(true).toBe(true); // replace once harness is wired
  });

  it("query-token SSE fallback also attaches the synthetic admin identity", async () => {
    // Request path: "/?token=<bearer>" (or the exact pattern used by the
    // SSE fallback in server.ts). Assertion: source === "bearer".
    expect(true).toBe(true); // replace once harness is wired
  });
});
```

**Note to the engineer:** `src/dashboard/__tests__/` already contains integration-style tests that boot the dashboard via the existing helpers. Before writing this test, run `ls src/dashboard/__tests__/` and open one of the existing test files to copy the bootstrap pattern (DB, SessionStore, Registry, dashboard app). Replace the three `expect(true).toBe(true)` placeholders with the real assertions above. Do not leave placeholder asserts in the committed file.

- [ ] **Step 4.3: Run the test to verify failure**

Run: `pnpm vitest run src/dashboard/__tests__/auth-context.test.ts`
Expected: either FAIL (the `user` property is undefined on context) or COMPILE ERROR if the harness is not yet wired. Both are acceptable "red" states for TDD — fix in the next step.

- [ ] **Step 4.4: Enrich the auth middleware in `src/dashboard/server.ts`**

Locate the `app.use("/api/*", async (c, next) => { ... })` block (around lines 206–237). Replace the three "return next()" lines with:

- **Session path** (after `if (session)`):
  ```typescript
  const userRow = db
    .prepare("SELECT id, username, role FROM users WHERE id = ?")
    .get(session.userId) as { id: string; username: string; role: string } | undefined;
  if (userRow) {
    c.set("user", {
      id: userRow.id,
      username: userRow.username,
      role: userRow.role,
      source: "session",
    } satisfies AuthenticatedUser);
    return next();
  }
  ```

- **Bearer path** (after `if (safeTokenCompare(auth, expectedBearer))`):
  ```typescript
  c.set("user", {
    id: "bearer",
    username: "bearer",
    role: "admin",
    source: "bearer",
  } satisfies AuthenticatedUser);
  return next();
  ```

- **Query-token SSE path** (after `if (queryToken && safeTokenCompare(...))`):
  ```typescript
  c.set("user", {
    id: "bearer",
    username: "bearer",
    role: "admin",
    source: "bearer",
  } satisfies AuthenticatedUser);
  return next();
  ```

Add at the top of `server.ts`:
```typescript
import type { AuthenticatedUser } from "./middleware/permission.js";
```

Also add a Hono Variables augmentation so `c.get("user")` is typed. At the top of the file (after imports):
```typescript
declare module "hono" {
  interface ContextVariableMap {
    user: AuthenticatedUser;
  }
}
```

- [ ] **Step 4.5: Run the auth-context test to verify pass**

Run: `pnpm vitest run src/dashboard/__tests__/auth-context.test.ts`
Expected: PASS (all three cases assert the expected user shape).

- [ ] **Step 4.6: Run the full dashboard test suite — no regressions**

Run: `pnpm vitest run src/dashboard/`
Expected: all previous tests still pass.

- [ ] **Step 4.7: Typecheck + lint**

Run: `pnpm typecheck:all && pnpm lint:all`
Expected: exit 0.

- [ ] **Step 4.8: Commit**

```bash
git add src/dashboard/server.ts src/dashboard/__tests__/auth-context.test.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): publish AuthenticatedUser on Hono context (H1)

Session path: attach DB user row with source="session".
Bearer + query-token paths: attach synthetic admin identity with source="bearer"
(preserves today's unrestricted programmatic/SSE access).

Typed via ContextVariableMap augmentation so c.get("user") is fully typed.

Extension-Point: permission-middleware
EOF
)"
```

---

## Task 5: Adopt `permission()` on `auth.ts` + `profile.ts` (reference pattern)

**Files:**
- Modify: `src/dashboard/routes/auth.ts`
- Modify: `src/dashboard/routes/profile.ts`

**Pattern — THIS IS THE CANONICAL PATTERN. All subsequent adoption tasks reproduce it.**

Import at the top of each route file:
```typescript
import { permission } from "../middleware/permission.js";
import { ACTIONS } from "../middleware/permission-actions.js";
```
(Adjust the relative path — `../../middleware/...` for files under `routes/instances/`, `../../../middleware/...` for `routes/instances/agents/`.)

Insert the middleware between the path and the handler:
```typescript
// Before:
app.post("/api/auth/logout", (c) => { ... });

// After:
app.post(
  "/api/auth/logout",
  permission({ action: ACTIONS.AUTH_LOGOUT, resource: { kind: "auth" } }),
  (c) => { ... },
);
```

When the route has additional middleware (e.g. `loginRateLimiter`), the permission middleware comes **after** rate limiting and **before** the handler — denies are cheaper than rate-limit slot consumption.

For parameterised paths (e.g. `/:id`, `/:slug`), extract the id via `(c) => c.req.param("id")`:
```typescript
app.delete(
  "/api/named-keys/:id",
  permission({
    action: ACTIONS.NAMED_KEY_DELETE,
    resource: { kind: "named-key", id: (c) => c.req.param("id") },
  }),
  (c) => { ... },
);
```

- [ ] **Step 5.1: Annotate `auth.ts`**

Routes and mappings:

| Method | Path | Action | Resource kind | id |
|--------|------|--------|---------------|----|
| POST | `/api/auth/login` | `AUTH_LOGIN` | `auth` | — |
| POST | `/api/auth/logout` | `AUTH_LOGOUT` | `auth` | — |
| GET  | `/api/auth/me`    | `AUTH_ME`    | `auth` | — |

**Note:** `/api/auth/login` is in `PUBLIC_ROUTES` (no auth middleware runs) — the `permission()` middleware would 401 because there is no user on context. Skip annotation on login (add an inline comment `// no permission() — public endpoint, auth runs INSIDE the handler`).

- [ ] **Step 5.2: Annotate `profile.ts`**

| Method | Path | Action | Resource kind | id |
|--------|------|--------|---------------|----|
| GET   | `/api/profile` | `PROFILE_READ`   | `profile` | — |
| PATCH | `/api/profile` | `PROFILE_UPDATE` | `profile` | — |

- [ ] **Step 5.3: Run the auth + profile tests**

Run: `pnpm vitest run src/dashboard/routes/__tests__/ -t "auth"` (and `-t "profile"`).
Expected: all existing tests still pass (NullPermissionChecker allows everything).

- [ ] **Step 5.4: Typecheck + lint**

Run: `pnpm typecheck:all && pnpm lint`
Expected: exit 0.

- [ ] **Step 5.5: Commit**

```bash
git add src/dashboard/routes/auth.ts src/dashboard/routes/profile.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): annotate auth+profile routes with permission() (H1)

Establishes the canonical pattern for subsequent route adoption.
Login stays unannotated (public route, pre-auth).

Extension-Point: permission-middleware
EOF
)"
```

---

## Task 6: Adopt on standalone top-level routes

**Files:**
- Modify: `src/dashboard/routes/named-keys.ts`
- Modify: `src/dashboard/routes/system.ts`
- Modify: `src/dashboard/routes/system-instance.ts`
- Modify: `src/dashboard/routes/search.ts`
- Modify: `src/dashboard/routes/notifications.ts`
- Modify: `src/dashboard/routes/teams.ts`
- Modify: `src/dashboard/routes/agent-blueprints.ts`
- Modify: `src/dashboard/routes/blueprints.ts`

Follow the pattern from Task 5. Exact mappings:

**`named-keys.ts`** (sensitive — annotate reads too)

| Method | Path | Action | id |
|--------|------|--------|----|
| GET    | `/api/named-keys`       | `NAMED_KEY_READ`   | — |
| POST   | `/api/named-keys`       | `NAMED_KEY_CREATE` | — |
| PUT    | `/api/named-keys/:id`   | `NAMED_KEY_UPDATE` | `:id` |
| DELETE | `/api/named-keys/:id`   | `NAMED_KEY_DELETE` | `:id` |

Resource kind: `named-key`.

**`system.ts`**

| Method | Path | Action |
|--------|------|--------|
| GET  | `/api/health`             | `SYSTEM_HEALTH` |
| GET  | `/api/self/update-status` | `SYSTEM_UPDATE_STATUS` |
| POST | `/api/self/update`        | `SYSTEM_UPDATE_APPLY` |

Resource kind: `system`.

**`system-instance.ts`**

| Method | Path | Action |
|--------|------|--------|
| GET  | `/api/system/status` | `SYSTEM_INSTANCE_STATUS` |
| POST | `/api/system/ensure` | `SYSTEM_INSTANCE_ENSURE` |
| POST | `/api/system/query`  | `SYSTEM_INSTANCE_QUERY`  |
| GET  | `/api/system/ready`  | `SYSTEM_INSTANCE_READY`  |

Resource kind: `system-instance`.

**`search.ts`**

| Method | Path | Action |
|--------|------|--------|
| GET  | `/api/search` | `SEARCH_QUERY` |

Resource kind: `search`.

**`notifications.ts`**

| Method | Path | Action | id |
|--------|------|--------|----|
| GET   | `/api/notifications`               | `NOTIFICATION_LIST` | — |
| GET   | `/api/notifications/unread-count`  | `NOTIFICATION_UNREAD_COUNT` | — |
| PATCH | `/api/notifications/:id/read`      | `NOTIFICATION_MARK_READ`    | `:id` |
| POST  | `/api/notifications/mark-all-read` | `NOTIFICATION_MARK_ALL_READ`| — |

Resource kind: `notification`.

**`teams.ts`**

| Method | Path | Action | id |
|--------|------|--------|----|
| GET  | `/api/instances/:slug/team/export` | `TEAM_EXPORT` | `:slug` |
| POST | `/api/instances/:slug/team/import` | `TEAM_IMPORT` | `:slug` |
| GET  | `/api/blueprints/:id/team/export`  | `TEAM_EXPORT` | `:id` |
| POST | `/api/blueprints/:id/team/import`  | `TEAM_IMPORT` | `:id` |

Resource kind: `team`.

**`agent-blueprints.ts`** — use the `AGENT_BLUEPRINT_*` catalogue entries, resource kind `agent-blueprint`. Map `:id` to `resource.id`. Full mapping:

| Method | Path | Action |
|--------|------|--------|
| GET    | `/api/agent-blueprints`                 | `AGENT_BLUEPRINT_LIST` |
| POST   | `/api/agent-blueprints`                 | `AGENT_BLUEPRINT_CREATE` |
| GET    | `/api/agent-blueprints/:id`             | `AGENT_BLUEPRINT_READ` |
| PUT    | `/api/agent-blueprints/:id`             | `AGENT_BLUEPRINT_UPDATE` |
| DELETE | `/api/agent-blueprints/:id`             | `AGENT_BLUEPRINT_DELETE` |
| POST   | `/api/agent-blueprints/:id/clone`       | `AGENT_BLUEPRINT_CLONE` |
| GET    | `/api/agent-blueprints/:id/files/:filename` | `AGENT_BLUEPRINT_FILE_READ` |
| PUT    | `/api/agent-blueprints/:id/files/:filename` | `AGENT_BLUEPRINT_FILE_UPDATE` |
| DELETE | `/api/agent-blueprints/:id/files/:filename` | `AGENT_BLUEPRINT_FILE_DELETE` |
| POST   | `/api/agent-blueprints/from-agent`      | `AGENT_BLUEPRINT_FROM_AGENT` |
| GET    | `/api/agent-blueprints/:id/export`      | `AGENT_BLUEPRINT_EXPORT` |
| POST   | `/api/agent-blueprints/import`          | `AGENT_BLUEPRINT_IMPORT` |

**`blueprints.ts`** — resource kind `blueprint`. Map `:id` and nested `:agentId` appropriately (use `attributes: (c) => ({ agentId: c.req.param("agentId") })` for nested agent ops, keep `resource.id = :id` of the blueprint).

| Method | Path | Action |
|--------|------|--------|
| GET    | `/api/blueprints`                                           | `BLUEPRINT_LIST` |
| POST   | `/api/blueprints`                                           | `BLUEPRINT_CREATE` |
| POST   | `/api/blueprints/import-builtin/:slug`                      | `BLUEPRINT_IMPORT_BUILTIN` |
| GET    | `/api/blueprints/:id`                                       | `BLUEPRINT_READ` |
| PUT    | `/api/blueprints/:id`                                       | `BLUEPRINT_UPDATE` |
| DELETE | `/api/blueprints/:id`                                       | `BLUEPRINT_DELETE` |
| GET    | `/api/blueprints/:id/builder`                               | `BLUEPRINT_BUILDER_READ` |
| POST   | `/api/blueprints/:id/agents`                                | `BLUEPRINT_AGENT_CREATE` |
| PATCH  | `/api/blueprints/:id/agents/:agentId/meta`                  | `BLUEPRINT_AGENT_UPDATE` |
| DELETE | `/api/blueprints/:id/agents/:agentId`                       | `BLUEPRINT_AGENT_DELETE` |
| PATCH  | `/api/blueprints/:id/agents/:agentId/position`              | `BLUEPRINT_AGENT_UPDATE` |
| GET    | `/api/blueprints/:id/agents/:agentId/files/:filename`       | `BLUEPRINT_AGENT_FILE_READ` |
| PUT    | `/api/blueprints/:id/agents/:agentId/files/:filename`       | `BLUEPRINT_AGENT_FILE_UPDATE` |
| PATCH  | `/api/blueprints/:id/agents/:agentId/spawn-links`           | `BLUEPRINT_AGENT_UPDATE` |

- [ ] **Step 6.1: Annotate each file in the list above**

Apply the pattern from Task 5. Work file-by-file; after each file run:
```bash
pnpm vitest run src/dashboard/routes/__tests__/ -t "<filename-stem>"
pnpm typecheck && pnpm lint
```
Fix any failure before moving to the next file.

- [ ] **Step 6.2: Full dashboard test run**

Run: `pnpm vitest run src/dashboard/`
Expected: all tests pass.

- [ ] **Step 6.3: Commit**

```bash
git add src/dashboard/routes/named-keys.ts src/dashboard/routes/system.ts src/dashboard/routes/system-instance.ts src/dashboard/routes/search.ts src/dashboard/routes/notifications.ts src/dashboard/routes/teams.ts src/dashboard/routes/agent-blueprints.ts src/dashboard/routes/blueprints.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): annotate top-level routes with permission() (H1)

named-keys, system, system-instance, search, notifications, teams,
agent-blueprints, blueprints.

Extension-Point: permission-middleware
EOF
)"
```

---

## Task 7: Adopt on instances top-level + config + mcp + telegram + budgets + permissions + flows

**Files:** (all under `src/dashboard/routes/instances/`)
- `lifecycle.ts`, `config.ts`, `mcp.ts`, `telegram.ts`, `budgets.ts`, `permissions.ts`, `flows.ts`

**`lifecycle.ts`** — resource kind `instance`, resource.id = `:slug` when present.

| Method | Path | Action |
|--------|------|--------|
| GET    | `/api/instances`                         | `INSTANCE_LIST` |
| GET    | `/api/instances/:slug`                   | `INSTANCE_READ` |
| GET    | `/api/instances/:slug/health`            | `INSTANCE_HEALTH` |
| POST   | `/api/instances/:slug/start`             | `INSTANCE_START` |
| POST   | `/api/instances/:slug/stop`              | `INSTANCE_STOP` |
| POST   | `/api/instances/:slug/restart`           | `INSTANCE_RESTART` |
| DELETE | `/api/instances/:slug`                   | `INSTANCE_DELETE` |
| GET    | `/api/next-port`                         | `INSTANCE_NEXT_PORT` (no id) |
| POST   | `/api/instances`                         | `INSTANCE_CREATE` (no id) |
| GET    | `/api/instances/:slug/conversations`     | `INSTANCE_CONVERSATIONS_READ` |

**`config.ts`** — resource kind `instance`.

| Method | Path | Action |
|--------|------|--------|
| GET   | `/api/instances/:slug/config`                 | `INSTANCE_CONFIG_READ` |
| PATCH | `/api/instances/:slug/config`                 | `INSTANCE_CONFIG_UPDATE` |
| PATCH | `/api/instances/:slug/config/telegram/token`  | `INSTANCE_CONFIG_TELEGRAM_TOKEN_UPDATE` |
| GET   | `/api/providers`                              | `PROVIDER_LIST` (resource kind `provider`, no id) |

**`mcp.ts`** — resource kind `instance`.

| Method | Path | Action |
|--------|------|--------|
| GET | `/api/instances/:slug/mcp/tools`  | `INSTANCE_MCP_TOOLS_READ` |
| GET | `/api/instances/:slug/mcp/status` | `INSTANCE_MCP_STATUS` |

**`telegram.ts`** — resource kind `instance`.

| Method | Path | Action |
|--------|------|--------|
| GET    | `/api/instances/:slug/telegram/pairing`         | `INSTANCE_TELEGRAM_PAIRING_READ` |
| POST   | `/api/instances/:slug/telegram/pairing/approve` | `INSTANCE_TELEGRAM_PAIRING_APPROVE` |
| DELETE | `/api/instances/:slug/telegram/pairing/:code`   | `INSTANCE_TELEGRAM_PAIRING_DELETE` (attributes: code) |

**`budgets.ts`** — resource kind `budget`; resource.id = `:id` when present, attributes include `slug`.

| Method | Path | Action |
|--------|------|--------|
| GET    | `/api/instances/:slug/budgets`                   | `INSTANCE_BUDGET_LIST` |
| POST   | `/api/instances/:slug/budgets`                   | `INSTANCE_BUDGET_CREATE` |
| PUT    | `/api/instances/:slug/budgets/:id`               | `INSTANCE_BUDGET_UPDATE` |
| DELETE | `/api/instances/:slug/budgets/:id`               | `INSTANCE_BUDGET_DELETE` |
| POST   | `/api/instances/:slug/budgets/:id/override`      | `INSTANCE_BUDGET_OVERRIDE` |
| GET    | `/api/instances/:slug/budgets/:id/events`        | `INSTANCE_BUDGET_EVENTS_READ` |
| GET    | `/api/instances/:slug/budgets/events`            | `INSTANCE_BUDGET_EVENTS_READ` |
| POST   | `/api/instances/:slug/budgets/:id/reconcile`     | `INSTANCE_BUDGET_RECONCILE` |

**`permissions.ts`** (runtime tool-call permissions — orthogonal concern, still route-gated) — resource kind `runtime-permission`.

| Method | Path | Action |
|--------|------|--------|
| GET    | `/api/instances/:slug/runtime/permissions`           | `INSTANCE_RUNTIME_PERMISSION_LIST` |
| DELETE | `/api/instances/:slug/runtime/permissions/:id`       | `INSTANCE_RUNTIME_PERMISSION_DELETE` |
| POST   | `/api/instances/:slug/runtime/permission/reply`      | `INSTANCE_RUNTIME_PERMISSION_REPLY` |

**`flows.ts`** — resource kind `flow`, resource.id = `:id` (or `:runId` for run-scoped ops).

| Method | Path | Action |
|--------|------|--------|
| GET    | `/api/instances/:slug/flows`                    | `FLOW_LIST` |
| GET    | `/api/instances/:slug/flows/:id`                | `FLOW_READ` |
| POST   | `/api/instances/:slug/flows`                    | `FLOW_CREATE` |
| PATCH  | `/api/instances/:slug/flows/:id`                | `FLOW_UPDATE` |
| DELETE | `/api/instances/:slug/flows/:id`                | `FLOW_DELETE` |
| POST   | `/api/instances/:slug/flows/:id/run`            | `FLOW_RUN` |
| GET    | `/api/instances/:slug/flows/:id/runs`           | `FLOW_RUNS_LIST` |
| GET    | `/api/instances/:slug/flow-runs/:runId`         | `FLOW_RUN_READ` (id = `:runId`) |
| POST   | `/api/instances/:slug/flow-runs/:runId/cancel`  | `FLOW_RUN_CANCEL` (id = `:runId`) |
| GET    | `/api/instances/:slug/flows/:id/sessions`       | `FLOW_SESSIONS_LIST` |

- [ ] **Step 7.1: Annotate each file, testing after each one**

For each file, apply the pattern from Task 5. After each file:
```bash
pnpm vitest run src/dashboard/routes/instances/__tests__/ -t "<filename-stem>"
pnpm typecheck && pnpm lint
```

- [ ] **Step 7.2: Full dashboard test run**

Run: `pnpm vitest run src/dashboard/`
Expected: all tests pass.

- [ ] **Step 7.3: Commit**

```bash
git add src/dashboard/routes/instances/lifecycle.ts src/dashboard/routes/instances/config.ts src/dashboard/routes/instances/mcp.ts src/dashboard/routes/instances/telegram.ts src/dashboard/routes/instances/budgets.ts src/dashboard/routes/instances/permissions.ts src/dashboard/routes/instances/flows.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): annotate instance/config/mcp/telegram/budget/permission/flow routes (H1)

Extension-Point: permission-middleware
EOF
)"
```

---

## Task 8: Adopt on `instances/agents/*`

**Files:**
- `src/dashboard/routes/instances/agents/kickoff.ts`
- `src/dashboard/routes/instances/agents/spawn-links.ts`
- `src/dashboard/routes/instances/agents/skills.ts`
- `src/dashboard/routes/instances/agents/create.ts`
- `src/dashboard/routes/instances/agents/list.ts`
- `src/dashboard/routes/instances/agents/files.ts`
- `src/dashboard/routes/instances/agents/update.ts`
- `src/dashboard/routes/instances/agents/sync.ts`
- `src/dashboard/routes/instances/agents/delete.ts`

Resource kind: `agent` (or `skill` for skill routes). `resource.id = :agentId` when present; `attributes: { slug: c.req.param("slug") }` to surface the owning instance.

| Method | Path | Action |
|--------|------|--------|
| POST   | `/api/instances/:slug/agents/:agentId/kickoff`      | `AGENT_KICKOFF` |
| PATCH  | `/api/instances/:slug/agents/:agentId/spawn-links`  | `AGENT_UPDATE_SPAWN_LINKS` |
| GET    | `/api/instances/:slug/skills`                       | `SKILL_LIST` (resource `skill`) |
| POST   | `/api/instances/:slug/skills/upload`                | `SKILL_UPLOAD` |
| POST   | `/api/instances/:slug/skills/install`               | `SKILL_INSTALL` |
| DELETE | `/api/instances/:slug/skills/:name`                 | `SKILL_DELETE` (id = `:name`) |
| POST   | `/api/instances/:slug/agents`                       | `AGENT_CREATE` |
| POST   | `/api/instances/:slug/agents/from-template`         | `AGENT_FROM_TEMPLATE` |
| GET    | `/api/instances/:slug/agents`                       | `AGENT_LIST` |
| GET    | `/api/instances/:slug/agents/builder`               | `AGENT_BUILDER_READ` |
| GET    | `/api/instances/:slug/agents/:agentId/files`        | `AGENT_FILES_READ` |
| GET    | `/api/instances/:slug/agents/:agentId/files/*`      | `AGENT_FILE_READ` |
| PUT    | `/api/instances/:slug/agents/:agentId/files/*`      | `AGENT_FILE_UPDATE` |
| DELETE | `/api/instances/:slug/agents/:agentId/files/*`      | `AGENT_FILE_DELETE` |
| PATCH  | `/api/instances/:slug/agents/:agentId/position`     | `AGENT_UPDATE_POSITION` |
| PATCH  | `/api/instances/:slug/agents/:agentId/meta`         | `AGENT_UPDATE_META` |
| POST   | `/api/instances/:slug/agents/sync`                  | `AGENT_SYNC` |
| DELETE | `/api/instances/:slug/agents/:agentId`              | `AGENT_DELETE` |

- [ ] **Step 8.1: Annotate each file, testing after each one**

After each file: `pnpm vitest run src/dashboard/routes/instances/agents/__tests__/ -t "<filename-stem>"` plus `pnpm typecheck && pnpm lint`.

- [ ] **Step 8.2: Full dashboard test run**

Run: `pnpm vitest run src/dashboard/`
Expected: all tests pass.

- [ ] **Step 8.3: Commit**

```bash
git add src/dashboard/routes/instances/agents/
git commit -m "$(cat <<'EOF'
feat(dashboard): annotate agents routes with permission() (H1)

Extension-Point: permission-middleware
EOF
)"
```

---

## Task 9: Adopt on remaining `instances/*` (tasks, shared-files, workspace, memory, discover, events, heartbeat, costs, runtime)

**Files:**
- `tasks-crud.ts`, `tasks-actions.ts`
- `shared-files.ts`, `workspace-download.ts`
- `memory.ts`
- `discover.ts`, `events.ts`, `heartbeat.ts`, `costs.ts`
- `runtime-messages.ts`, `runtime-status.ts`, `runtime-chat.ts`, `runtime-tools.ts`

Full mapping:

**`tasks-crud.ts`** — resource kind `task`, id = `:id`.

| Method | Path | Action |
|--------|------|--------|
| GET    | `/api/instances/:slug/tasks`          | `TASK_LIST` |
| GET    | `/api/instances/:slug/tasks/counts`   | `TASK_COUNTS` |
| GET    | `/api/instances/:slug/tasks/:id`      | `TASK_READ` |
| POST   | `/api/instances/:slug/tasks`          | `TASK_CREATE` |
| PATCH  | `/api/instances/:slug/tasks/:id`      | `TASK_UPDATE` |
| DELETE | `/api/instances/:slug/tasks/:id`      | `TASK_DELETE` |
| GET    | `/api/instances/:slug/epics`          | `EPIC_LIST` (resource `epic`) |
| GET    | `/api/instances/:slug/epics/:id/children` | `EPIC_CHILDREN` (resource `epic`, id = `:id`) |

**`tasks-actions.ts`** — resource kind `task`, id = `:id`.

| Method | Path | Action |
|--------|------|--------|
| PATCH | `/api/instances/:slug/tasks/:id/status`   | `TASK_STATUS` |
| PATCH | `/api/instances/:slug/tasks/:id/reorder`  | `TASK_REORDER` |
| POST  | `/api/instances/:slug/tasks/:id/comments` | `TASK_COMMENT` |
| GET   | `/api/instances/:slug/tasks/:id/timeline` | `TASK_TIMELINE_READ` |

**`shared-files.ts`** — resource kind `shared-files`; for wildcard `*` paths, capture the tail via `attributes: (c) => ({ path: c.req.path })`.

| Method | Path | Action |
|--------|------|--------|
| GET    | `/api/instances/:slug/shared-files`   | `SHARED_FILES_LIST` |
| GET    | `/api/instances/:slug/shared-files/*` | `SHARED_FILE_READ` |
| PUT    | `/api/instances/:slug/shared-files/*` | `SHARED_FILE_UPDATE` |
| DELETE | `/api/instances/:slug/shared-files/*` | `SHARED_FILE_DELETE` |

**`workspace-download.ts`** — resource kind `workspace`.

| Method | Path | Action |
|--------|------|--------|
| GET | `/api/instances/:slug/workspace/download` | `WORKSPACE_DOWNLOAD` |

**`memory.ts`** — resource kind `memory`.

| Method | Path | Action |
|--------|------|--------|
| GET | `/api/instances/:slug/memory/agents`                           | `MEMORY_AGENTS_LIST` |
| GET | `/api/instances/:slug/memory/agents/:agentId/files`            | `MEMORY_AGENT_FILES_LIST` |
| GET | `/api/instances/:slug/memory/agents/:agentId/files/:filename`  | `MEMORY_AGENT_FILE_READ` |
| GET | `/api/instances/:slug/memory/search`                           | `MEMORY_SEARCH` |

**`discover.ts`** — resource kind `instance`.

| Method | Path | Action |
|--------|------|--------|
| POST | `/api/instances/discover`       | `INSTANCE_DISCOVER` |
| POST | `/api/instances/discover/adopt` | `INSTANCE_DISCOVER_ADOPT` |

**`events.ts`** — resource kind `event`, attributes include `slug`.

| Method | Path | Action |
|--------|------|--------|
| GET | `/api/instances/:slug/events`        | `EVENT_LIST` |
| GET | `/api/instances/:slug/events/stream` | `EVENT_STREAM` |

**`heartbeat.ts`** — resource kind `heartbeat`.

| Method | Path | Action |
|--------|------|--------|
| GET | `/api/instances/:slug/heartbeat/schedule` | `HEARTBEAT_SCHEDULE_READ` |
| GET | `/api/instances/:slug/heartbeat/heatmap`  | `HEARTBEAT_HEATMAP_READ` |

**`costs.ts`** — resource kind `costs`.

| Method | Path | Action |
|--------|------|--------|
| GET | `/api/instances/:slug/costs/summary`   | `INSTANCE_COSTS_SUMMARY` |
| GET | `/api/instances/:slug/costs/daily`     | `INSTANCE_COSTS_DAILY` |
| GET | `/api/instances/:slug/costs/by-agent`  | `INSTANCE_COSTS_BY_AGENT` |
| GET | `/api/instances/:slug/costs/by-model`  | `INSTANCE_COSTS_BY_MODEL` |

**`runtime-status.ts`** / **`runtime-messages.ts`** — resource kind `runtime`.

| Method | Path | Action |
|--------|------|--------|
| GET    | `/api/instances/:slug/runtime/status`                        | `RUNTIME_STATUS` |
| GET    | `/api/instances/:slug/runtime/sessions`                      | `RUNTIME_SESSIONS_LIST` |
| DELETE | `/api/instances/:slug/runtime/sessions`                      | `RUNTIME_SESSIONS_CLEAR` |
| GET    | `/api/instances/:slug/runtime/sessions/:sessionId/messages`  | `RUNTIME_SESSION_MESSAGES_READ` |
| GET    | `/api/instances/:slug/runtime/sessions/:sessionId/context`   | `RUNTIME_SESSION_CONTEXT_READ` |

**`runtime-chat.ts`** — resource kind `runtime`.

| Method | Path | Action |
|--------|------|--------|
| POST | `/api/instances/:slug/runtime/chat`                         | `RUNTIME_CHAT` |
| POST | `/api/instances/:slug/runtime/sessions/:sessionId/abort`    | `RUNTIME_CHAT_ABORT` |
| GET  | `/api/instances/:slug/runtime/chat/stream`                  | `RUNTIME_CHAT_STREAM` |

**Note on `runtime-chat.ts` stream**: the SSE endpoint accepts `?token=` for EventSource. The synthetic bearer user will be attached; the `permission()` middleware will see `source: "bearer"` and allow under NullPermissionChecker. No special handling needed.

**`runtime-tools.ts`** — resource kind `runtime`.

| Method | Path | Action |
|--------|------|--------|
| GET  | `/api/instances/:slug/runtime/tools`                          | `RUNTIME_TOOLS_READ` |
| POST | `/api/instances/:slug/runtime/questions/:questionId/answer`   | `RUNTIME_QUESTION_ANSWER` |
| GET  | `/api/instances/:slug/runtime/heartbeat/history`              | `HEARTBEAT_HISTORY_READ` |

- [ ] **Step 9.1: Annotate each file, testing after each one**

Same routine as previous tasks. After each file: file-scoped vitest + typecheck + lint.

- [ ] **Step 9.2: Full dashboard test run**

Run: `pnpm vitest run src/dashboard/`
Expected: all tests pass.

- [ ] **Step 9.3: Commit**

```bash
git add src/dashboard/routes/instances/tasks-crud.ts src/dashboard/routes/instances/tasks-actions.ts src/dashboard/routes/instances/shared-files.ts src/dashboard/routes/instances/workspace-download.ts src/dashboard/routes/instances/memory.ts src/dashboard/routes/instances/discover.ts src/dashboard/routes/instances/events.ts src/dashboard/routes/instances/heartbeat.ts src/dashboard/routes/instances/costs.ts src/dashboard/routes/instances/runtime-messages.ts src/dashboard/routes/instances/runtime-status.ts src/dashboard/routes/instances/runtime-chat.ts src/dashboard/routes/instances/runtime-tools.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): annotate remaining instance routes with permission() (H1)

tasks, shared-files, workspace, memory, discover, events, heartbeat,
costs, runtime (messages, status, chat, tools).

Extension-Point: permission-middleware
EOF
)"
```

---

## Task 10: Architecture documentation

**Files:**
- Create: `docs/architecture/permission-middleware.md`
- Modify: `docs/architecture/README.md` (add pointer)
- Modify: `CHANGELOG.md` (Unreleased section)

- [ ] **Step 10.1: Write the architecture doc**

Create `docs/architecture/permission-middleware.md` mirroring the style of `docs/architecture/capability-registry.md`. Cover: purpose, the extension point contract, the Community default (NullPermissionChecker), the `permission()` middleware factory, how routes declare metadata, the `ACTIONS` ergonomic catalogue, the `AuthenticatedUser` shape (including `source`), the `runtime/permission` orthogonality note, and the Enterprise consumption pattern.

Aim for ~150 lines, heavy on the contract and the extension narrative.

- [ ] **Step 10.2: Update `docs/architecture/README.md`**

Add a row/entry linking to `permission-middleware.md` in the same style as the existing entries (e.g. the `capability-registry.md` row).

- [ ] **Step 10.3: Update `CHANGELOG.md`**

Under the `## [Unreleased]` heading, add:
```markdown
### Added
- Permission middleware extension point (`src/dashboard/middleware/permission.ts`): contract for pluggable `PermissionChecker`, registration API, `permission()` Hono middleware factory, and ACTIONS catalogue. Community ships `NullPermissionChecker` (always allow) since Community is mono-user admin by design. Enterprise can register a FineGrainedRBACChecker without modifying any dashboard route. (H1)
```

- [ ] **Step 10.4: Spellcheck**

Run: `pnpm spellcheck`
Expected: exit 0. If unknown technical terms fail, add them to the project dictionary (see `cspell.json`).

- [ ] **Step 10.5: Commit**

```bash
git add docs/architecture/permission-middleware.md docs/architecture/README.md CHANGELOG.md
git commit -m "$(cat <<'EOF'
docs(dashboard): architecture doc for permission middleware (H1)

Extension-Point: permission-middleware
EOF
)"
```

---

## Task 11: Final verification + PR

- [ ] **Step 11.1: Full local CI gate**

Run the exact sequence from `ai-docs/runbook-deploy.md` LOCAL CI/CD:
```bash
pnpm format:check
pnpm lint:all
pnpm typecheck:all
pnpm knip
pnpm check:circular
pnpm spellcheck
pnpm test:run
```
All must exit 0. Record the final test count — must be ≥ the baseline from Step 0.2.

- [ ] **Step 11.2: Run the build**

Run: `pnpm build:safe`
Expected: exit 0, `dist/` populated.

- [ ] **Step 11.3: Deploy to MAC for integration validation**

Per `ai-docs/runbook-deploy.md`, deploy the feature branch to MAC and manually exercise the dashboard:
- Log in → the dashboard loads normally (session path).
- Create an agent blueprint, create an instance, start/stop it.
- Hit a named-key CRUD action.
- Open an SSE stream (runtime chat) and confirm it still works.

Document deployment in the PR body.

- [ ] **Step 11.4: Open the PR**

```bash
git push -u origin feature/permission-middleware-dashboard
gh pr create --base develop --title "feat(dashboard): permission middleware extension point (H1)" --body "$(cat <<'EOF'
## Summary

- New `src/dashboard/middleware/permission.ts`: `PermissionChecker` contract, registration seam (`registerPermissionChecker()`), default `NullPermissionChecker`, `permission()` Hono middleware factory.
- New `src/dashboard/middleware/permission-actions.ts`: `ACTIONS` catalogue.
- `src/dashboard/server.ts` auth middleware publishes `AuthenticatedUser` on the Hono context with a `source: "session" | "bearer"` discriminator.
- Every mutation route (and sensitive read route like named-keys) across `src/dashboard/routes/**` is annotated with `permission({ action, resource })`.
- Architecture doc + CHANGELOG entry.

## Why

Enterprise needs to inject a fine-grained RBAC checker without modifying any route file — preserves R3 byte-identity on frozen paths (zero sync conflicts forever). Community stays mono-user admin; the middleware always allows by default.

## Test plan

- [ ] `pnpm test:run` green (count ≥ baseline)
- [ ] `pnpm typecheck:all && pnpm lint:all && pnpm knip && pnpm check:circular && pnpm spellcheck` all green
- [ ] `pnpm build:safe` green
- [ ] Deployed to MAC, manual smoke test on dashboard (login, instance CRUD, SSE streams)

## Discipline

All commits touching `src/dashboard/server.ts` and `src/dashboard/routes/**` carry `Extension-Point: permission-middleware` trailer (R3).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 11.5: Verify CI green on GitHub**

Watch the PR checks. If anything goes red, fix locally, push, loop.

---

## Self-Review Notes

**Spec coverage check:**
- API signature (Task 1, 3) ✓
- `source` field on `AuthenticatedUser` (Task 1) ✓
- `ACTIONS` ergonomic catalogue + convention docstring (Task 2) ✓
- `NullPermissionChecker` default (Task 1) ✓
- Auth middleware enrichment with user context (Task 4) ✓
- Synthetic bearer admin identity (Task 4) ✓
- Adoption on all mutation routes + sensitive reads (Tasks 5–9) ✓
- Articulation note with runtime/permission (architecture doc, Task 10) ✓
- Error handling 403 PERMISSION_DENIED (Task 3) ✓
- R3 trailer on every relevant commit (all adoption tasks) ✓
- Validation on MAC before merge (Task 11.3) ✓

**Placeholder check:** Task 4.2 contains pseudocode the engineer must complete using the existing dashboard test harness. This is explicitly flagged; the engineer is told to mirror an existing harness pattern and **not leave placeholder asserts committed**. All other steps contain concrete code.

**Type consistency:** `AuthenticatedUser`, `PermissionContext`, `PermissionDecision`, `PermissionChecker`, `PermissionSpec` are used consistently across Tasks 1, 3, 4. `ACTIONS.*` constants map 1:1 to the names used in adoption tables in Tasks 5–9.
