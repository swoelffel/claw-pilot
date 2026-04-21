## Summary

<!-- What does this PR do and why is it needed? -->

## Type of change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Documentation update
- [ ] Refactoring (no functional changes)
- [ ] Chore (build, CI, or other maintenance changes)
- [ ] Build / CI changes

## How to test

<!-- Provide steps to test this change -->

1.
2.
3.

## Screenshots / GIFs

<!-- For UI changes, include screenshots or GIFs demonstrating the change -->

## Checklist

**Workflow** (see [CONTRIBUTING.md](../CONTRIBUTING.md) — getting these wrong will block the merge):

- [ ] Base branch is `develop` (not `main`)
- [ ] `package.json` version is **not** bumped (reserved for release PRs)
- [ ] Branch follows `feature/*`, `fix/*`, or `docs/*` naming
- [ ] Commits follow conventional commits (lowercase subject, enforced by commitlint)

**Quality**:

- [ ] `pnpm typecheck:all && pnpm lint:all && pnpm test:run` passes locally
- [ ] `pnpm format:check` passes (run `pnpm format` if not)
- [ ] I did **not** skip lefthook hooks with `--no-verify`
- [ ] Tests added/updated for new behaviour
- [ ] Documentation updated if needed
- [ ] Relevant issues linked (e.g., `Fixes #123`)
