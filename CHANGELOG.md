# Changelog

All notable changes to claw-pilot are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

---

## [0.7.3] — 2026-03-03

### Changed
- Instance card: OpenClaw version moved from footer to meta section — displayed inline with the port on the same row (`PORT :18789   openclaw v2026.3.1`), footer now shows agent count only

---

## [0.7.2] — 2026-03-02

### Changed
- `registry.ts` (729 lines) split into 7 focused sub-repositories under `src/core/repositories/`: `AgentRepository`, `BlueprintRepository`, `ConfigRepository`, `EventRepository`, `InstanceRepository`, `PortRepository`, `ServerRepository`. `Registry` is now a thin facade — all callers unchanged.

### Fixed
- **Critical migration bug**: `PRAGMA foreign_keys = OFF` was silently ignored inside `better-sqlite3` transactions (SQLite restriction). Migration v4 (`DROP TABLE instances`) was therefore running with FK enforcement ON, triggering `ON DELETE CASCADE` and wiping all agents rows on first open of a v1–v3 database. Fixed by setting the pragma before the transaction starts (`disableFk` flag on `Migration` interface).

---

## [0.7.1] — 2026-03-02

### Added
- Hash-based URL routing: browser back/forward, refresh persistence (`#/`, `#/instances/:slug/builder`, `#/instances/:slug/settings`, `#/blueprints`, `#/blueprints/:id/builder`)
- Public `GET /health` endpoint (no auth) for systemd/monitoring/load balancers
- Dialog accessibility: focus trap, Escape key, `aria-modal="true"` on all 5 dialogs via `DialogMixin`
- Gateway token cache (`TokenCache`) eliminates N disk reads per API call

### Changed
- `server.ts` split from 1522 lines into 5 route modules (`instances`, `blueprints`, `teams`, `system`) + `route-deps.ts`
- `config-updater.ts` split from 848 lines into `config-types.ts`, `config-helpers.ts`, `config-reader.ts`, `config-writer.ts` (barrel re-export preserves all imports)
- `console.log/error` in dashboard routes migrated to structured `logger`

### Fixed
- Shell injection risk in `config-updater.ts`: `conn.exec("mv ...")` → `conn.execFile("mv", [...])`
- Timing-safe token comparison (`crypto.timingSafeEqual`) for HTTP and WebSocket auth
- HTTP security headers: CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy
- `ConfigPatch` API body validated at runtime with Zod `.strict()` schema
- OpenClaw install URL validated before shell interpolation
- Rate limiting on API routes (60 req/min) and expensive operations
- Blueprint file upload size capped at 1 MB
- WCAG AA color contrast fix: `--text-muted` raised from #4a5568 (~2.8:1) to #64748b (~4.6:1)
- Token URL leak: `#token=` hash cleaned from address bar after login

### Tests
- 55 new tests: 38 API route integration tests + 17 `classifyChanges` unit tests (total: 184 tests)

---

## [0.7.0] — 2026-03-02

### Added
- OpenClaw update management from the dashboard: global banner in cluster view shows when a new version is available (e.g. "OpenClaw v2026.3.1 available")
- "Update all instances" button triggers `npm install -g openclaw@latest` on the server then restarts all running instances automatically
- Async polling: update job runs in background, UI polls every 2s and shows spinner during install, success/error state on completion
- OpenClaw version displayed in each instance card footer (e.g. `openclaw v2026.3.1`)
- New API routes: `GET /api/openclaw/update-status` and `POST /api/openclaw/update`

---

## [0.6.7] — 2026-03-02

### Added
- Instance Settings view: manage multiple AI providers per instance (add, remove, update API keys) directly from the dashboard
- Heartbeat model selector: `<select>` with `<optgroup>` per configured provider, dynamically updated as providers are added/removed
- i18n: `btn-settings` translated in all 6 locales (en/fr/de/es/it/pt)

### Changed
- `maskSecret()`: new format `8chars***4chars` (e.g. `sk-ant-a***SQAA`) for better readability
- Instance card footer: added `gap` to prevent crowding between agent count and action buttons across all locales

### Fixed
- `OPENCODE_API_KEY` env var was incorrectly set to `""` in config-generator — now correctly resolved; provisioner handles optional-key providers gracefully

---

## [0.6.6] — 2026-03-01

### Added
- `uninstall.sh` — script de désinstallation complet : arrête tous les services (systemd/launchd), supprime les fichiers de service, les données des instances (`~/.openclaw-*/`), les données claw-pilot (`~/.claw-pilot/`), le symlink binaire et le répertoire d'installation
- Modes `--dry-run` (affiche ce qui serait supprimé), `--yes` (non-interactif), `--keep-data` (garde les données instances et claw-pilot)
- Détection automatique du répertoire d'installation via le symlink `claw-pilot` (fallback `CLAW_PILOT_INSTALL_DIR` ou `/opt/claw-pilot`)
- Fallback sudo pour les suppressions nécessitant des droits élevés (symlink dans `/usr/local/bin`, repo dans `/opt/`)

