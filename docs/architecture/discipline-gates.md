# Discipline Gates

> **Status**: shipped in H9 (Phase 0 final hook).
> **Why this exists**: ClawPilot development is increasingly agent-driven. Human PR review can no longer be assumed on every change, so the 5 Community ↔ Enterprise rules (see `CLAUDE.md` §"Discipline Community ↔ Enterprise") are enforced by automated gates in pre-commit and CI.
> **Scope**: Community-side enforcement of **R1, R2, R3, R5**. R4 (Enterprise-only) is enforced in the private `claw-pilot-enterprise` repo.

## Catalogue

| Rule | What it enforces | Where it runs | Gate |
|---|---|---|---|
| **R1** | No proprietary-tier feature flags (`process.env.ENTERPRISE`, `isEnterprise`, `license.tier`, …) — use `capabilities.has(...)` instead | pre-commit + CI | ESLint rule `discipline/no-enterprise-flag` |
| **R2** | Every new table carries the `org_id TEXT NULL` slot (unless allowlisted as global/lookup/infra) | pre-push + CI | `scripts/lint-orgid-slot.ts` |
| **R3** | Commits touching frozen paths (`src/core/`, `src/runtime/`, `src/db/`, `src/dashboard/routes/`, `src/server/`) must carry an `Extension-Point:` trailer | CI only | `scripts/lint-core-modifications.ts` |
| **R5** | No direct secret reads — `process.env.*_KEY|*_TOKEN|…` and `fs.read*("/.../secret")` are forbidden; use `secretProvider.get(name)` | pre-commit + CI | ESLint rule `discipline/no-direct-secret-access` |

R4 (Enterprise hooks coverage) is Community-irrelevant — see `claw-pilot-enterprise` repo.

## Local commands

```bash
pnpm lint:discipline:fast    # ESLint rules only (R1 + R5) — fast
pnpm lint:discipline:full    # + R2 schema check                — pre-push
pnpm lint:discipline:ci      # + R3 commit-trailer check        — CI only
```

## R1 — no-enterprise-flag (ESLint rule)

**Forbidden**:

```typescript
if (process.env.ENTERPRISE) { ... }
if (process.env.IS_ENTERPRISE) { ... }
if (isEnterprise) { ... }
if (license.tier === "enterprise") { ... }
if (user.isPaid) { ... }
```

**Correct**:

```typescript
if (capabilities.has("rbac-fine")) { ... }
capabilities.require("sso-oidc");
```

**Allowlist**: `src/core/capabilities.ts` itself (it documents and defines the concepts).

## R2 — lint-orgid-slot (AST/regex script)

For every table present in `HEAD:src/db/schema.ts` but absent from the base branch, the script requires a column matching `org_id TEXT (NULL|NOT NULL)`.

**Forbidden**:

```sql
CREATE TABLE rt_new_resource (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL
  -- no org_id slot
);
```

**Correct**:

```sql
CREATE TABLE rt_new_resource (
  id INTEGER PRIMARY KEY,
  org_id TEXT NULL,
  user_id TEXT NOT NULL
);
```

**Allowlist** (`scripts/orgid-exceptions.json`): reserved for **global** tables (config, schema metadata, lookup, infra). Any table representing a user resource (agent, workspace, session, audit event, …) MUST include the slot and MUST NOT be listed.

**Base branch resolution**:
1. `GITHUB_BASE_REF` (GitHub PR runs)
2. `LINT_BASE_REF` (manual override)
3. `origin/develop` (local default)

## R3 — lint-core-modifications (CI only)

If any commit in `BASE..HEAD` touches a frozen path (`src/core/`, `src/runtime/`, `src/db/`, `src/dashboard/routes/`, `src/server/`), at least one commit must carry an `Extension-Point:` trailer.

**Correct**:

```
feat(core): add MFA check hook

Extension-Point: mfa-hook
```

**Escape hatch** — add the label `core-modification-approved` on the PR. Reserved for hotfixes with documented justification in the PR body.

Create the label once per repo (one-off setup):

```bash
gh label create core-modification-approved \
  --color FF6B6B \
  --description "Bypasses R3 Extension-Point trailer check — reserved for hotfixes with documented justification in PR body"
```

## R5 — no-direct-secret-access (ESLint rule)

**Forbidden**:

```typescript
const key = process.env.OPENAI_API_KEY;
const token = process.env.TELEGRAM_BOT_TOKEN;
const pw = process.env.SOMETHING_PASSWORD;
fs.readFileSync("/etc/claw/secret");
```

**Correct**:

```typescript
const key = await secretProvider.get("OPENAI_API_KEY");
const token = await secretProvider.get(`telegram-token:${slug}`);
```

**Allowlist**:
- `src/core/secrets/providers/env.ts` — the legitimate env-backed provider
- `src/lib/crypto.ts` — the root `MASTER_ENCRYPTION_KEY` (chicken/egg; everything else derives from it)
- `**/__tests__/**` — test fixtures
- `src/e2e/**` — integration tests

## Sync-back workflow

`.github/workflows/sync-main-to-develop.yml` auto-merges `main` back into `develop` after each release PR lands. This eliminates the drift caused by GitHub's merge commit (observed twice in H4 / H7).

- **No conflict** → direct push to `develop` (no intermediate PR, zero noise).
- **Conflict** → a draft PR with label `sync-conflict` is opened for manual resolution.
- **Push rejected** (e.g. branch protection) → a secondary sync PR is opened automatically.

## References

- `CLAUDE.md` §"Discipline Community ↔ Enterprise" — canonical rules
- `ai-docs/plan-enterprise-edition.md` — full rationale for the Community/Enterprise split
- `ai-docs/brief-h9-discipline-gates.md` — H9 implementation brief
