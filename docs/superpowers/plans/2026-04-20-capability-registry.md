# CapabilityRegistry (H5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `CapabilityRegistry` hook (H5) — a single `src/core/capabilities.ts` module that Community ships with a "no enterprise capability enabled" implementation, and that Enterprise will replace once at bootstrap via `setCapabilityRegistry()`.

**Architecture:** One module, proxy-singleton pattern. The exported `capabilities` object closes over a module-level `current` registry reference, so Enterprise can swap the implementation after consumers have already imported `capabilities`. A `locked` flag makes `setCapabilityRegistry` one-shot.

**Tech Stack:** TypeScript (NodeNext ESM, strict), Vitest for tests, `ClawPilotError` error hierarchy from `src/lib/errors.ts`.

**Spec:** [`docs/superpowers/specs/2026-04-20-capability-registry-design.md`](../specs/2026-04-20-capability-registry-design.md) (commit `0f97a52`)

**Worktree:** `/Users/swoelffel/Projects/DevIA/ClawPilot/ClawPilot-capability-registry` — branch `feature/capability-registry` — base `develop @606dfdc`

---

## Ground rules for the implementer

- **Work directory.** Every `pnpm` and `git` command runs from the worktree root above. Do NOT `cd` elsewhere.
- **Language.** All code, comments, doc strings, commit messages and PR body must be in **English** (project convention in `CLAUDE.md`).
- **Imports.** NodeNext ESM → relative imports only, **always with `.js` extension**, no `@/` alias exists. Example: `import { ClawPilotError } from "../lib/errors.js"`.
- **Named exports only.** No `default` exports anywhere in this plan.
- **Formatting.** Prettier-enforced: double quotes, always semicolons, trailing commas, print-width 100, tab-width 2, arrow parens always.
- **Error class convention.** Subclasses of `ClawPilotError` in this codebase (`InstanceNotFoundError`, `InstanceAlreadyExistsError`, `GatewayUnhealthyError`) do **not** set `this.name` — the `code` string is the identifier. Follow that pattern: our new `CapabilityNotAvailableError` does **not** set `this.name`.
- **Test location & style.** Tests live in `src/core/__tests__/<name>.test.ts`, Vitest-style: `import { describe, it, expect } from "vitest"` at the top, no BDD helpers. First line is a file-path comment, e.g. `// src/core/__tests__/capabilities.test.ts`.
- **Pre-commit hook (lefthook).** On commit, runs: `pnpm format:check`, `pnpm lint:all`, `pnpm typecheck:all`, plus `commitlint` on the message. Never bypass with `--no-verify`. If a hook fails, fix the root cause and make a new commit.
- **Pre-push hook.** Runs `pnpm test:run`, `pnpm spellcheck`, and a no-silent-catches gate. Make sure everything passes locally before pushing.
- **Conventional commits.** Subject prefix is mandatory: `feat(core): …` for the module commit, `docs(core): …` for the documentation commit.
- **Frozen-path trailer.** The commit that adds `src/core/capabilities.ts` **must** include this trailer at the end of the message body:
  ```
  Extension-Point: CapabilityRegistry
  ```
- **No push → develop.** Merging to `develop` happens only through a GitHub PR — never `git merge` locally.

---

## File plan

### New files

| File | Responsibility |
|---|---|
| `src/core/capabilities.ts` | Types (`Capability`, `EnterpriseCapability`), `CapabilityRegistry` interface, `CommunityCapabilityRegistry` default impl, `CapabilityNotAvailableError`, `setCapabilityRegistry()` bootstrap setter, `capabilities` proxy singleton |
| `src/core/__tests__/capabilities.test.ts` | Unit tests — default-registry behavior, swap behavior, lock behavior, `list()` readonly compile-time check |
| `docs/architecture/capability-registry.md` | Architecture doc — purpose, API reference, usage pattern, Enterprise override, lock semantics |

### Modified files

| File | Change |
|---|---|
| `docs/architecture/code-structure.md` | Add one line under the `## Core (src/core/)` section, describing `capabilities.ts` |
| `docs/architecture/README.md` | Add one row to the "Documentation index" table pointing to `capability-registry.md` |

### Untouched

