# Runbook — claw-pilot Deployment

## Workflow — GitHub Flow

Each feature = dedicated branch. MACMINI-INT serves as integration server.
Exception: hotfixes (urgent fixes) can go directly to main.

```
local feature branch
       |
       v
dev + typecheck + build local
       |
       v
MANDATORY LOCAL CI/CD VALIDATION  <-- see section below
       |
       v
push origin feature/xxx
       |
       v
GitHub CI/CD passes (green)  <-- verify before continuing
       |
       v
deploy MACMINI-INT on feature branch
       |
       v
manual testing on MACMINI-INT
       |
    OK |                    KO
       v                     |
GitHub PR -> merge main      +-- fix -> re-validate local -> re-push
       |
       v
deploy VM01 on main  (quick retest mandatory if other commits on main)


--- HOTFIX (urgent fix) ---

local fix on main -> LOCAL CI/CD VALIDATION -> push origin main -> deploy MACMINI-INT
```

---

## LOCAL CI/CD VALIDATION (mandatory before any push)

**These commands exactly reproduce what GitHub CI does.**
Do not push if any of them fail.

```bash
# From claw-pilot/
cd claw-pilot

# 1. Format
pnpm format:check

# 2. Types (CLI + UI)
pnpm typecheck:all

# 3. Lint
pnpm lint:all

# 4. Spell check
pnpm spellcheck

# 5. Tests with coverage  <-- MOST IMPORTANT: must pass without threshold errors
pnpm test:run --coverage

# 6. Dead code
pnpm knip --reporter compact

# 7. Circular imports
pnpm check:circular

# 8. E2E tests (real HTTP server, in-memory DB)
pnpm test:e2e

# 9. Final build (typecheck + build)
pnpm build:safe
```

### All-in-one command (equivalent to CI)

```bash
pnpm format:check && pnpm typecheck:all && pnpm lint:all && pnpm spellcheck && pnpm test:run --coverage && pnpm test:e2e && pnpm knip --reporter compact && pnpm check:circular && pnpm build
```

> **Note**: `pnpm build:safe` (typecheck:all + build) is a safer alternative than `pnpm build` alone.

If everything is green locally, GitHub CI should pass.

---

## Known CI/CD pitfalls

### Coverage below threshold (most common cause)

**CI symptom:**
```
ERROR: Coverage for lines (X%) does not meet global threshold (Y%)
Process completed with exit code 1.
```

**Cause:** New code was added without corresponding tests, causing coverage percentage
to fall below the threshold defined in `vitest.config.ts`.

**Local detection:**
```bash
pnpm test:run --coverage
# Look for "ERROR: Coverage for..." lines
```

**Fix:**
- Option 1 (preferred): add tests for the new code
- Option 2 (acceptable if code is hard to test — I/O, LLM, filesystem):
  lower the threshold in `vitest.config.ts` with an explanatory comment

```typescript
// vitest.config.ts
thresholds: {
  // Lowered after <commit-ref> (<short reason>)
  lines: 48,      // <-- adjust to actual value - 1
  statements: 48,
  functions: 76,
  branches: 72,
},
```

### GitHub Actions with non-existent version

**CI symptom:**
```
Unable to find version `vX.Y`. Unable to resolve action `actions/checkout@vX.Y`
```

**Cause:** GitHub Actions tags of type `@vX.Y` don't exist — only major tags (`@v4`)
or exact patches (`@v4.2.2`) are valid.

**Fix:** Pin to SHA digest with version comment:
```yaml
- uses: actions/checkout@<SHA-40-chars> # vX.Y.Z
```

**Prevention:** Dependabot is configured (`.github/dependabot.yml`) to automatically
propose updates every Monday.

### GitHub Actions with deprecated Node.js 20

**CI symptom:**
```
Node.js 20 actions are deprecated. Actions will be forced to run with Node.js 24...
```

**Cause:** The actions used are based on node20. GitHub will force node24
starting June 2, 2026.

**Fix:** Migrate to the following major versions that include node24:
- `actions/checkout`: v6+
- `actions/setup-node`: v6+
- `actions/upload-artifact`: v7+

Check an action's runtime:
```bash
gh api "repos/<owner>/<action>/contents/action.yml?ref=<tag>" --jq '.content' | base64 -d | grep "using:"
```

### Security audit fails

**CI symptom:**
```
X vulnerabilities found — high severity
```

**Local detection:**
```bash
pnpm audit --audit-level=high
```

**Fix:** Update the vulnerable package or add a documented exception.

---

## Deployment to MACMINI-INT (integration)

### Prerequisites

- Node.js and pnpm installed on MACMINI-INT
- launchd service configured: `io.claw-pilot.dashboard`

### Feature branch

```bash
# 1. Push branch from local
git push origin feature/my-feature

# 2. Deploy to MACMINI-INT
ssh swoelffel@macmini.thiers '
  cd /opt/claw-pilot
  git fetch origin
  git checkout feature/my-feature
  git pull

  # Build with full PATH (nvm)
  export PATH="/Users/swoelffel/.nvm/versions/node/v24.14.0/bin:$PATH"
  pnpm install --frozen-lockfile
  pnpm build

  # RESTART DASHBOARD (MANDATORY after each build)
  launchctl restart io.claw-pilot.dashboard
'

# 3. Verify
ssh swoelffel@macmini.thiers '
  export PATH="/Users/swoelffel/.nvm/versions/node/v24.14.0/bin:$PATH"
  curl -s http://localhost:19000 | head -5
'
```

### Return to main (after PR merge)

```bash
ssh swoelffel@macmini.thiers '
  cd /opt/claw-pilot
  git checkout main
  git pull

  export PATH="/Users/swoelffel/.nvm/versions/node/v24.14.0/bin:$PATH"
  pnpm install --frozen-lockfile
  pnpm build

  launchctl restart io.claw-pilot.dashboard
'
```

### Integration dashboard access

```
URL: http://macmini.thiers:19000
SSH: ssh swoelffel@macmini.thiers
```

---

## Known deployment pitfalls

- **MACMINI-INT: always restart dashboard after build**
  - The launchd service does not automatically reload compiled code
  - After `pnpm build`, run: `launchctl restart io.claw-pilot.dashboard`
  - Verify with: `curl http://localhost:19000 | head -5`

- **MACMINI-INT: nvm PATH required**
  - In SSH session, export: `export PATH="/Users/swoelffel/.nvm/versions/node/v24.14.0/bin:$PATH"`
  - Without this, `pnpm` and `npm` won't be found

---

## Rollback

In case of problems after deployment:

### Quick rollback (MACMINI-INT)

```bash
ssh swoelffel@macmini.thiers '
  cd /opt/claw-pilot
  export PATH="/Users/swoelffel/.nvm/versions/node/v24.14.0/bin:$PATH"

  # Identify last working commit
  git log --oneline -10

  # Rollback to specific commit
  git checkout <commit-hash>
  pnpm install --frozen-lockfile
  pnpm build
  launchctl restart io.claw-pilot.dashboard
'
```

### Branch rollback (return to main)

```bash
ssh swoelffel@macmini.thiers '
  cd /opt/claw-pilot
  export PATH="/Users/swoelffel/.nvm/versions/node/v24.14.0/bin:$PATH"
  git checkout main
  git pull
  pnpm install --frozen-lockfile
  pnpm build
  launchctl restart io.claw-pilot.dashboard
'
```

**Important**: DB migrations are irreversible (additive-only). A code rollback does NOT
rollback the DB schema. If a migration was added, the running code must be compatible
with the newer schema.
