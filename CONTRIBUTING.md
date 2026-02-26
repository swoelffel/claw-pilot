# Contributing to claw-pilot

Thank you for your interest in contributing to claw-pilot! We welcome bug reports, feature requests, documentation improvements, and code contributions.

**Questions?** → [Discussions (Q&A)](https://github.com/swoelffel/claw-pilot/discussions/categories/q-a)
**Ideas?** → [Discussions (Ideas)](https://github.com/swoelffel/claw-pilot/discussions/categories/ideas)
**Bugs / Tasks?** → [Issues](https://github.com/swoelffel/claw-pilot/issues)

## Code of Conduct

Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md). We expect all contributors to maintain a respectful and collaborative environment.

If a Code of Conduct does not exist yet, we encourage respectful collaboration. Consider proposing one in a future contribution.

## Project Setup

### Prerequisites

- **Node.js**: >= 22.12.0
- **pnpm**: >= 9
- **Operating System**: Linux (Ubuntu/Debian recommended) with systemd user services enabled
- **Git**: For version control

### Repository Install

```sh
# Clone the repository
git clone https://github.com/swoelffel/claw-pilot.git
cd claw-pilot

# Install dependencies
pnpm install

# Build the project
pnpm build
```

## How to Run

### CLI in Dev Mode

```sh
pnpm dev
```

This runs the CLI with hot reload using tsdown's watch mode.

### Dashboard in Dev Mode

The dashboard is part of the UI build. For development with hot reload:

```sh
pnpm dev
```

### Running Both Concurrently

The `dev` script runs both CLI and UI in watch mode concurrently.

### Logs

- **CLI logs**: Printed to stdout/stderr
- **Dashboard logs**: Printed to stdout when running via `claw-pilot dashboard`
- **Instance logs**: View via `claw-pilot logs <slug>` (use `-f` for live tail)

## Testing & Quality

### Run Tests

```sh
pnpm test:run
```

For watch mode during development:

```sh
pnpm test
```

### Lint

```sh
pnpm lint
```

### Typecheck

```sh
pnpm typecheck
```

### Build

```sh
pnpm build         # Build CLI + UI
pnpm build:cli     # Build CLI only
```

**PRs must include tests when relevant** for any new functionality or bug fixes.

## Repository Structure

```
claw-pilot/
  src/
    commands/       CLI commands — thin wrappers over core/
    core/           Business logic (registry, discovery, provisioner, agent-sync, blueprints)
    dashboard/      Hono HTTP server + WebSocket monitor
    db/             SQLite schema and migrations
    lib/            Utilities (logger, errors, constants, platform, xdg, shell)
    server/         ServerConnection abstraction (LocalConnection)
    wizard/         Interactive creation wizard (@inquirer/prompts)
  ui/src/
    components/    Lit web components
    locales/       i18n strings (en, fr, de, es, it, pt)
  templates/       Workspace bootstrap files (SOUL.md, AGENTS.md, TOOLS.md)
  docs/            Technical specifications
```

## Contribution Workflow

We use a standard fork-based workflow:

1. **Open an issue** (optional but recommended for large changes) — helps discuss approach before implementation
2. **Create a feature branch** from `main`
3. **Implement** your changes
4. **Add or update tests** as needed
5. **Run quality checks**: `pnpm typecheck && pnpm lint && pnpm test:run`
6. **Open a PR** against `main`

### Branch Naming

- Features: `feature/description`
- Bug fixes: `fix/description`
- Documentation: `docs/description`

## Commit & PR Guidelines

### PR Title

Use a clear, descriptive title. Example:
- `feat: add blueprint export functionality`
- `fix: resolve port conflict on instance restart`
- `docs: clarify installation prerequisites`

### PR Size

Keep PRs small and focused when PR possible. Larges are harder to review and test.

### Linking Issues

Link issues using GitHub keywords:
- `Fixes #123` — closes issue when PR merges
- `Closes #123` — same as Fixes
- `Relates to #123` — contextual link

### UI Changes

For UI changes, include screenshots or GIFs demonstrating the change.

## Triage Labels

We use the following labels to categorize issues:

| Label | Description |
|-------|-------------|
| `good first issue` | Suitable for first-time contributors |
| `help wanted` | Looking for community help |
| `bug` | Something isn't working as expected |
| `feature` | New feature request |
| `docs` | Documentation improvements |
| `refactor` | Code refactoring |
| `question` | General questions |

## Security

**Do not file public issues for security vulnerabilities.**

If you discover a security issue, please report it responsibly:

1. Check if there's a [Security Advisory](https://github.com/swoelffel/claw-pilot/security/advisories) template
2. Or contact the maintainer directly through GitHub

We appreciate responsible disclosure and will work with you to address the issue.