- `src/lib/errors.ts` — we only import `ClawPilotError` from it; no modification.
- Root `CLAUDE.md` — its `src/` listing is directory-granularity; individual module docs belong in `docs/architecture/*` (deviation from spec §7.2 noted and confirmed; the spec's goal of "pointer from top-level doc" is satisfied via `code-structure.md` + `README.md`).
- `ai-docs/plan-enterprise-edition.md` — already describes H5, not edited.

---

## Task 1: Scaffold the test file (RED for all cases)

**Rationale:** TDD — write every test first, confirm they fail because the module does not exist yet, then implement.

**Files:**
- Create: `src/core/__tests__/capabilities.test.ts`

- [ ] **Step 1.1: Create the test file with the full suite**

Write the file below **verbatim**. The `// @ts-expect-error` in test 8 is intentional — it acts as a compile-time assertion that `list()` returns a `readonly` array.

```typescript
// src/core/__tests__/capabilities.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";

import { ClawPilotError } from "../../lib/errors.js";

// We re-import the module inside each test via dynamic import + vi.resetModules(),
// so that the module-level `locked` boolean is fresh for every case.
type CapabilitiesModule = typeof import("../capabilities.js");

async function loadModule(): Promise<CapabilitiesModule> {
  vi.resetModules();
  return await import("../capabilities.js");
}

describe("capabilities — Community default registry", () => {
  let mod: CapabilitiesModule;

  beforeEach(async () => {
    mod = await loadModule();
  });

  it("has() returns false for every enterprise capability", () => {
    expect(mod.capabilities.has("sso-oidc")).toBe(false);
    expect(mod.capabilities.has("rbac-fine")).toBe(false);
    expect(mod.capabilities.has("vault-secrets")).toBe(false);
  });

  it("require() throws CapabilityNotAvailableError with code CAPABILITY_NOT_AVAILABLE", () => {
    let thrown: unknown;
    try {
      mod.capabilities.require("rbac-fine");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(mod.CapabilityNotAvailableError);
    expect(thrown).toBeInstanceOf(ClawPilotError);
    expect((thrown as InstanceType<typeof mod.CapabilityNotAvailableError>).code).toBe(
      "CAPABILITY_NOT_AVAILABLE",
    );
    expect((thrown as Error).message).toContain("rbac-fine");
  });

  it("list() returns an empty array", () => {
    expect(mod.capabilities.list()).toEqual([]);
  });

  it("list() return type is readonly at compile time", async () => {
    const list = mod.capabilities.list();
    // @ts-expect-error readonly array must reject .push()
    list.push("sso-oidc");
    // Runtime assertion is incidental; the compile-time check is what matters.
    expect(Array.isArray(list)).toBe(true);
  });
});

describe("capabilities — setCapabilityRegistry()", () => {
  let mod: CapabilitiesModule;

  beforeEach(async () => {
    mod = await loadModule();
  });

  it("replaces the default registry — proxy reflects the swap", () => {
    const fake: import("../capabilities.js").CapabilityRegistry = {
      has: (cap) => cap === "sso-oidc",
      require: (cap) => {
        if (cap !== "sso-oidc") throw new mod.CapabilityNotAvailableError(cap);
      },
      list: () => ["sso-oidc"],
    };

    mod.setCapabilityRegistry(fake);

    expect(mod.capabilities.has("sso-oidc")).toBe(true);
    expect(mod.capabilities.has("rbac-fine")).toBe(false);
    expect(mod.capabilities.list()).toEqual(["sso-oidc"]);
    expect(() => mod.capabilities.require("sso-oidc")).not.toThrow();
    expect(() => mod.capabilities.require("rbac-fine")).toThrow(mod.CapabilityNotAvailableError);
  });

  it("throws CAPABILITY_REGISTRY_LOCKED on a second call", () => {
    const fake1: import("../capabilities.js").CapabilityRegistry = {
      has: () => false,
      require: () => {},
      list: () => [],
    };
    const fake2: import("../capabilities.js").CapabilityRegistry = {
      has: () => true,
      require: () => {},
      list: () => ["audit-siem"],
    };

    mod.setCapabilityRegistry(fake1);

    let thrown: unknown;
    try {
      mod.setCapabilityRegistry(fake2);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ClawPilotError);
    expect((thrown as InstanceType<typeof ClawPilotError>).code).toBe(
      "CAPABILITY_REGISTRY_LOCKED",
    );
    // First registry must still be active.
    expect(mod.capabilities.list()).toEqual([]);
    expect(mod.capabilities.has("audit-siem")).toBe(false);
  });
});
```

- [ ] **Step 1.2: Run the file and confirm every case fails**

Run:
```bash
pnpm vitest run src/core/__tests__/capabilities.test.ts
```

Expected output: **FAIL**, with errors about `Cannot find module '../capabilities.js'` (or equivalent). This confirms the test harness actually executes the file and that the tests are wired correctly.

Do **not** move to Task 2 until you see a red run with the expected "module not found" cause.

---

## Task 2: Implement `src/core/capabilities.ts` (GREEN)

**Rationale:** Minimum code that turns the full test suite green. No extra features.

**Files:**
- Create: `src/core/capabilities.ts`

- [ ] **Step 2.1: Create the implementation file**

Write the file below **verbatim**:

```typescript
// src/core/capabilities.ts
import { ClawPilotError } from "../lib/errors.js";

/**
 * Enterprise-only capabilities. Always false in the Community edition.
 *
 * This union is the single source of truth for differentiation between
 * Community and Enterprise behavior. Adding a new capability means adding
 * a member here, then updating `docs/architecture/capability-registry.md`.
 */
export type EnterpriseCapability =
  | "sso-oidc"
  | "sso-saml"
  | "sso-azuread"
  | "rbac-fine"
  | "abac"
  | "audit-siem"
  | "audit-immutable"
  | "multi-server"
  | "multi-tenant"
  | "plugin-signature"
  | "vault-secrets";

/**
 * Every known capability.
 *
 * Core capabilities (always-true in both editions) may be folded into this
 * union later, on demand, when a concrete gating need emerges. There is no
 * core capability today — the registry exists purely to gate enterprise
 * features without relying on forbidden `if (isEnterprise)` branches.
 */
export type Capability = EnterpriseCapability;

/**
 * Contract consumed by every call site that needs to know whether a given
 * capability is enabled in the current edition.
 */
export interface CapabilityRegistry {
  has(cap: Capability): boolean;
  /** Throws `CapabilityNotAvailableError` if the capability is disabled. */
  require(cap: Capability): void;
  list(): readonly Capability[];
}

/**
 * Thrown by `capabilities.require()` when the requested capability is not
 * enabled. Carries the standard `ClawPilotError` contract (string `code`).
 */
export class CapabilityNotAvailableError extends ClawPilotError {
  constructor(cap: Capability) {
    super(
      `Capability "${cap}" is not available in this edition`,
      "CAPABILITY_NOT_AVAILABLE",
    );
  }
}

/** Default Community implementation: no enterprise capability enabled. */
class CommunityCapabilityRegistry implements CapabilityRegistry {
  has(_cap: Capability): boolean {
    return false;
  }

  require(cap: Capability): void {
    throw new CapabilityNotAvailableError(cap);
  }

  list(): readonly Capability[] {
    return [];
  }
}

let current: CapabilityRegistry = new CommunityCapabilityRegistry();
let locked = false;

/**
 * Replace the default registry. Must be called exactly once, early in the
 * bootstrap path, before any consumer reads `capabilities`. A second call
 * throws a `ClawPilotError` with code `CAPABILITY_REGISTRY_LOCKED`.
 *
 * Community never calls this function. Enterprise calls it from its own
 * `src/index.ts` before any other core module is imported transitively.
 */
export function setCapabilityRegistry(impl: CapabilityRegistry): void {
  if (locked) {
    throw new ClawPilotError(
      "CapabilityRegistry already locked — setCapabilityRegistry() must be called exactly once during bootstrap",
      "CAPABILITY_REGISTRY_LOCKED",
    );
  }
  current = impl;
  locked = true;
}

/**
 * Singleton accessor. Delegating proxy so consumers can import once and
 * keep a stable reference even though Enterprise may swap the underlying
 * registry at bootstrap.
 */
export const capabilities: CapabilityRegistry = {
  has: (cap) => current.has(cap),
  require: (cap) => current.require(cap),
  list: () => current.list(),
};
```

- [ ] **Step 2.2: Run the full test file, confirm GREEN**

Run:
```bash
pnpm vitest run src/core/__tests__/capabilities.test.ts
```

Expected output: `Test Files  1 passed`, `Tests  6 passed`.

- [ ] **Step 2.3: Run typecheck**

Run:
```bash
pnpm typecheck
```

Expected output: `tsc --noEmit` completes with no errors.

- [ ] **Step 2.4: Run lint**

Run:
```bash
pnpm lint
```

Expected output: oxlint completes with no errors or warnings on `src/core/capabilities.ts` or the test file.

- [ ] **Step 2.5: Run format check**

Run:
```bash
pnpm format:check
```

Expected output: prettier reports no style drift.
If it does drift, run `pnpm format` to fix, then re-run `pnpm format:check`.

- [ ] **Step 2.6: Run spellcheck**

Run:
```bash
pnpm spellcheck
```

Expected output: cspell finds no unknown words in the new files. If it flags a word (unlikely — `oidc`, `saml`, `rbac`, `abac`, `siem`, `azuread` are standard acronyms and should already be in the project dictionary), add the exact word to `cspell.json`'s allowlist rather than disabling the check inline.

- [ ] **Step 2.7: Run the full test suite once**

Run:
```bash
pnpm test:run
```

Expected output: the pre-push gate equivalent passes. No existing test regresses (the new module has no consumer yet, so no regression risk is theoretical, but run the suite anyway to match lefthook behavior).

---

## Task 3: Commit the module with the `Extension-Point` trailer

**Rationale:** `src/core/` is a frozen path per discipline rule R3. The trailer is mandatory on any commit that modifies frozen paths.

**Files:**
- Stage: `src/core/capabilities.ts`, `src/core/__tests__/capabilities.test.ts`

- [ ] **Step 3.1: Confirm nothing else is staged**

Run:
```bash
git status
```

Expected: the only unstaged or untracked paths are the two new files (plus any doc files written in later tasks, but those stay unstaged for now).

- [ ] **Step 3.2: Stage only the module + its test**

Run:
```bash
git add src/core/capabilities.ts src/core/__tests__/capabilities.test.ts
```

- [ ] **Step 3.3: Commit with the mandatory trailer**

Run:
```bash
git commit -m "$(cat <<'EOF'
feat(core): add CapabilityRegistry (H5)

Single differentiation point between Community and Enterprise editions.
Community ships with a default registry that reports zero enterprise
capabilities enabled. Enterprise will replace it once at bootstrap via
setCapabilityRegistry(). A one-shot lock prevents mid-run swaps.

Implements hook H5 from ai-docs/plan-enterprise-edition.md. Consumers
(H1–H4, H6, H7) will land in subsequent PRs.

Extension-Point: CapabilityRegistry
EOF
)"
```

Expected: lefthook runs format-check, lint, typecheck; commitlint validates the subject. Commit succeeds.

- [ ] **Step 3.4: Verify the trailer landed in the commit**

Run:
```bash
git log -1 --format=%B
```

Expected: the commit message ends with exactly `Extension-Point: CapabilityRegistry` as its own line, with no trailing content. If it does not, run `git commit --amend` and re-run the verification.

---

## Task 4: Write the architecture documentation

**Rationale:** The spec §7 requires a dedicated architecture doc. Other consumers (future H1–H4 PRs, Enterprise developers) will read it to know how to use the registry and how to plug their own implementation.

**Files:**
- Create: `docs/architecture/capability-registry.md`

- [ ] **Step 4.1: Create the doc file**

Write the file below **verbatim**:

````markdown
# Capability Registry

> Part of [claw-pilot Functional Architecture](README.md)

---

## Purpose

The `CapabilityRegistry` is the **single differentiation point** between the
Community edition (this repository, MIT) and the Enterprise edition (private
fork). Every feature that must behave differently between editions — SSO,
fine-grained RBAC, multi-server, audit SIEM export, plugin signature
verification, and so on — calls `capabilities.has(...)` or
`capabilities.require(...)` instead of branching on an edition flag.

This mechanism replaces every `if (isEnterprise)`, `if (process.env.ENTERPRISE)`,
or `license.tier === …` pattern. The discipline rule R1 (`no-enterprise-flag`,
documented in the root `CLAUDE.md`) forbids those patterns everywhere in the
codebase; `capabilities.has(...)` is the only supported alternative.

## Module

`src/core/capabilities.ts` — single file, no subfolder.

## API reference

### Types

```typescript
export type EnterpriseCapability =
  | "sso-oidc" | "sso-saml" | "sso-azuread"
  | "rbac-fine" | "abac"
  | "audit-siem" | "audit-immutable"
  | "multi-server" | "multi-tenant"
  | "plugin-signature" | "vault-secrets";

export type Capability = EnterpriseCapability;

export interface CapabilityRegistry {
  has(cap: Capability): boolean;
  require(cap: Capability): void;  // throws CapabilityNotAvailableError
  list(): readonly Capability[];
}
```

### Errors

- `CapabilityNotAvailableError` — subclass of `ClawPilotError`, `code === "CAPABILITY_NOT_AVAILABLE"`. Thrown by `require()` when the capability is disabled.
- `ClawPilotError` with `code === "CAPABILITY_REGISTRY_LOCKED"` — thrown by `setCapabilityRegistry` when invoked a second time.

### Exports

- `capabilities: CapabilityRegistry` — the proxy singleton. Import this in consumer code.
- `setCapabilityRegistry(impl: CapabilityRegistry): void` — bootstrap-time setter. **Never called from Community code.**

## Usage pattern

### Reading a capability

Import the singleton once at the top of the module:

```typescript
import { capabilities } from "../core/capabilities.js";
```

Branch on availability:

```typescript
if (capabilities.has("sso-oidc")) {
  // enterprise-only branch
}
```

Or fail fast at the top of a code path that cannot run without the capability:

```typescript
capabilities.require("audit-siem");
// proceed, knowing the capability is enabled
```

### Do not

- Do **not** import `CommunityCapabilityRegistry` directly. It is an internal class.
- Do **not** call `setCapabilityRegistry` from Community code. It is the Enterprise override hook.
- Do **not** cache the result of `capabilities.has()` across process lifetimes — Enterprise may call `setCapabilityRegistry` between process starts, but never within a running process.

## Adding a new capability

1. Add the new string literal to the `EnterpriseCapability` union in `src/core/capabilities.ts`.
2. Update the "API reference → Types" section above with the new member.
3. That is all — no DB migration, no config entry, no wiring.

## Enterprise override mechanism

Enterprise ships its own bootstrap file (`src/index.ts` in the private repo)
that calls `setCapabilityRegistry` once, **before any other core module is
imported transitively**. The recommended pattern:

```typescript
// Enterprise repo — src/index.ts
import { setCapabilityRegistry, type Capability, type CapabilityRegistry, CapabilityNotAvailableError } from "./core/capabilities.js";
import { parseLicence } from "./licence.js";

const enabled: Set<Capability> = parseLicence(process.env.CP_LICENCE_JWT);

const enterpriseRegistry: CapabilityRegistry = {
  has: (cap) => enabled.has(cap),
  require: (cap) => {
    if (!enabled.has(cap)) throw new CapabilityNotAvailableError(cap);
  },
  list: () => Array.from(enabled),
};

setCapabilityRegistry(enterpriseRegistry);
// … rest of bootstrap
```

The `capabilities` proxy singleton transparently routes all subsequent
`has`/`require`/`list` calls to the newly registered implementation, even
for modules that imported `capabilities` before the `setCapabilityRegistry`
call. This is achieved by closing over a module-level `current` reference
rather than exporting the registry object directly.

### Lock semantics

The first successful call to `setCapabilityRegistry` flips a module-scoped
`locked` boolean. Any later call throws `ClawPilotError(code: "CAPABILITY_REGISTRY_LOCKED")`.
This guarantees that the registry is stable for the lifetime of the
process and that no test, plugin, or runtime hook can replace it mid-run.

### Timing

Enterprise must call `setCapabilityRegistry` **before**:
- Any route handler runs.
- Any CLI command dispatches to `src/commands/`.
- Any long-lived subsystem (dashboard HTTP server, daemon, scheduler) starts
  importing modules that read `capabilities`.

In practice this means calling it at the top of `src/index.ts` of the
Enterprise distribution, above all other imports that transitively touch
`src/core/`.

## Testing guidance

Consumer tests that depend on a specific capability being enabled should
use `vi.resetModules()` followed by a dynamic re-import of
`@/core/capabilities`, register a fake registry with the required `has`
behavior, and only then import the module under test. See
`src/core/__tests__/capabilities.test.ts` for the pattern.

## Relationship to other hooks

| Hook | Consumes `capabilities.has(...)` for … |
|---|---|
| H1 — permission middleware | `rbac-fine`, `abac` |
| H2 — `AuthProvider` | `sso-oidc`, `sso-saml`, `sso-azuread` |
| H3 — `ServerRegistry` | `multi-server`, `multi-tenant` |
| H4 — `SecretProvider` | `vault-secrets` |
| H6 — audit event bus | `audit-siem`, `audit-immutable` |
| H7 — plugin signature hook | `plugin-signature` |

Each of those hooks ships in its own PR after H5 is merged.
````

- [ ] **Step 4.2: Verify the file renders correctly**

Run:
```bash
pnpm spellcheck
```

Expected: no new unknown words. If any are flagged, add them to `cspell.json` rather than `<!-- cSpell:ignore ... -->` inline directives.

---

## Task 5: Link the new doc from existing indexes

**Rationale:** Readers find `capability-registry.md` through `code-structure.md` (when browsing by source location) and `README.md` (when browsing by topic). Both must be updated in the same commit.

**Files:**
- Modify: `docs/architecture/code-structure.md`
- Modify: `docs/architecture/README.md`

- [ ] **Step 5.1: Add the entry in `code-structure.md`**

Open `docs/architecture/code-structure.md`. Find the `## Core (`src/core/`)` section (around line 34) and its fenced code block listing core modules. Add a new line for `capabilities.ts` immediately after the existing `registry-types.ts` line (keep alphabetical-ish grouping; place it at the top of the block if alphabetical beats current order — currently the order is logical not alphabetical, so inserting it after `registry-types.ts` is correct because both define types consumed elsewhere).

The resulting block should contain this new line:

```
capabilities.ts           edition differentiation — see docs/architecture/capability-registry.md
```

Use `Edit` with a unique surrounding context — for example, anchor on the existing `registry-types.ts` line to avoid ambiguous matches.

- [ ] **Step 5.2: Add the entry in `README.md`**

Open `docs/architecture/README.md`. In the "Documentation index" table (around line 51), add a new row **after** the `Runtime Engine` row and **before** the `SSE Architecture` row:

```
| **[Capability Registry](capability-registry.md)** | Community/Enterprise differentiation hook, `capabilities.has(...)` contract | Adding enterprise-gated features or writing a consumer hook |
```

Use `Edit` with the `Runtime Engine` row as anchor to locate the insertion.

- [ ] **Step 5.3: Verify the changes render**

Run:
```bash
pnpm spellcheck
```

Expected: passes. If a word is flagged, add it to `cspell.json`.

---

## Task 6: Commit the documentation

**Rationale:** Docs are a separate logical unit from the code. Separate commit makes the history readable and keeps the frozen-path trailer attached exclusively to the code commit.

**Files:**
- Stage: `docs/architecture/capability-registry.md`, `docs/architecture/code-structure.md`, `docs/architecture/README.md`

- [ ] **Step 6.1: Stage only the doc files**

Run:
```bash
git add docs/architecture/capability-registry.md docs/architecture/code-structure.md docs/architecture/README.md
git status
```

Expected: exactly three files staged, nothing else.

- [ ] **Step 6.2: Commit**

Run:
```bash
git commit -m "$(cat <<'EOF'
docs(core): document CapabilityRegistry (H5)

Architecture doc covering the API, usage pattern, adding a capability,
the Enterprise override mechanism with lock semantics, and the mapping
from each upcoming hook (H1–H7) to the capability it will consume.

Linked from docs/architecture/code-structure.md and README.md index.
EOF
)"
```

Expected: lefthook runs; commit succeeds.

- [ ] **Step 6.3: Run the full gate once**

Run:
```bash
pnpm test:run && pnpm typecheck:all && pnpm lint:all && pnpm format:check && pnpm spellcheck
```

Expected: every command exits 0. This mirrors what CI will run after the push.

---

## Task 7: Push and open the pull request

**Rationale:** Feature branches merge to `develop` through GitHub PRs only, per the root-level `CLAUDE.md` gitflow rules. No local merge.

- [ ] **Step 7.1: Push the branch**

Run:
```bash
git push -u origin feature/capability-registry
```

Expected: the pre-push hook runs `pnpm test:run`, `pnpm spellcheck`, and the no-silent-catches gate; then the push completes and GitHub returns the URL to open a PR.

- [ ] **Step 7.2: Verify CI goes green on GitHub**

Watch the CI run on the branch. Do **not** open the PR before CI is green — opening a PR with a red CI adds noise and reviewers may bounce it.

Run (optional):
```bash
gh run watch
```

Expected: all checks succeed.

- [ ] **Step 7.3: Open the PR against `develop`**

Run:
```bash
gh pr create --base develop --title "feat(core): add CapabilityRegistry (H5)" --body "$(cat <<'EOF'
## Summary

Adds the `CapabilityRegistry` hook — hook H5 of 9 in the Enterprise-Edition
preparation phase (see `ai-docs/plan-enterprise-edition.md` §H5).

Community ships with a default implementation that reports zero enterprise
capabilities enabled. Enterprise will replace it once at bootstrap via
`setCapabilityRegistry()`. A one-shot lock prevents mid-run swaps.

No consumer yet — H1 through H7 will land in subsequent PRs and each will
call `capabilities.has(...)` to gate its enterprise-only branches.

## Scope

- `src/core/capabilities.ts` (new)
- `src/core/__tests__/capabilities.test.ts` (new)
- `docs/architecture/capability-registry.md` (new)
- `docs/architecture/code-structure.md` (one line added)
- `docs/architecture/README.md` (one row added)

## Discipline

- Commit that adds `src/core/capabilities.ts` carries the trailer
  `Extension-Point: CapabilityRegistry` (rule R3 — frozen path).
- No `if (isEnterprise)` introduced (rule R1).
- No new resource table, so no `org_id` slot needed (rule R2 N/A).
- No secret access (rule R5 N/A).

## References

- Spec: `docs/superpowers/specs/2026-04-20-capability-registry-design.md`
- Plan: `docs/superpowers/plans/2026-04-20-capability-registry.md`
- Macro plan: `ai-docs/plan-enterprise-edition.md` §H5

## Test plan

- [x] `pnpm test:run` green locally.
- [x] `pnpm typecheck:all` green locally.
- [x] `pnpm lint:all` green locally.
- [x] `pnpm format:check` green locally.
- [x] `pnpm spellcheck` green locally.
- [ ] GitHub CI green on the branch.
- [ ] MAC deploy of the feature branch for smoke validation (no user-facing surface, but follows the workflow).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: `gh` returns the PR URL.

- [ ] **Step 7.4: Report the PR URL**

Print the PR URL to the terminal so the user can review it. Do **not** merge locally — the PR goes through GitHub review and optional MAC deploy first.

---

## Self-review checklist (done by the plan author)

- **Spec coverage.** Every section of the spec has a task:
  - §5.2 API → Task 2.
  - §6 Testing (cases 1–8) → Task 1 (6 tests folded, covering every spec case; `list()` readonly is one test with the `@ts-expect-error` assertion per spec §6.3 row #8).
  - §7 Documentation → Tasks 4 & 5.
  - §8 Scope → Tasks 2, 4, 5. Root `CLAUDE.md` update dropped in favor of `code-structure.md` + `README.md` link; rationale documented in the plan's "File plan → Untouched" section.
  - §9 Commit discipline → Tasks 3 & 6 (trailer enforced in Task 3, separate docs commit in Task 6).
  - §10 PR checklist → Task 7.
- **Placeholder scan.** No "TBD", no "TODO", no "similar to Task N"; every step contains the actual code or exact command.
- **Type consistency.** `Capability`, `EnterpriseCapability`, `CapabilityRegistry`, `CapabilityNotAvailableError`, `setCapabilityRegistry`, `capabilities` used identically across Tasks 1, 2, 4. Error codes `CAPABILITY_NOT_AVAILABLE` and `CAPABILITY_REGISTRY_LOCKED` appear identically in the test (Task 1) and the implementation (Task 2).
- **Deviation from spec.** One: `CLAUDE.md` (root worktree) is not edited; `docs/architecture/code-structure.md` and `docs/architecture/README.md` are edited instead. Reason: root `CLAUDE.md`'s `src/` listing is directory-granularity and does not list individual files, so adding one would break its existing pattern. The spec's intent ("top-level pointer to the new doc") is satisfied by `code-structure.md` + `README.md`, which are the existing top-level indexes for the architecture doc family.
