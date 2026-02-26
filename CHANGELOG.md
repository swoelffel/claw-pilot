# Changelog

All notable changes to claw-pilot are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

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
