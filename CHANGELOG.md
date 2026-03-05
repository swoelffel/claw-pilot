# Changelog

All notable changes to claw-pilot are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

---

## [0.10.1] — 2026-03-05

### Fixed
- **Discover instances** : détection des instances OpenClaw en layout single-instance (service `openclaw-gateway.service` sans `OPENCLAW_STATE_DIR`). Le port est désormais extrait depuis `OPENCLAW_GATEWAY_PORT` dans les variables d'env du unit systemd, et `~/.openclaw/` est utilisé comme stateDir de fallback.

---

## [0.10.0] — 2026-03-05

### Added
- **Discover instances** : bouton "Discover instances" dans l'état vide de la vue Instances (0 instances en DB). Lance un scan du système (directory, systemd/launchd, port scan) via le nouveau dialog `cp-discover-dialog`, affiche les instances trouvées avec leur état (running/stopped, port, Telegram bot, modèle, nombre d'agents), et les adopte en un clic dans la DB.
- **API** : 2 nouvelles routes — `POST /api/instances/discover` (scan sans écriture DB) et `POST /api/instances/discover/adopt` (adoption des slugs sélectionnés). Déclarées avant les routes paramétriques pour éviter la collision Hono `/:slug`.
- **i18n** : 9 nouvelles strings dans les 6 locales (EN, FR, DE, ES, IT, PT) pour le dialog discover.

---

## [0.9.0] — 2026-03-03

### Added
- **Agent Detail Panel — mode édition** : bouton crayon (✏ SVG) dans le header du panel pour éditer les champs principaux d'un agent — `name`, `model` (via selects Provider/Model), `role`, `tags` (CSV), `notes`. Sauvegarde double-source en parallèle : `openclaw.json` via `PATCH /config` pour name/model, SQLite via le nouvel endpoint `PATCH /agents/:id/meta` pour role/tags/notes.
- **Settings — bouton d'accès au panel agent** : colonne "Actions" dans la table agents de la page Settings avec un bouton crayon par ligne. Ouvre le panel complet en drawer latéral fixe (420px) avec backdrop semi-transparent. Après sauvegarde, la table et le panel se rechargent automatiquement.
- **API** : nouvel endpoint `PATCH /api/instances/:slug/agents/:agentId/meta` — persiste `role`, `tags`, `notes` en SQLite (validation Zod, sans redémarrage du daemon).

### Changed
- **Agent Detail Panel — boutons header** : expand et close remplacés par des SVG 18×18 (chevron et croix) — plus lisibles. Bouton crayon fichiers (AGENTS.md, SOUL.md…) aligné sur le même SVG.
- **Agent Detail Panel — expand depuis Settings** : le drawer Settings écoute l'événement `panel-expand-changed` et passe en `width: 100vw` pour un expand plein écran fonctionnel.

---

## [0.8.3] — 2026-03-03

### Added
- **Settings Telegram — formulaire d'initialisation** : quand Telegram n'est pas encore configuré, un bouton "Configure Telegram" révèle un formulaire inline (botToken, dmPolicy, groupPolicy, streamMode) avec lien direct vers BotFather. Le backend crée le bloc `channels.telegram` depuis zéro sans modification nécessaire.
- **Settings Telegram — gestion du pairing DM** : panneau "Pairing Requests" visible quand `dmPolicy === "pairing"`. Affiche les demandes en attente (username, ID, code 8 chars, âge) avec bouton [Approve] par requête. Polling automatique toutes les 10s si des demandes sont en attente. Badge rouge sur l'item Telegram de la sidebar. Compteur des senders approuvés.
- **API** : 2 nouvelles routes — `GET /api/instances/:slug/telegram/pairing` et `POST .../approve`.
- **Core** : `TelegramPairingManager` — lit `credentials/telegram-pairing.json` + `telegram-allowFrom.json`, wrappe `openclaw pairing approve telegram <CODE>`.

### Fixed
- **Settings Telegram — valeurs dmPolicy/groupPolicy** : `"closed"` remplacé par `"disabled"` (valeur correcte du schéma OpenClaw). dmPolicy expose désormais `pairing / open / allowlist / disabled`, groupPolicy expose `allowlist / open / disabled`.
- **Settings Telegram — boutons** : classes `btn-secondary`/`btn-primary` corrigées en `btn btn-ghost`/`btn btn-primary` conformément au design system.

---

## [0.8.2] — 2026-03-03