---

## [0.6.5] — 2026-02-28

### Fixed
- Provisioner now rolls back all created artefacts on failure — if `claw-pilot create` fails mid-provisioning (after directories or service files were created), it automatically removes the state dir, service file, and registry entries instead of leaving orphaned state

---

## [0.6.4] — 2026-02-28

### Fixed
- `claw-pilot init` now shows a clear actionable message when OpenClaw installation fails — includes the manual install command and instructs the user to re-run `claw-pilot init` afterward

---

## [0.6.3] — 2026-02-28

### Fixed
- `install.sh` now sources `~/.zshrc` after `pnpm setup` (in addition to `.bashrc`/`.profile`) — fixes silent PATH failure on macOS where zsh is the default shell since Catalina
- `install.sh` OpenClaw detection now includes `/opt/homebrew/bin/openclaw` and `/usr/local/bin/openclaw` — aligns with the paths checked by `openclaw-cli.ts` on macOS
- `install.sh` now checks for required build tools (`cc`, `make`, `python3`) before `pnpm install` and prints a clear hint if any are missing (needed to compile `better-sqlite3` native bindings)

---

## [0.6.2] — 2026-02-28

### Fixed
- `claw-pilot create` now detects missing OpenClaw before entering the wizard and offers to install it automatically — instead of throwing an opaque `OPENCLAW_NOT_FOUND` error mid-provisioning

---

## [0.6.1] — 2026-02-27

### Fixed
- Google provider now writes `GEMINI_API_KEY` in `.env` instead of `GOOGLE_API_KEY` — instances created with Google Gemini were failing to start because OpenClaw expects `GEMINI_API_KEY`
- `openclaw.json` `meta.lastTouchedVersion` bumped to `2026.2.27` to match current OpenClaw release
- Anthropic model catalog corrected — removed non-existent `claude-opus-4-6` / `claude-sonnet-4-6` model IDs, replaced with real catalog (`claude-opus-4-5`, `claude-opus-4-1`, `claude-sonnet-4-5`, `claude-haiku-4-5`)

---

## [0.6.0] — 2026-02-27

### Added
- Agent team export/import via `.team.yaml` files — snapshot and restore a full agent team (agents, prompts, spawn links) across instances
- Export button in the agents builder — generates a `.team.yaml` with all agents, their workspace files, and spawn relationships
- Import dialog in the agents builder — validates and applies a `.team.yaml` into any instance, creating agents, writing workspace files, and wiring spawn links
- Verbose import validation — detailed error messages when the YAML schema is invalid or agents are misconfigured

### Fixed
- Import now correctly restores spawn links in `openclaw.json` (`list[].subagents.allowAgents`) — previously links were lost after sync
- Workspace files (AGENTS.md, SOUL.md, etc.) are now written to the correct path (`workspaces/workspace-{id}/`) matching the convention used by agent-sync and discovery
- `main` spawn links are now written to a dedicated `list[]` entry instead of `defaults.subagents`, which was rejected by OpenClaw and caused the instance to become unhealthy

---

## [0.5.0] — 2026-02-26

### Added
- macOS support — claw-pilot now runs natively on macOS using launchd (LaunchAgents)
- `launchd-generator.ts` — generates `.plist` files for OpenClaw instances and the dashboard service
- `getServiceManager()` in `platform.ts` — abstracts systemd vs launchd dispatch
- launchd helpers: `getLaunchdDir()`, `getLaunchdLabel()`, `getLaunchdPlistPath()`, `getDashboardLaunchdPlistPath()`
- macOS OpenClaw detection paths: `~/.npm-global/bin`, `/opt/homebrew/bin`, `/usr/local/bin`
- macOS-aware PATH in `openclaw-cli.ts` (includes `/opt/homebrew/bin`)
- `xdg.ts` guard — returns empty string on macOS (XDG_RUNTIME_DIR is Linux-only)

### Changed
- `lifecycle.ts`, `provisioner.ts`, `destroyer.ts`, `health.ts`, `discovery.ts`, `dashboard-service.ts` — all dispatch on `getServiceManager()` (systemd on Linux, launchd on macOS)
- `systemd_unit` field stores launchd label (`ai.openclaw.<slug>`) on macOS
- `status.ts` — renamed "Systemd" label to "Service" for platform-neutral display

### Removed
- Nginx support — fully removed from code, wizard, DB schema, types, tests, and docs
- `nginx-generator.ts` deleted
- DB migration v4 removes `nginx_domain` column from `instances` table

---

## [0.4.0] — 2026-02-26

### Added
- Real-time instance monitoring via WebSocket change-detection (push on state change only)
- Live instance detail panel — auto-refreshes health, logs, and status without polling
- Batched health checks — parallel port scan reduces dashboard load time

