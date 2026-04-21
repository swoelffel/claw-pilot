# Contributing to claw-pilot

Thank you for your interest in contributing to claw-pilot! We welcome bug reports, feature requests, documentation improvements, and code contributions.

**Questions?** → [Discussions (Q&A)](https://github.com/swoelffel/claw-pilot/discussions/categories/q-a)
**Ideas?** → [Discussions (Ideas)](https://github.com/swoelffel/claw-pilot/discussions/categories/ideas)
**Bugs / Tasks?** → [Issues](https://github.com/swoelffel/claw-pilot/issues)

## Code of Conduct

Please read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) (short and lightweight). We expect all contributors to maintain a respectful and collaborative environment.

## Project Setup

### Prerequisites

- **Node.js**: >= 22.12.0
- **pnpm**: 10.33.0 (pinned via `packageManager` field in `package.json`)
- **Operating System**: Linux (Ubuntu/Debian) or macOS — systemd user services on Linux, launchd on macOS
- **Git**: For version control

### Repository Install

```sh
git clone https://github.com/swoelffel/claw-pilot.git
cd claw-pilot
pnpm install
pnpm build
```

`pnpm install` triggers `lefthook install`, which registers pre-commit and pre-push hooks. **Do not skip hooks** (no `--no-verify`) — CI runs the same checks and will reject the PR.

## How to Run

### Dev mode (CLI + UI with hot reload)

```sh
pnpm dev
```

### Logs

- **CLI logs**: stdout/stderr
- **Dashboard logs**: stdout when running via `claw-pilot dashboard`
- **Instance logs**: `claw-pilot logs <slug>` (use `-f` for live tail)

## Git workflow — **READ BEFORE YOUR FIRST PR**

claw-pilot uses a **strict gitflow**. Getting this right prevents the single most common source of friction for new contributors.

### Branch structure

| Branch | Role | Who writes to it |
|---|---|---|
| `main` | Production stable | **Only** release PRs from `develop` (version bump + tag) |
| `develop` | Integration branch | All feature PRs merge here first |
| `feature/*` | Your work | You branch off `develop` and PR back to `develop` |

### The golden rules

1. **Always branch off `develop`**, never `main`. `main` is behind `develop` most of the time.
2. **Always PR against `develop`**, never `main`. PRs targeting `main` will be closed and asked to retarget.
3. **Never bump `package.json` version in a feature PR.** The version bump is reserved for release PRs (`develop → main`) by the maintainer. Bumping in a feature PR causes hard merge conflicts the moment anyone else's PR lands.
4. **Never push directly to `develop` or `main`.** Use a feature branch and open a PR, even for one-line fixes.

### Recommended flow

```sh
# 1. Sync develop
git checkout develop
git pull origin develop

# 2. Create feature branch
git checkout -b feature/your-feature-name

# 3. Code, commit (conventional commits — see below), push
git push -u origin feature/your-feature-name

# 4. Open PR via GitHub CLI or web UI — target MUST be develop
gh pr create --base develop --title "feat: ..." --body "..."
```

### Branch naming

- Features: `feature/kebab-case-description`
- Bug fixes: `fix/kebab-case-description`
- Documentation: `docs/kebab-case-description`
- One branch = one PR = one focused change.

### Conventional commits (enforced by commitlint)

Commit subjects follow [conventional commits](https://www.conventionalcommits.org/) and must be **lowercase**:

```
feat(scope): short imperative description
fix(scope): short imperative description
docs(scope): short imperative description
chore(scope): short imperative description
refactor(scope): short imperative description
test(scope): short imperative description
```

Examples:
- `feat(dashboard): add keyless provider support to named-keys`
- `fix(ui): reset part-question state on call prop change`
- `docs(contributing): clarify develop-first workflow`

The commit-msg lefthook runs `commitlint` — invalid subjects are rejected locally before you can push.

## Pre-commit and pre-push hooks (lefthook)

Registered automatically by `pnpm install`. They exist to keep CI fast and green.

| Stage | Checks |
|---|---|
| **pre-commit** | `prettier --check`, `oxlint --deny-warnings`, `tsc --noEmit` (backend + UI) |
| **commit-msg** | `commitlint` (conventional commits, lowercase subject) |
| **pre-push** | `vitest run`, `cspell`, `no-silent-catches` gate, `knip`, `madge` circular-check, full `pnpm build` |

If a hook fails, **fix the underlying issue** — don't skip with `--no-verify`. CI enforces the same rules and your PR will be rejected anyway.

## Testing & Quality

### Run the full local check suite before pushing

```sh
pnpm typecheck:all    # tsc --noEmit on backend + UI
pnpm lint:all         # oxlint on src/ + ui/src/
pnpm test:run         # vitest run (~2500 tests)
pnpm format:check     # prettier --check (CI mode)
pnpm spellcheck       # cspell (en + fr)
```

Or run everything at once via the pre-push hook by pushing to a feature branch.

### Running a single test

```sh
pnpm vitest run src/dashboard/__tests__/routes.test.ts
pnpm vitest run -t "POST /api/instances/:slug/start"
```

**PRs must include tests** for any new functionality or bug fix. Coverage thresholds are enforced in `vitest.config.ts`.

## Before making architectural changes

Read the relevant docs in `docs/architecture/` first — design decisions are documented and reviewers will expect your change to fit the existing model.

Key references:
- [docs/architecture/](docs/architecture/) — functional architecture (split into focused files)
- [docs/ux-design.md](docs/ux-design.md) — UX index, tokens, routing, screen/component map
- [docs/registry-db.md](docs/registry-db.md) — SQLite schema reference (migrations are **additive only**)
- [docs/sse-architecture.md](docs/sse-architecture.md) — real-time streaming (SSE + WS)
- [CLAUDE.md](CLAUDE.md) — conventions, naming, common pitfalls (written for AI agents but 100% applicable to humans)

For large changes (> ~200 lines diff or affecting multiple subsystems), **open a Discussion first** to align on approach before writing code.

## Community ↔ Enterprise discipline

claw-pilot is preparing a closed-source Enterprise fork. Five discipline rules exist to keep the Community repo mergeable into Enterprise via byte-identical merges on frozen paths. **They apply to every PR.**

| Rule | What it means in practice |
|---|---|
| R1 — No proprietary flags | Never write `if (process.env.ENTERPRISE)`, `if (isEnterprise)`, `if (license.tier === …)`. Use the `CapabilityRegistry` (`src/core/capabilities.ts`) if you need feature gating. |
| R2 — `org_id` slot on new tables | Every new user-facing table in `src/db/schema.ts` must include `org_id TEXT NULL`. Exceptions (config/lookup/tech tables) go in `scripts/orgid-exceptions.json`. |
| R3 — Extend, don't modify frozen paths | Inside `src/core/`, `src/runtime/`, `src/db/`, `src/dashboard/routes/`, `src/server/` — prefer adding a hook over modifying existing logic. If modification is unavoidable, add a commit trailer `Extension-Point: <hook-name>` explaining what the extension point is. |
| R4 — Enterprise features need a Community hook first | Any Enterprise-bound feature that would touch a frozen path must first land a Community PR adding the extension hook. (Mostly relevant to the maintainer.) |
| R5 — Secrets via `SecretProvider` | Never `process.env.XXX_SECRET` or `fs.readFile('/path/to/secret')`. Use `secretProvider.get(name)`. |

Tooling to enforce these rules automatically (`pnpm lint:discipline`, CI gate) is landing in a future hook (H9). Until then, reviewers check manually. If you're unsure whether your change touches these areas, ask in the PR — the reviewer will guide you.

## Commit & PR Guidelines

### PR Title

Follow conventional commits:
- `feat: add blueprint export functionality`
- `fix: resolve port conflict on instance restart`
- `docs: clarify installation prerequisites`

Keep under 70 characters. Use the body for details.

### PR Size

Keep PRs small and focused. Large PRs are harder to review and more likely to hit merge conflicts. If a change naturally splits into independent pieces, open separate PRs.

### PR Body

Use the [PR template](.github/pull_request_template.md) — it's loaded automatically when you open a PR. The checklist at the bottom is not optional: reviewers use it to triage.

### Linking issues

- `Fixes #123` — closes the issue when the PR merges
- `Closes #123` — synonym of Fixes
- `Relates to #123` — contextual link without auto-close

### UI changes

Include screenshots or a short screen recording demonstrating the change. A before/after pair is even better.

## Fork workflow

External contributors work from a GitHub fork. The flow is identical to the one above — the only difference is `origin` points to your fork and you may want an `upstream` remote pointing to this repo to keep `develop` in sync:

```sh
git clone https://github.com/YOUR_USERNAME/claw-pilot.git
cd claw-pilot
git remote add upstream https://github.com/swoelffel/claw-pilot.git

# Before each new feature branch:
git fetch upstream
git checkout develop
git merge upstream/develop    # or: git rebase upstream/develop
git push origin develop
```

**Note on CI for fork PRs**: GitHub Actions runs a restricted subset on PRs from forks (no secrets available). If a reviewer asks you to run a specific check locally, please do so and paste the output in the PR thread.

## Triage Labels

| Label | Description |
|---|---|
| `good first issue` | Suitable for first-time contributors |
| `help wanted` | Looking for community help |
| `bug` | Something isn't working as expected |
| `feature` | New feature request |
| `docs` | Documentation improvements |
| `refactor` | Code refactoring |
| `question` | General question |

## Security

**Do not file public issues for security vulnerabilities.**

If you discover a security issue:

1. Use the [Security Advisory](https://github.com/swoelffel/claw-pilot/security/advisories) flow on GitHub, or
2. Contact the maintainer directly through GitHub.

We appreciate responsible disclosure and will work with you to address the issue.
