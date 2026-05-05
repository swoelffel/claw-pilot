# CodeQL Triage Policy

Applies to GitHub Advanced Security / CodeQL alerts produced by the
`javascript-typescript` analysis configured in `.github/workflows/ci.yml`.

## Goal

Keep the alert queue at **zero open alerts**, so that any new finding
on a PR is immediately visible and actionable. `UNSTABLE` on a PR must
mean "this PR introduced something," not "we have 28 known noise items."

## When to fix vs. dismiss

### Fix (open a PR)

- The alert is a true positive, even theoretical, in a frozen path
  (`src/core`, `src/runtime`, `src/db`, `src/dashboard`, `src/server`).
  Fixing early preserves the Enterprise byte-identical merge discipline
  (R3 — see `CLAUDE.md`).
- The alert flags a real data-flow a hostile input could exploit.
- The fix is trivial (< 20 lines) and the CodeQL rule is conceptually
  correct even if the current call-site is safe (defense in depth).

### Dismiss

Pick the reason that applies:

| GitHub reason | When to use |
|---------------|-------------|
| `false positive` | CodeQL misreads the data flow or doesn't model the framework (e.g. Lit's `.prop=` binding, LLM-bound output instead of browser). |
| `used in tests` | The flagged code path only runs in `__tests__/` or test fixtures. |
| `won't fix` | True positive but intentional and safe in context (e.g. one-shot admin password display at account creation). |

### Dismiss template

Every dismissal must carry a short justification aimed at the next
reader — another contributor or agent discovering the alert via Security
tab. Acceptable:

> HTML stripping is for LLM consumption only; output is never rendered
> in a browser context, so partial sanitization is acceptable.

Not acceptable:

> false positive

## Process for new alerts

1. A new alert appears on a PR → the PR author investigates **before**
   merging.
2. If it is a true positive introduced by the PR, fix it in the same PR.
3. If it is a false positive, dismiss it immediately with a justification.
4. If it pre-dates the PR (alert was already open on `develop`), mention
   it in the PR body and resolve in a follow-up triage session — do not
   block the PR.

## Suppressing a single line

In rare cases where the alert is intentional and re-occurs on every
scan, add an inline suppression comment **above** the flagged line:

```ts
// codeql[js/clear-text-logging]: intentional. <Why this is safe>.
```

Follow immediately with the suppression reason in the same comment block.
Do not suppress without an explanation.

## Enforcement

Currently CodeQL runs on every push to `main`/`develop` and on every PR.
It is informational only. Once the alert queue reaches zero and stays
there for two release cycles, CodeQL can be promoted to a **required
check** on branch protection for `main` and `develop`.

## References

- Current alerts: https://github.com/swoelffel/claw-pilot/security/code-scanning
- CodeQL JS query help: https://codeql.github.com/codeql-query-help/javascript/
- Triage session log: [`docs/archive/codeql-triage-session-2026-04-21.md`](../archive/codeql-triage-session-2026-04-21.md)