### Changed
- **Settings — navigation par panneau** : chaque section (General, Agents, Telegram, Plugins, Gateway, Devices) est désormais un panneau exclusif — clic sidebar remplace le contenu au lieu de scroller. Cohérence UX avec le comportement déjà en place pour la section Devices.
- **Settings — Save/Cancel** : masqués quand la section Devices est active (pas de champs éditables dans ce panneau).
- **Settings — sidebar** : item "Devices" intégré dans la liste standard (plus de bouton séparé).

---

## [0.8.1] — 2026-03-03

### Added
- **API REST devices** : 3 nouvelles routes sur le dashboard :
  - `GET /api/instances/:slug/devices` — retourne `{ pending, paired }`
  - `POST /api/instances/:slug/devices/approve` — approuve une demande (`{ requestId }`)
  - `DELETE /api/instances/:slug/devices/:deviceId` — révoque un device
- **Composant `cp-instance-devices`** (`ui/src/components/instance-devices.ts`) :
  - Section Pending avec fond ambre, bouton [Approve] par device, [Approve all] si plusieurs
  - Section Paired avec badge `cli` (non révocable), confirmation inline avant révocation
  - Polling automatique toutes les 5s si des demandes sont en attente
  - Event `pending-count-changed` pour synchroniser le badge de l'onglet parent
- **Onglet Devices dans Settings** (`cp-instance-settings`) :
  - Nouvel onglet "Devices" dans la sidebar, visible pour toutes les instances
  - Badge rouge sur l'onglet si des demandes sont en attente
  - Toast ambre si `pairingWarning` est retourné après un changement de port
- **Bannière pending devices sur les cards** (`cp-instance-card`) :
  - Bannière ambre sous la card si `pendingDevices > 0` avec bouton "Go to Devices"
- **`pendingDevices` dans le health check** (`src/core/health.ts`) :
  - Lecture best-effort de `<stateDir>/devices/pending.json` à chaque health check
  - Propagé dans les `health_update` WebSocket → cards mises à jour en temps réel

---

## [0.8.0] — 2026-03-03

### Added
- **`claw-pilot devices` CLI** — nouvelle commande avec 3 sous-commandes pour gérer le pairing OpenClaw sans SSH manuel :
  - `claw-pilot devices list <slug>` — affiche les demandes en attente (en jaune) et les devices pairés avec timestamps relatifs
  - `claw-pilot devices approve <slug> [requestId]` — approuve une ou toutes les demandes en attente
  - `claw-pilot devices revoke <slug> <deviceId>` — révoque un device pairé (avec vérification préalable dans la liste)
- `src/core/devices.ts` — types `PendingDevice`, `PairedDevice`, `DeviceList`
- `src/core/device-manager.ts` — `DeviceManager` : lit `<stateDir>/devices/pending.json` + `paired.json` via `ServerConnection`, wraps `openclaw devices approve/revoke`
- `src/core/__tests__/device-manager.test.ts` — 8 tests (list vide, pending, paired, approve, revoke, erreurs)

---

## [0.7.6] — 2026-03-03

### Added
- **Blueprints badge in nav**: the Blueprints tab in the top navigation bar now shows a numeric badge with the blueprint count (same style as the Instances badge). The badge updates dynamically on create/delete and is hidden when no blueprints exist or the view hasn't been visited yet.
- **Pairing warning on port change**: changing `gateway.port` via `PATCH /api/instances/:slug/config` now returns `pairingWarning: true` in the response. The browser's localStorage is origin-scoped (`localhost:PORT`), so a port change invalidates the existing device pairing — the user must re-approve from the Devices tab (Phase 3) or via `claw-pilot devices approve <slug>` (Phase 2).
- `gateway.port` is now an accepted field in `ConfigPatch` / `ConfigPatchSchema` (previously only `reloadMode` and `reloadDebounceMs` were exposed). Changing the port also syncs the new value to the registry DB.
- `port` field added to `InstanceRepository.updateInstance()` for DB consistency on port changes.

---

## [0.7.5] — 2026-03-03

### Changed
- OpenClaw compatibility bumped to **2026.3.2**: updated `lastTouchedVersion` in generated configs, provider catalog version reference, and `OPENCLAW-COMPAT.md` with new optional keys (`cli.banner.taglineMode`, `browser.cdpPortRangeStart`, `sessions.retry`, `sessions.webhookToken` SecretRef support, `acp`, `tools.media.audio.*`, `tools.sessions_spawn.attachments`) and breaking changes (`tools.profile` default → `"messaging"`, `acp.dispatch.enabled` → `true` by default)

---

## [0.7.4] — 2026-03-03

### Fixed
- Control UI now works through SSH tunnels: generated configs include `gateway.controlUi.allowedOrigins: ["*"]` so the browser's `Origin: http://localhost:<local-port>` header is accepted by the gateway. Existing instances on VM01 patched in-place.

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