### Changed
- Dashboard service migrated to `ServerConnection` abstraction (no more raw `child_process` calls)
- `execFile` migration complete — all shell ops go through `conn.execFile` for future SSH compatibility
- `detect()` in `openclaw-cli` uses `conn.exists()` instead of `--version` subprocess (no TTY required)
- Extended PATH in `detect()` and `run()` for systemd non-interactive context

### Fixed
- `/api/instances` response now merges DB fields (state, telegram_bot, etc.) into instance objects
- `state: undefined` no longer returned when DB row exists but runtime state is unknown

---

## [0.3.3] — 2026-02-26 — First public release

> This is the first official public release of claw-pilot.

### Added
- Delete instance directly from the dashboard card (no need to open the detail panel)
- CONTRIBUTING.md and GitHub issue/PR templates
- GitHub Discussions enabled (Q&A, Ideas, Show and tell, Announcements)

### Changed
- Instance card layout redesigned — cleaner action area, consistent with blueprint cards
- Blueprint card delete button replaced with compact X icon

---

## [0.3.2] — 2026-02-22

### Added
- Structured API error codes across all routes (consistent JSON error shape)
- i18n for all error messages (6 languages: EN, FR, DE, ES, IT, PT)
- Contextual error codes split by domain (instance, agent, blueprint, auth)

---

## [0.3.1] — 2026-02-21

### Added
- Team Blueprints v0.3.1 — save and reuse agent team configurations
- Default `main` agent seeded automatically on blueprint creation
- Unified agent detail panel shared between instances and blueprints

### Fixed
- Template path resolution for new blueprint agents
- Seed files correctly applied to new blueprint agents

---

## [0.3.0] — 2026-02-20

### Added
- Team Blueprints v0.3.0 — initial implementation
- Blueprint creation, listing, and deployment to instances
- SQLite schema reference (`docs/registry-db.md`)
- Inline Markdown editor for agent workspace files (SOUL.md, AGENTS.md, TOOLS.md, …)

---

## [0.2.4] — 2026-02-18

### Added
- Delete agent from the builder canvas
- SA (sub-agent) badge and tooltips on agent cards
- Agent role displayed in the detail panel header

### Fixed
- Agent card layout — name on top, slug and files on the same row
- Delete button UX — click conflict, visual design, layout

---

## [0.2.3] — 2026-02-17

### Added
- Create agent directly from the builder canvas (popup form, workspace provisioning, green highlight on creation)

### Fixed
- New agent card positioned correctly (was appearing top-left instead of top-right)
- Absolute workspace path resolution after agent creation
- File sync after agent creation

---

## [0.2.0] — 2026-02-15

### Added
- Agent Builder — visual canvas with concentric layout, agent detail panel, live sync
- Drag & drop agent cards with SQLite position persistence
- Design system overhaul — Geist font, indigo accent, CSS design tokens
- i18n support — 6 languages (EN, FR, DE, ES, IT, PT) via `@lit/localize`
- Language switcher in the dashboard footer

---

## [0.1.3] — 2026-02-14

### Added
- Gateway token injection in Control UI links — zero-friction login via `#token=` URL hash
- `claw-pilot token <slug>` command — `--url` and `--open` flags
- Control UI button on instance cards (opens `localhost:<port>` directly)

### Fixed
- Gateway token correctly injected in `GET /api/instances` response
- Telegram status detection via `openclaw.json` channels config and JSONL logs

---

## [0.1.2] — 2026-02-13

### Added
- Footer with version number, GitHub link, and MIT license credit
- Multi-provider support — Anthropic, Google, xAI (provider↔model coupling in dashboard)
- `DELETE /api/instances/:slug` endpoint
- Dashboard systemd service (auto-start at install)

### Fixed
- Constants import restored in `health.ts` and `lifecycle.ts`
- Error handling added to start/stop/restart routes
- `openclaw.json` template updated to v2026.2.14 schema
- OpenClaw absolute path and dynamic `XDG_RUNTIME_DIR` resolution in systemd service
- Provisioner uses `getOpenClawHome()` instead of hardcoded `/opt/openclaw`
- Port check accepts any HTTP response (401 = server up)
- `getOpenClawHome()` uses `os.homedir()` by default

---

## [0.1.0] — 2026-02-12 — MVP

### Added
- CLI + web dashboard for OpenClaw multi-instance orchestration
- Instance lifecycle management — `init`, `create`, `start`, `stop`, `restart`, `destroy`, `list`, `status`, `logs`
- Interactive creation wizard with Nginx + SSL config generation
- Lit/Vite web dashboard UI — real-time status via WebSocket (port 19000)
- Instance creation dialog web component
- SQLite registry (`~/.claw-pilot/registry.db`) — instances, agents, ports, config, events
- `better-sqlite3` auto-compile via `pnpm.onlyBuiltDependencies`
- Install script (`install.sh`) — clones to `/opt/claw-pilot`, builds, links binary
