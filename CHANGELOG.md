# Changelog

All notable changes to claw-pilot are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

---

## [Unreleased]

### Added
- **Plugin Signature verifier (H7)** — new `src/runtime/plugin/verifier.ts` introduces a pluggable `PluginVerifier` invoked **before** the dynamic `import()` in `loadPluginFromFile()`. The loader now reads the plugin bytes, computes a SHA-256 hash, and calls `verifier.verify({ path, bytes, hash })`. A failing result emits `plugin.rejected` to the audit bus (new `AuditEvent` variant with `{ path, verifierKind, reason }`) and throws `ClawPilotError("PLUGIN_REJECTED")` — the plugin module is never evaluated. Community ships `NullPluginVerifier` (accepts everything, behaviour unchanged); Enterprise registers a capability-gated `CAVerifier` / `CosignVerifier` at bootstrap under the `plugin-signature` capability. `registerPluginVerifier(v)` always accepts `v.kind === "null"` and refuses any other kind without the capability (`PLUGIN_SIGNATURE_CAPABILITY_REQUIRED`). Wired at all three entry points (`_context.ts`, `dashboard.ts`, `runtime.ts`) immediately after `bootstrapAuditBus()`. Convention for detached signatures: `<plugin>.sig` alongside the plugin file. See `docs/architecture/plugin-signature.md`.

---

## [0.80.12] — 2026-04-21

### Changed
- **cp-system team consolidated from 6 to 3 agents** (#147) — `admin-exec` + `config-exec` merged into the new `ops` agent (generator, full CRUD + lifecycle); `db-analyst` absorbed into `analyst` which now owns `cp_query_db`; `architect` dissolved into system-pilot as a conversational team-design workflow. SOUL.md footprint dropped 69 % (652 → ~200 lines). The 4 removed agents are preserved on existing instances with sessions + history intact — only YAML spawn links are replaced so system-pilot routes exclusively to `ops` / `analyst`.
- **Per-agent `cp_*` tool scoping** (#147) — `systemToolsPlugin` now filters tools by `agentId`. `system-pilot` receives read-only tools (8), `ops` gets the full CRUD surface minus `cp_query_db` (21), `analyst` gets read + SQL (9). Legacy / unknown agents still see all 22 tools for backwards compatibility. Saves ~5400 tokens/turn in the pilot's permanent session prompt and enforces delegation at the tool level rather than relying on prompt-level discipline.
- **Shared instance workspace seeded from templates** (#145, #147) — `templates/system/workspace/shared/` is now copied to `<stateDir>/workspaces/shared/` at provisioning and re-synced on template hash change. All agents can read cross-cutting references via `ws_list_files("@shared/")` / `ws_search_files(..., dir: "@shared/...")`. Template-owned filenames are tracked in `config.cp_system_shared_template_files` so files removed from the template are cleaned up; user-created shared files (via `ws_write_shared_file`) are never touched.
- **System-pilot SOUL & AGENTS docs clarified** (#142) — new `docs/reference/data-sources.md` enumerates canonical DB sources per concept, warns explicitly against reading `runtime.json` (deprecated snapshot) or `HEARTBEAT.md` as a config source. SOUL.md gets a `Where state lives` section so the pilot does not grep filesystem artifacts when asked where state lives.

### Fixed
- **Sync now persists `model` in agent `config_json`** (#147) — `_syncAgents` omitted `model`, so `parseAgentConfig` threw on re-read and fell back to a minimal config, silently dropping `toolProfile`, `archetype`, `promptMode`, and `persistence` (observed as `toolProfile: "executor"` on ops/analyst after Phase B deploy). Model is now resolved with precedence: explicit `config.model` → existing DB row's model → instance default (from `default_named_key_id`) → safe fallback.
- **`cp_query_db` word-boundary keyword filter** (#147) — the destructive-keyword guard used `String.includes` which matched substrings, blocking legitimate SELECTs on columns like `created_at`, `updated_at`, `deleted_at` ("Query contains forbidden keyword CREATE"). Switched to `\bKEYWORD\b` regex so only standalone keywords trigger the guard. Regression caught by analyst during MAC validation.

---

## [0.80.11] — 2026-04-21

### Added
- **Audit Event Bus (H6)** — new `src/core/audit/` module introduces a typed `emitAudit()` API and a seven-variant taxonomy (`auth.login`, `auth.logout`, `auth.failed`, `permission.denied`, `secret.access`, `agent.tool_call`, `named_key.mutation`). Two default Community sinks ship at bootstrap: `FileAuditSink` writes a daily-rotated JSONL to `<stateDir>/audit/` (intended for `tail -f` and ops inspection) and `DbAuditSink` persists to the new `rt_audit_events` table (migration v39) with `org_id` slotted from day one. Additional sinks require the `audit-siem` capability, so Enterprise can register Splunk / Datadog / Elastic sinks without patching a frozen path. `emitAudit()` is sync-non-blocking (100-event threshold or 1s timer); `shutdownAuditBus()` is wired into every SIGTERM / SIGINT handler so the tail of events isn't lost. Frozen paths instrumented in this release: `src/dashboard/middleware/permission.ts`, `src/dashboard/routes/auth.ts`, `src/dashboard/routes/named-keys.ts`, `src/runtime/session/prompt-loop.ts`. `secret.access` stays opt-in via `SecretProvider.get(name, { audit: true, by })` — Enterprise wrappers force it on; Community emits 0 secret-access events at boot. Tool-call envelopes carry `argsHash = sha256(canonicalize(args))` with sorted-key JSON, so SIEMs can dedup identical calls regardless of model-side property order. See `docs/architecture/audit-event-bus.md`.

### Fixed
- **Runtime daemon `ServerRegistry` bootstrap (latent H3 gap)** — `src/commands/runtime.ts` now calls `bootstrapServerRegistry(db, new LocalConnection())` during daemon startup, matching what `withContext()` already did for CLI commands. Prior to this, the daemon's lifecycle bypassed `withContext()` and plugin tool hooks threw `ClawPilotError: ServerRegistry not registered`, silently breaking tool-call audit emission and any consumer that called `getServerRegistry()` from a runtime process.

---

## [0.80.10] — 2026-04-21

### Added
- **SecretProvider abstraction (H4)** — new `src/core/secrets/` module introduces a pluggable `SecretProvider` interface with a Community `EnvSecretProvider` default. Every secret read now goes through `secretProvider.get(...)`: master encryption key, Telegram bot token, web-chat token, internal runtime token, and provider API keys for model discovery. Gated by the `vault-secrets` capability so Enterprise can drop in a Vault / AWS SM / Azure Key Vault implementation without touching frozen paths (R3). Landing step toward enforcement of discipline rule R5 — the H9 lint rule `no-direct-secret-access` will mechanically forbid re-introducing a direct `process.env` secret read. See `docs/architecture/secret-provider.md`.

---

## [0.80.9] — 2026-04-21

### Fixed
- **UI — question cards render without F5** (#138) : `home-chat` and `runtime-pilot` now call `_reloadLastMessages` on the `question.asked` event instead of `_refreshMessages`. The latter short-circuits when `_status === "tool"`, which is always the case at question time since `tool.call.started` fires first. Subagent-initiated questions are now visible immediately.
- **UI — question state reset on call prop change** (#138) : `part-question` now resets `_activeTab`, `_tabStates`, `_submitting`, `_answered`, and `_initialized` in `willUpdate()` when the `call` prop changes, preventing stale interaction state from leaking into a reused Lit element (e.g., consecutive question tool calls on the same agent).
- **Named keys — keyless provider support** (#138) : `POST /api/named-keys` now accepts an empty `apiKey` when the provider has `requiresKey=false` in the catalog (e.g., OpenCode Zen). Providers with `requiresKey=true` (Anthropic, OpenAI, …) still return `400 API_KEY_REQUIRED`. Unknown providers default to required as a safe fallback.
- **Named keys — crypto empty-string round-trip** (#138) : `encrypt("")` and `decrypt("")` now short-circuit to `""`. Previously, `encrypt("")` produced `"iv:authTag:"` — a ciphertext format rejected by the stricter `decrypt()` added in v0.77.2, which crashed `GET /api/named-keys` with a 500 as soon as a keyless entry was stored.
- **Named keys — corrupt-row resilience** (#138) : `rowToRecord()` in `NamedKeyRepository` now catches decrypt failures per row and surfaces the entry as `apiKeyMasked: "[corrupt]"` instead of bubbling up and 500-ing the whole list endpoint. Existing corrupt entries from older code paths stay deletable through the UI.

### Changed
- **Named-keys route refactor** (#138) : `handleCreate`, `handleUpdate`, `handleDelete` extracted out of `registerNamedKeyRoutes` to stay under the 150-line function length cap. No behavior change.

### Docs
- **Contributor workflow rewritten** (#140) : `CONTRIBUTING.md` is now the single source of truth for the public contribution flow. Fixes incorrect instructions to branch off and PR against `main` — the actual gitflow is develop-first. Adds golden rules (no version bump in feature PRs, no hook skipping), conventional commits spec, lefthook stage breakdown, fork workflow with upstream sync, Community/Enterprise discipline (R1–R5), and macOS in prerequisites.
- **PR template enriched** (#140) : adds an explicit workflow checklist (base branch = `develop`, no version bump, branch naming, conventional commits) so gates are visible at PR creation time.
- **CLAUDE.md pointer** (#140) : short "Contribution workflow" section points to `CONTRIBUTING.md`, ensuring AI agents opening the repo internalize the develop-first rule immediately.
- **README changelog catch-up** (#139) : bullet list in README was stuck at v0.69.0. Added 15 entries covering v0.70.0 → v0.80.9 with one-liner summaries for each milestone (live reasoning streaming, Flow Sessions, Instance Dashboard, notification inbox, shared workspace, Enterprise Edition Phase 0 hooks, ServerRegistry, CodeQL triage). Also corrected docs table schema reference from v34 → v38.

---

## [0.80.8] — 2026-04-21

### Added
- **`ServerRegistry` abstraction** (`src/server/registry.ts`) — single entry point for "which server serves which resource". Community ships `SingleServerRegistry` (always local); Enterprise will plug a `FederatedServerRegistry` via the `multi-server` capability. Bootstrapped from `withContext()` and the dashboard server entry, consumed by CLI commands (`init`, `update`, `dashboard`) and runtime tools. This is hook **H3** of the Enterprise Edition preparation (Phase 0). See `ai-docs/plan-enterprise-edition.md` and `docs/architecture/server-registry.md`.

---

## [0.80.7] — 2026-04-21

### Security
- **CodeQL triage — 0 open alerts** : complete sweep of pre-existing CodeQL findings. 5 true positives fixed in code, 21 false positives dismissed with justification, 2 covered by existing sanitization wrappers.
  - **Fixes** : `src/dashboard/routes/instances/workspace-download.ts` (file-system race + filename sanitization), `src/runtime/tool/built-in/write.ts` (file-system race), `src/runtime/tool/built-in/_skill-remote.ts` (path traversal defense on HTTP→file), `src/dashboard/routes/instances/agents/skills.ts` (path validation on skill download), `src/commands/auth.ts` (credential log masking).
  - **Infra** : `src/dashboard/routes/instances/runtime-tools.ts` (useless assignment), `ui/src/components/flow-sessions.ts` (trivial conditional).
  - **Policy** : new `docs/architecture/codeql-policy.md` documents triage process, justification template, and dismiss/fix criteria. `docs/architecture/codeql-triage-notes.md` records per-alert rationale for future audit.

### Tooling
- `cspell` whitelist extended (`TOCTOU` term from security discussion).

---

## [0.80.6] — 2026-04-20

### Added
- **Permission middleware extension point** (`src/dashboard/middleware/permission.ts`): contract for pluggable `PermissionChecker`, registration API, `permission()` Hono middleware factory, and `ACTIONS` catalogue. Every dashboard mutation route and sensitive read route is annotated with `permission({ action, resource })`. The auth middleware publishes an `AuthenticatedUser` on the Hono context with a `source: "session" | "bearer"` discriminator. Community ships `NullPermissionChecker` (always allow) since Community is mono-user admin by design. Enterprise can register a `FineGrainedRBACChecker` without modifying any dashboard route. This is hook **H1** of the Enterprise Edition preparation (Phase 0). See `ai-docs/plan-enterprise-edition.md` and `docs/architecture/permission-middleware.md`.

---

## [0.80.5] — 2026-04-20

### Added
- **`AuthProvider` abstraction** (`src/core/auth/`) — the monolithic `src/core/auth.ts` is refactored into a pluggable provider pattern. Exposes `AuthProvider` interface (`kind`, `authenticate(credentials)`), a registry (`registerAuthProvider`, `authenticate(kind, credentials)` dispatcher), and a default `PasswordProvider` (scrypt) registered at dashboard bootstrap. Dashboard `POST /api/auth/login` now routes through `authenticate("password", …)` instead of inlining the SELECT + scrypt verification. This is hook **H2** of the Enterprise Edition preparation (Phase 0) — Enterprise will register `OIDCProvider`, `SAMLProvider`, `AzureADProvider` without touching Community code. See `ai-docs/plan-enterprise-edition.md`.
- **Architecture doc** `docs/architecture/auth-providers.md` — API, registration pattern, multi-provider coexistence, bearer identity handling, Enterprise extension roadmap.

---

## [0.80.4] — 2026-04-20

### Dependencies
- **`@inquirer/prompts`** 8.4.1 → 8.4.2 (patch — fix freeze on some Windows terminals).
- **`marked`** 18.0.1 → 18.0.2 (patch — bug fixes).

### Tooling
- **`knip`** 6.4.1 → 6.5.0, **`vite`** 8.0.8 → 8.0.9 (dev deps).
- **GitHub Actions**: `github/codeql-action` v3 → v4, `actions/setup-node` 6.3.0 → 6.4.0, `pnpm/action-setup` 6.0.0 → 6.0.1.

---

## [0.80.3] — 2026-04-20

### Added
- **`CapabilityRegistry`** (`src/core/capabilities.ts`) — single source of truth for differentiating Community vs future Enterprise edition behavior. Exposes `capabilities.has(cap)`, `capabilities.require(cap)`, `capabilities.list()`. Community impl returns `true` for the "core" set and `false` for future "enterprise" capabilities (`sso-oidc`, `sso-saml`, `rbac-fine`, `abac`, `audit-siem`, `multi-server`, `plugin-signature`, `vault-secrets`, …). This is hook **H5** of the Enterprise Edition preparation (Phase 0) — see `ai-docs/plan-enterprise-edition.md`.
- **Architecture doc** `docs/architecture/capability-registry.md` — rationale, API, usage patterns, and consumer roadmap for subsequent hooks (H1–H4, H6–H7).

---

## [0.80.2] — 2026-04-20

### Added
- **Opt-in UI debug logging** — `ui/src/services/debug.ts` now exports four granular helpers (`debugSse`, `debugChat`, `debugRender`, `debugApi`) each gated by its own `localStorage` flag (`cp:debug-sse|chat|render|api`, or `cp:debug` for all). Zero runtime cost when disabled. Call sites seeded in `home-chat.ts` and `runtime-pilot.ts` at the spots useful during streaming diagnostics.
- **`docs/debugging.md`** — dedicated hub documenting the UI debug flags, how to enable them from devtools, how to add new categories, and where call sites currently live. `docs/sse-architecture.md` now cross-links to it instead of duplicating the content.

---

## [0.80.1] — 2026-04-20

### Fixed
- **Home chat double render** — on the `/home` screen (and `/pilot` full inspector), the assistant reply was painted twice during streaming: once as the persisted row coming back from `_reloadLastMessages`, once as the live streaming bubble. Track the in-flight assistant `messageId` and hide the matching row from the timeline while the stream is active. Cleared on session idle/ended/abort.
- **Missing `agentId` on `MessageCreated`** — the bus event published at the start of an assistant turn did not carry the agent id, so the streaming bubble fell back to the generic "agent" label. Added `agentId` to the payload and to both publish sites (prompt-loop, compaction). Regression-tested in `prompt-loop.test.ts`.

---

## [0.80.0] — 2026-04-20

### Fixed
- **Agent kickoff language** — agents replied in English even when the user had selected another language. Four combined issues were fixed:
  - `initDatabase` now backfills a default `user_profiles` row for the admin user when missing. Historical installs were stuck without a profile because the onboarding wizard only triggers when no API key exists.
  - The onboarding wizard no longer silently swallows `PATCH /api/profile` failures — errors surface in the existing error banner.
  - `ClawRuntime` is now instantiated with a `CommunityProfileResolver`, so the `<user_profile>` block (with the user's `Language: <code>`) is injected into the system prompt of every session — not just kickoffs.
  - The system-prompt `<behavior>` block now prioritizes the profile language over "match the user's message" on every turn, so short first turns can't drift to English.

---

## [0.79.1] — 2026-04-20

### Fixed
- **Onboarding start CTA** — removed the "Say hello to your Pilot" subtitle below the Start button on `/home` and `/pilot`. Only the Start button remains. i18n key `startCta.subtitle` removed from all six locales.

---

## [0.79.0] — 2026-04-20

### Added
- **Instance shared workspace** — Per-instance shared file space at `<stateDir>/workspaces/shared/` accessible by every agent of the instance. Auto-created at install; auto-healed on agent-sync for legacy instances.
- **Schema v38** — New `instance_shared_files` table + `instance_shared_files_fts` FTS5 mirror (symmetrical to `agent_files` / `agent_files_fts`). Additive migration, triggers keep FTS in sync.
- **Dashboard UI** — New "Shared files" tab in instance settings (`cp-instance-shared-files`) reusing `cp-agent-file-editor` + `cp-new-file-dialog` + `cp-delete-file-dialog`. Tree + markdown preview + tabs. i18n across en/fr/de/es/it/pt.
- **HTTP routes** — `GET/PUT/DELETE /api/instances/:slug/shared-files` and `/shared-files/*` for tree, read, create/update, delete. Path validation via `validateWorkspaceRelativePath`, 1 MB cap.
- **Agent runtime tools** — Two new tools in the `workspace-knowledge` plugin: `ws_write_shared_file(path, content)` and `ws_delete_shared_file(path)` let agents collaborate on the shared workspace. Gating delegated to the existing per-tool permission system. `ws_list_files` / `ws_search_files` now include `@shared/<path>` entries alongside the agent's own workspace.
- **Reserved agent slug** — `shared` is now rejected at agent creation (both HTTP route and `AgentProvisioner`) — it would collide with `workspaces/shared/`.
- **SOUL.md template** — Documents the shared workspace and collaboration etiquette so new agents are aware of the capability.
- **Tree builder helper** — `buildFileTree()` extracted to `src/dashboard/routes/_file-tree.ts` and reused by both agent-files and shared-files routes.

### Changed
- `AgentSync.sync()` now also walks the shared workspace and reconciles `instance_shared_files`. The `changes` result includes a `sharedFilesChanged` counter. Triggering `POST /api/instances/:slug/agents/sync` is the documented way to re-index after an out-of-band disk edit.
- `createWorkspaceKnowledgeTools()` factory signature extended with an optional `workDir` parameter (required for the write/delete tools to hit disk).

---

## [0.78.1] — 2026-04-20

### Fixed
- **Skills ZIP upload** — `POST /api/instances/:slug/skills/upload` was failing with HTTP 500 on systems without the `unzip` binary installed (e.g. production Debian 12). Replaced `execFile("unzip", ...)` with the pure-JS `fflate` library (zero native deps). Added path traversal safety check and 6 new tests covering upload scenarios (missing file, no SKILL.md, root/nested SKILL.md, path traversal rejection).

---

## [0.78.0] — 2026-04-19

### Added
- **Onboarding Start CTA** — A centered, animated "Start" button appears on any empty permanent agent session (home screen + `/pilot/:slug`). Clicking it triggers the first prompt-loop turn so the agent introduces itself.
- **Kickoff route** `POST /api/instances/:slug/agents/:agentId/kickoff` — Validates the permanent session is empty (409 `KICKOFF_ALREADY_DONE` otherwise), picks a localized greeting from the user's language profile, forwards it to the runtime via the existing `callRuntimeApi` path. Reuses the existing `BOOTSTRAP.md` one-shot mechanism in `system-prompt.ts` — no change to the prompt loader.
- **System pilot `BOOTSTRAP.md`** (`templates/system/workspace/system-pilot/BOOTSTRAP.md`) — Ships first-contact instructions so the Pilot's introduction works out of the box after a fresh install.
- **Localized greetings** (`src/runtime/session/bootstrap-fallback.ts`) — Six languages (en, fr, de, es, it, pt) with English fallback. Used when an agent has no `BOOTSTRAP.md`.
- **i18n strings** `startCta.label` and `startCta.subtitle` in all six locale files.
- **Lit component** `<cp-start-cta>` — Circular button with halo pulse, spinner loading state, `prefers-reduced-motion: reduce` support, dispatches `cp-kickoff-start` / `cp-kickoff-done` events.

### Changed
- `home-chat.ts` and `runtime-pilot.ts` now mount `<cp-start-cta>` in place of the composer when the session has zero messages and is not loading.
- New repository helper `countMessagesBySessionKey` in `src/core/repositories/runtime-session-repository.ts` (extracted from inline SQL per project convention).

---

## [0.77.4] — 2026-04-18

### Added
- **Branch coverage: dashboard routes** — 17 new tests covering `_internal-api-client.ts` (0% → 100% branches) and `instances/workspace-download.ts` (0% → 90% branches). Exercises Bearer auth wiring to the runtime daemon, fetch-level failures, best-effort event publish, path traversal, symlink escape, and content-disposition escaping.

### Changed
- **CI coverage thresholds** raised to lock in the gain: lines 59→60, statements 58→59, functions 61→63, branches 52→53. Prevents regression; actual coverage sits at 60.99 / 59.92 / 64.00 / 53.09.

---

## [0.77.3] — 2026-04-18

### Added
- **Renovate** (`renovate.json`) — Weekly grouped dependency PRs against `develop`, with dedicated groups for `ai-sdk`, `typescript-tooling`, `vitest`, and `lint-format`. Major bumps isolated with `breaking-change` label. Security advisories bypass the schedule.
- **CodeQL** (`.github/workflows/codeql.yml`) — SAST scan on push + PR + weekly cron, `security-extended` + `security-and-quality` query packs, scoped to `src/` and `ui/src/`.
- **Release automation** (`.github/workflows/release.yml`) — Triggered on `v*.*.*` tag pushes. Verifies tag/package.json alignment, extracts notes from CHANGELOG.md, generates a CycloneDX SBOM via `cdxgen` (pnpm-aware), creates the GitHub release with SBOM attached.

### Changed
- Release workflow replaces the manual `gh release create` step in the release runbook. Human still bumps version + commits + pushes tag.

---

## [0.77.2] — 2026-04-18

### Security
- **self-updater ref validation** — `targetRef` is now validated against `^v\d+\.\d+\.\d+(-suffix)?|main$` before being passed to `git checkout`. Defense in depth against a theoretical GitHub API compromise that could have injected shell metacharacters into the update command. Unsafe refs abort the job cleanly with an "unsafe ref" error.
- **crypto.decrypt hardening** — strict 3-segment format enforcement, non-empty part checks, and exact IV/authTag length validation (16B each). Previous destructuring silently accepted malformed ciphertext.

### Added
- 15 new tests covering unsafe-ref rejection, valid-ref acceptance, and decrypt edge cases (wrong segment count, truncated IV/authTag). Total suite: 2371 passed.

---

## [0.77.1] — 2026-04-18

### Security
- **hono** bumped to 4.12.14 — patches HTML injection in JSX SSR (GHSA-458j-xx4x-4375, moderate).
- **dompurify** bumped to 3.4.0 — patches ADD_TAGS bypass (GHSA-39q2-94rc-95cp, moderate).
- **brace-expansion** pinned to ≥5.0.5 via pnpm override — patches DoS via zero-step sequence in devDep transitive chain (moderate).

### Changed
- **Dependencies** — Bumped `@ai-sdk/*`, `ai`, `@openrouter/ai-sdk-provider` (2.5.1→2.8.0), `marked`, `nanoid`, `eslint`, `oxlint`, `prettier`, `tsdown`, `typescript`, `@typescript-eslint/*`, `lefthook`, `eslint-plugin-sonarjs` to latest patch/minor.
- **Vitest 4 migration** — `vitest.e2e.config.ts` moved `poolOptions.forks` to top-level `forks` (API change in Vitest 4).

### Removed
- **@types/dompurify** — deprecated; DOMPurify ≥3 ships its own TypeScript definitions.

---

## [0.77.0] — 2026-04-18

### Added
- **Flow Sessions screen** — New `#/instances/:slug/flows/:flowId/sessions` route with run-centric master/detail view. Left panel lists flow runs with status dots reflecting sitrep outcomes (green/orange/red). Right panel shows nested step accordions with lazy-loaded session messages, tool call expansion, and raw LLM toggle.
- **Live SSE streaming** — Active flow runs poll every 5s, expanding running steps auto-connects SSE for real-time message streaming. Running steps resolved via session label lookup (session_id assigned post-completion).
- **Sitrep-aware status colors** — Runs with only "partial" sitrep outcomes show orange ("partially failed") instead of red. Steps with non-success sitrep outcomes display accurate dot colors.
- **Backend enrichment** — `worstOutcome` field on flow runs list, `hasMore` pagination on runs endpoint, `getRunWorstOutcome()` repository function, session label lookup for running steps.

---

## [0.76.0] — 2026-04-18

### Added
- **Instance Dashboard screen** — New `#/instances/:slug/dashboard` route with a widget-based overview of a single instance. 2-column layout: 9 widgets (Agents, Tasks, Costs with sparkline, Activity, Flows, Heartbeat, Logs, Memory, Settings) + sticky mini-pilot sidebar.
- **Dashboard mini-pilot** — SSE chat sidebar (`cp-dashboard-pilot`) with permanent session detection, text-only message bubbles, streaming status indicator (5 phases), and input bar.
- **Clickable instance card** — Card body (status bar + meta) navigates to the instance dashboard on click.

---

## [0.75.1] — 2026-04-18

### Fixed
- **Circular dependency** — Extracted notification bridge from `dashboard/monitor.ts` into `lib/notification-bridge.ts` to break `monitor.ts → runtime/index.ts → engine.ts → monitor.ts` cycle that failed CI `madge --circular` check.

---

## [0.75.0] — 2026-04-18

### Added
- **System-pilot documentation workspace** — 45 documentation files in `templates/system/workspace/system-pilot/docs/` covering all ClawPilot features (instances, agents, flows, tasks, budgets, channels, monitoring, security, admin, UI, reference). Indexed by FTS5, searchable via `ws_search_files` at runtime.
- **External workspace file loading** — `SystemInstanceService._loadWorkspaceFiles()` scans `templates/system/workspace/<agentId>/` recursively for `.md` files and merges them into the team YAML at provisioning and template sync time. Combined hash (YAML + workspace files) ensures updates propagate on deploy.
- **System-pilot language directive** — SOUL.md updated with instructions to respond in the user's language and to search workspace docs before answering feature questions.

---

## [0.74.1] — 2026-04-17

### Fixed
- **Knip dead code false positive** — Replaced inline `import("./types.js").NotificationsPage` with a named import in `ui/src/api.ts` so knip correctly detects the type as used.

---

## [0.74.0] — 2026-04-17

### Added
- **Persistent notification inbox (INBOX-001)** — Bell icon with unread badge in the app bar opens a notification drawer. Backend: `notifications` table (migration v37) with insert/query/dedup (15-min window) and auto-prune (30 days). API: `GET /api/notifications` (cursor-paginated), `GET /api/notifications/unread-count`, `PATCH /api/notifications/:id/read`, `POST /api/notifications/mark-all-read`. Bus-driven emitter generates notifications for budget alerts, task status changes, heartbeat failures, runtime errors, permission requests, and flow completions. UI: `<cp-notification-inbox>` Lit component with severity icons, relative timestamps, and mark-read actions. 815+ lines of tests.

---

## [0.73.7] — 2026-04-17

### Changed
- **Instance card header simplified** — Removed state text label (`running`, `stopped`…) from the header badge; only the colored dot (or spinner) is displayed, with the state name as a `title` tooltip on hover. Also documented the conditional SYSTEM badge in the component spec.

---

## [0.73.6] — 2026-04-17

### Changed
- **File tree icons aligned to ClawPilot style** — Replaced emoji file (`📄`) and folder (`📁`) icons with geometric Unicode symbols (`◈` for files, `⊟` for folders), consistent with the rest of the UI (tool icons, context panel, instance card actions).
- **VS Code-style "New file" and "New folder" toolbar buttons** — The text "New file…" button in the workspace file tree header is replaced by two SVG icon buttons (add-file and add-folder, matching VS Code's explorer toolbar), with appropriate `title` tooltips. The "New folder" action opens a dedicated dialog that asks for a folder name and auto-creates a `README.md` inside it.

---

## [0.73.5] — 2026-04-16

### Added
- **CRUD workspace file tree for agents** — The "Files" tab in the agent detail panel is now a full workspace file manager with a collapsible tree view. Users can see every file in an agent's workspace (including those created by the agent itself via its Write tool), create files at arbitrary relative paths (including subdirectories like `memory/`), and delete files. Backend uses recursive workspace scanning (`walkWorkspaceFiles`) replacing the hardcoded `DISCOVERABLE_FILES` loop; `agent_files.filename` now stores relative paths (e.g. `memory/facts.md`). New routes: `GET /files` (hierarchical tree), `GET/PUT/DELETE /files/*` (wildcard paths). Path validation (`validateWorkspaceRelativePath`) rejects traversal, absolute paths, reserved segments, and disallowed extensions (only `.md`, `.txt`, `.json`, `.yaml`, `.yml`, `.csv`, `.log` allowed). Blueprint agents retain the legacy flat-tabs UI.
  - New UI components: `cp-agent-file-tree` (collapsible tree with per-directory "+" and per-file trash), `cp-new-file-dialog`, `cp-delete-file-dialog`.
  - `ServerConnection.readdirWithTypes()` added for efficient recursive directory walking.
- **Workspace knowledge plugin (`ws_list_files` + `ws_search_files`)** — New plugin `workspace-knowledge` registered for all instances gives every agent two tools to discover and search user-created workspace files on demand, with 0 permanent token cost in the system prompt.
  - `ws_list_files(dir?)` — lists files outside the identity/memory whitelist with extracted titles (first H1 or frontmatter `description:`) and sizes (~22 tokens/file).
  - `ws_search_files(query, dir?)` — FTS5 full-text search with BM25 ranking and snippet highlighting (~300 tokens/call for top-10 results).
  - DB migration v36 adds `agent_files_fts` (content-backed FTS5 virtual table) with sync triggers on INSERT/UPDATE/DELETE.
  - `AGENTS.md` template updated with a "Workspace files" section guiding agents on when to use these tools.

### Changed
- System prompt construction (`DISCOVERY_FILES_*` whitelists) is unchanged — workspace files outside the identity/memory set are accessible via the new tools but do not automatically enter the prompt.

---

## [0.73.4] — 2026-04-16

### Added
- **Configurable maxSteps per flow step (default 50, soft/hard cap with extension).** Flow step agents previously hit the global `maxSteps=20` cap before completing multi-tool missions (run #6: `site-maintainer` needed ~30 steps for clone → read × 6 → edit × 6 → git → PR → `complete_step`). Flow steps now default to 50 LLM steps (vs 20 for interactive sessions), configurable per step via `FlowStepDef.maxSteps` and the flow editor UI.
  - **Soft cap + extension mechanism**: when the agent approaches `maxSteps`, a system reminder is injected offering two choices: call `complete_step` to finish, or call `request_step_extension` to get more steps. The extension tool mutates a shared state object that the `stopWhen` closure reads dynamically — no SDK restart needed. The hard cap is `softCap × 2` (capped at 200 absolute).
  - **`request_step_extension` tool**: new factory tool injected alongside `complete_step` in flow step sessions only (NOT in `BUILTIN_TOOLS`). Takes `{ reason, additionalSteps }`, grants up to hard cap, denies if already at limit.
  - **Flow editor UI**: new "Max steps" field in the Advanced panel, alongside Timeout and Retries. Defaults to 50, serialized only when non-default.

### Changed
- `PromptLoopInput` and `RouterInput` gained `maxSteps?: number` and `flowStepState?: FlowStepState` fields for the soft/hard cap mechanism.
- Flow step system reminder is now flow-specific (mentions `complete_step` and `request_step_extension`) and appears 2 steps before the limit (instead of 1 for interactive sessions).

---

## [0.73.3] — 2026-04-16

### Added
- **Automatic tool call repair for all sessions** — enabled `experimental_repairToolCall` on the Vercel AI SDK `streamText` call. When a model produces malformed JSON arguments (e.g. markdown bullets instead of a JSON array, observed on MAC run #5 where `complete_step` keyFindings was emitted as `\n  - item1\n  - item2` instead of `["item1", "item2"]`), the repair function first attempts a lightweight local fix (regex markdown-bullets → JSON array), and if that fails, returns `null` so the SDK surfaces the error to the model on the next step for self-correction. This is global — it benefits every tool in every session type (permanent, Telegram, web-chat, flow steps, subagent delegations), not just flow steps.

---

## [0.73.2] — 2026-04-15

### Added
- **`complete_step` tool — structured, forced SITREP for flow steps.** The flow engine now injects a per-step-run tool called `complete_step` into the toolset of every flow step agent. The agent calls it with `{ outcome, summary, keyFindings }` as its final action; the tool writes the structured SITREP directly to `rt_flow_step_runs.sitrep_json` via a DB handle captured at construction time. This replaces the fragile regex parsing of free-text responses, which broke every time an agent ended its turn without printing the `OUTCOME:` block verbatim (observed on MAC runs #3 and #4 — `site-maintainer` did real work but never emitted a parseable SITREP, leading to false `partial`/`failure` outcomes). A custom `hasToolCall("complete_step")` stop condition ends the loop immediately when the tool fires, saving tokens.
  - Scope: the tool is created via a factory (`createCompleteStepTool(db, stepRunId)`) and injected ONLY into flow step sessions via the new `extraTools` parameter. It is NOT registered in `BUILTIN_TOOLS`, so it is structurally invisible in permanent sessions, Telegram, web-chat, task sessions, and subagent delegations.
  - Fallback: if a step finishes without calling `complete_step`, `extractSitrep(result.text)` still runs as a legacy escape hatch. Combined with the v0.73.1 `failure` default, a silent stop is now reliably surfaced.

### Changed
- `PromptLoopInput` and `RouterInput` gained an optional `extraTools?: Tool.Info[]` field — a generic injection point for caller-provided tools. `buildToolSetForLoop()` appends them to the tool set after `getToolsForAgent()`, bypassing the `toolProfile` filter (the caller is responsible for correctness).
- Flow step briefing no longer instructs the agent to emit a markdown SITREP block; it now describes the mandatory `complete_step` tool call.
- Flow engine reads `sitrep_json` back from the DB after each step: if `complete_step` was called, that value is trusted; otherwise `extractSitrep()` falls back to parsing the result text.

---

## [0.73.1] — 2026-04-15

### Fixed
- **Missing SITREP now correctly maps to `outcome: "failure"` (was `"partial"`)** — when an agent finishes a flow step without emitting any `OUTCOME:` marker, `extractSitrep()` used to default to `outcome: "partial"` with a misleading first-500-chars summary. "partial" is semantically reserved for agents that explicitly report incomplete work; a missing SITREP is a reporting-contract failure and must be surfaced as such. Observed on MAC web-maintenance run #3: `site-maintainer` edited all files and ran `git status`, then stopped without committing/pushing, leaving an empty SITREP — but it was stored as `partial` and the misleading value propagated into `notify`'s dep context. Engine-level behavior is unchanged (both outcomes already trigger skip propagation and failed run status), only the stored value is now honest.
- **Flow step briefings no longer inject permanent session history by default** — `buildBriefing()` used `step.briefing.includeLastN ?? 5`, which meant every flow step received the last 5 messages from the agent's permanent session as "Standing context". Those messages include `injectSitrep()` payloads from previous runs, which cross-contaminated new briefings with stale step names and outcomes. Observed on MAC run #3: the reporter hallucinated "write-content" (the step name from run #2, which no longer exists in run #3's definition) because run #2's SITREP was still in its permanent session's last-5-messages window. Default is now `0`; agents that genuinely need institutional memory across runs can opt-in via `step.briefing.includeLastN` in the flow definition JSON.

---

## [0.73.0] — 2026-04-15

### Added
- **Flow engine: outcome-driven control flow** — sitrep `outcome` now drives the DAG instead of being decorative metadata. When a step completes with `outcome=failure` / `outcome=partial` (or with a malformed/missing sitrep), every dependent step is eagerly marked `skipped` with an explanatory error message, unless the step opts in via the new `continueOnFailure: true` flag (typical for `notify` / cleanup steps that should run no matter what). The overall flow run is now marked `failed` whenever any step did not finish with `outcome=success`, instead of falsely reporting `completed` as long as no JS exception was thrown. Root cause: web-maintenance run #2 observed on MAC was marked `completed` despite `write-content` returning `outcome=partial` with empty summary, `open-pr` returning `outcome=failure`, and no PR actually being created.
- `FlowStepDef.continueOnFailure?: boolean` — opt-in escape hatch for steps that should run despite upstream non-success. Default `false`.
- `hasUnsuccessfulSteps(runId)` repository helper — counts completed steps whose sitrep outcome is not `success` (or is missing / malformed).
- `propagateSkipDownstream()` engine helper — recursively marks dependent pending steps as `skipped`, respecting `continueOnFailure` to stop propagation on opt-in boundaries.
- Comprehensive test coverage: 6 new tests for `propagateSkipDownstream`, 5 for `hasUnsuccessfulSteps`, 3 for `getReadySteps` with `continueOnFailure`.

### Changed
- `getReadySteps()` — a step with `continueOnFailure: true` is now considered ready when its dependencies are in any terminal state (`completed`, `failed`, or `skipped`). Regular steps still require every dependency to be `completed` with `outcome=success` (the engine guarantees this invariant by skipping dependents eagerly).
- Final flow run status aggregation — `failed` if `hasFailedSteps() || hasUnsuccessfulSteps()`, `completed` otherwise.

---

## [0.72.13] — 2026-04-15

### Fixed
- **Flow engine: root steps without `dependsOn` no longer crash the DAG** — agents creating flows via `cp_create_flow` can legitimately omit `dependsOn` on root steps (the Zod schema marks it optional). But `FlowStepDef.dependsOn` was typed as required in `src/runtime/flow/types.ts`, and `engine.ts::collectDepSitreps` iterated it directly, throwing "dependsOn is not iterable" on the first step. Observed on MAC: the web-maintenance "Daily Web Maintenance" flow deadlocked on its first run because the `analyse` step crashed with no `dependsOn` field, leaving 3 downstream steps pending. `getReadySteps` already handled this correctly; only the engine's dep collection was missing the guard. Made `dependsOn` optional in the type and added a `?? []` guard before iteration. 5 new regression tests cover the omitted-field case in `getReadySteps` and `_collectDepSitreps`.

---

## [0.72.12] — 2026-04-15

### Fixed
- **CI: security audit steps no longer block the pipeline** — npm retired its legacy audit endpoints (`/npm/v1/security/audits/quick`, `/npm/v1/security/audits`) returning 410 Gone, causing the Quality job to fail before any other check ran. Marked both `pnpm audit` steps as `continue-on-error: true` so audit output remains visible in CI logs without blocking format, typecheck, lint, or complexity checks.

---

## [0.72.11] — 2026-04-15

### Fixed
- **Assistant text parts now split around tool calls in the timeline** — `StreamingState.textPartId` was never reset between Vercel AI SDK steps, so when the LLM produced text, then a tool call (question, A2A delegation), then more text in the next step, the pre- and post-tool-call text were appended to the **same** `text` part (sort_order 0), while the `tool_call` part was persisted in between with a higher sort_order. Timeline rendered as one merged text blob with the question/delegation card visually pushed after it. Reset `textPartId` + `accumulatedText` in `handleToolCallChunk` so the next text-delta creates a fresh part, correctly interleaved after the tool_call.

---

## [0.72.10] — 2026-04-15

### Fixed
- **Questions now appear in real time in the UI** — the `question` tool emits a `question.asked` SSE event when it suspends the prompt loop, but neither `home-chat.ts` nor `runtime-pilot.ts` had a handler for it. The switch statement silently dropped the event in the default case, so subagent-initiated questions only appeared after the user pressed F5. Added a `question.asked` case in both components that calls `_refreshMessages()` / `_reloadLastMessages()`, mirroring the existing `suggestions.generated` handler.

---

## [0.72.9] — 2026-04-15

### Fixed
- **cp-system subagents now load their SOUL.md** — the 5 subagents (admin-exec, config-exec, analyst, architect, db-analyst) had `promptMode: subagent` which restricted the system prompt to AGENTS.md only. Their rich SOUL.md content (DB schema, CLI commands, providers, archetypes) was written to disk but never injected into the LLM context. Switched to `promptMode: minimal` so SOUL.md + AGENTS.md + USER.md + memory files are all loaded.
- **Template sync now runs at dashboard startup** — `_syncTemplateIfChanged` was only triggered via `POST /api/system/ensure` from the UI. After a redeploy, cp-system kept its stale workspace files + agent configs until a user clicked the provisioning button. Moved the sync call into `ensureRunning` so a redeploy is enough to propagate YAML template updates.
- **Template sync now updates agent configs** — the existing sync only re-wrote workspace files, leaving `config_json` (promptMode, toolProfile, archetype) untouched. Extended to also UPDATE `agents.config_json` from the YAML's agent.config block while preserving per-agent DB-only metadata (role, tags, notes, position).
- **E2E flow test** — `flow.e2e.test.ts` hardcoded `FLOW_PORT = 19165` which became obsolete since v0.72.8 introduced the OS username salt. Derive the port at runtime via `deriveWebChatPort(FLOW_SLUG)` so the test works under any username (CI runner, swoelffel, etc.).

### Changed
- **Enriched domain knowledge per cp-system agent in the YAML template**:
  - **db-analyst**: complete DB schema (added rt_task_activities, rt_budget_events, rt_permissions, rt_auth_profiles, agent_links, agent_blueprints, users, user_profiles) + 6 ready-to-use SQL query patterns (cost, budget, sessions, flow failures, tasks)
  - **analyst**: 7 key metrics to report + data source mapping
  - **architect**: archetype/tool-profile tables + link types + SOUL.md structure guide
  - **admin-exec**: instance lifecycle states + agent provisioning fields
  - **config-exec**: supported providers table + named-key concepts

---

## [0.72.8] — 2026-04-14

### Added
- **Multi-user port isolation** — ClawPilot installations for different OS users on the same machine no longer collide on ports.
  - `deriveWebChatPort` and `deriveInternalApiPort` now salt the hash with `os.userInfo().username`
  - EADDRINUSE retry: up to 5 consecutive ports attempted before failing
  - Port file discovery: runtime writes the actually-bound port to `stateDir/{api,webchat}.port`; dashboard reads from there with fallback to derivation
  - DB migration v35: recalculates stored ports with the salted hash

---

## [0.72.7] — 2026-04-14

### Changed
- **Documentation restructured for vibecoders**: split the 807-line monolithic `main-doc.md` into 7 focused files under `docs/architecture/` (data-model, code-structure, features-cli, dashboard, api-reference, runtime-engine, plus index). Added onboarding `docs/README.md` with documentation map.
- **SSE architecture documented**: new `docs/sse-architecture.md` covers all 3 SSE streams, WebSocket monitor, 43 bus event types, proxy layer, reconnection strategy, and auth mechanisms.
- **UX design synced to v0.72.6**: added 6 missing hash routes (#/home, memory, heartbeat, session-logs, flows, flow-run), 10 new components, 4 new screens, and update history entries for v0.70–v0.72.

### Added
- 3 new screen docs: `screen-home.md`, `screen-flow-list.md`, `screen-flow-run-detail.md`
- 9 new component docs: `comp-home-chat.md`, `comp-home-wizard.md`, `comp-command-palette.md`, `comp-pilot-part-delegation-expand.md`, `comp-pilot-part-reasoning.md`, `comp-epic-tree.md`, `comp-flow-editor.md`, `comp-task-card.md`, `comp-task-detail.md`

---

## [0.72.6] — 2026-04-14

### Changed
- **Zero complexity baseline** — refactored 44 files to eliminate all 64 ESLint `sonarjs/cognitive-complexity` and `max-lines-per-function` warnings. Every function in the codebase now passes strict thresholds (cognitive complexity ≤20, max 150 lines per function) with zero exceptions.
- **Removed BASELINE_FILES from eslint.config.js** — all code is now enforced at error level. New complex code will be blocked at CI.

### Added
- `src/runtime/session/_prompt-loop-handlers.ts` — extracted chunk handlers, watchdog manager, and compaction logic from `prompt-loop.ts`
- `src/runtime/tool/_task-handlers.ts` — extracted A2A delegation, subagent execution, and contract verdict logic from `task.ts`
- `src/runtime/tool/built-in/_skill-frontmatter.ts` — extracted frontmatter parsing and eligibility checks from `skill.ts`
- `src/runtime/tool/built-in/_skill-remote.ts` — extracted remote skill fetching from `skill.ts`

---

## [0.72.5] — 2026-04-14

### Changed
- **Enterprise-ready: DB-direct system tools** — replaced the HTTP-proxy `system-dashboard` plugin with a new `system-tools` plugin that queries `registry.db` directly via Registry, Lifecycle, Provisioner, and Destroyer. The 22 `cp_*` tools no longer depend on the dashboard REST API or `CLAW_DASHBOARD_TOKEN`. Each component (dashboard, runtime) now connects to the DB independently — first step toward externalized DB architecture.
- **Reinforced cp-system agent prompts** — converted all 5 subagent inline `systemPrompt` to SOUL.md workspace files with ClawPilot architecture context, explicit filesystem constraints, and role-specific tool documentation. Agents can no longer hallucinate about editing `runtime.json`.

### Removed
- **Dashboard token synchronization** — removed `syncDashboardToken()`, `CLAW_DASHBOARD_URL`, and `CLAW_DASHBOARD_TOKEN` from `.env` files. The runtime no longer needs the dashboard to be running for `cp_*` tools to work.
- **`system-dashboard` plugin** — deleted `src/runtime/plugin/system-dashboard/` (HTTP proxy approach).
- **`sentinel-runtime.json` example** — removed obsolete example file and HEARTBEAT.md reference.

### Fixed
- **Tool output sanitization** — `cp_get_instance` and `cp_list_instances` no longer expose `config_path`, `state_dir`, and `systemd_unit` to agents, preventing hallucinations about filesystem editing.

---

## [0.72.4] — 2026-04-14

### Fixed
- **Thinking blocks visible by default**: reasoning traces no longer disappear after streaming completes. `thinking` filter now defaults to `true` in both the home chat and runtime pilot.
- **Streaming timestamp includes seconds**: live streaming entries now show `HH:MM:SS` instead of `HH:MM`, matching persisted timeline entries.

---

## [0.72.3] — 2026-04-14

### Changed
- **Setup wizard replaced with form**: the chat-bubble wizard for initial setup is replaced by a single-page form. All fields (provider, API key, model) are visible at once. New profile section collects display name, language (auto-detected from browser), and timezone (auto-detected). Localized in 6 languages.

---

## [0.72.2] — 2026-04-14

### Fixed
- **SSE bridge across dashboard/daemon processes**: dashboard and runtime daemons run as separate OS processes, each with their own in-memory Bus. SSE routes in the dashboard subscribed to an empty local bus — events like `session.status`, `message.part.delta` never reached the browser. New bidirectional HTTP bridge: daemon exposes `GET /internal/events/stream` (SSE) and `POST /internal/events/publish`, dashboard proxies via `_sse-proxy.ts` and `publishRuntimeEvent()`. All 4 broken communication paths fixed (SSE streaming, permission replies, system state, workspace file changes). Status-pill now reflects real runtime activity.
- **Answered question detection**: detect answered question from `call.state` instead of only from result part.
- **UI unblock after pendingQuestion**: transition session status to `thinking` when `pendingQuestion` response is received, preventing the UI from staying stuck on "sending".
- **Delegation trace timestamps**: backdate delegation traces to their actual start time and add seconds precision to the timeline display.

---

## [0.72.1] — 2026-04-14

### Fixed
- **Home/Pilot UI frozen on "sending…" when the agent asks a question**: `POST /api/instances/:slug/runtime/chat` proxied to `/internal/chat` which awaited `ChannelRouter.route()` → `runPromptLoop()`. When the loop hit the `question` tool, it blocked on the user's answer (Promise resolved by `resolveQuestion`), so the HTTP request never returned. The UI's `await postRuntimeChat()` stayed pending and `_status` remained `"sending"` — forcing a manual refresh to see the pending question card. Fix: `engine.handleChat` now races the route vs the first `question.asked` bus event; when the race is won by the question, it returns `{ sessionId, pendingQuestion: true }` while the route keeps running in the background. SSE events continue to deliver live updates. The UI (`home-chat`, `runtime-pilot`) interprets `pendingQuestion: true` as "stay busy, don't flip to idle".
- **SSE stream rejected with HTTP 401 on strict browser SameSite policies**: `EventSource` cannot set an `Authorization` header, and `new EventSource(url)` without `withCredentials: true` does not send cookies on all browsers. The server auth middleware (`/api/*`) now also accepts the bearer token via `?token=<value>` query string (timing-safe compare). The UI opens `EventSource(url, { withCredentials: true })` so the session cookie is sent consistently.

### Added
- **SSE diagnostic logging opt-in**: toggle in browser devtools via `localStorage.setItem('cp:debug-sse', '1')` then reload. Logs every connection, event, and error under the `[cp:sse]` prefix. New helper `ui/src/services/debug.ts::debugSse`.

---

## [0.72.0] — 2026-04-13

### Added
- **Question UX overhaul (AskUserQuestion-style)**: the `question` tool now accepts a `questions: [{header, question, answerType, options?, allowOther?}]` array of 1..4 items. Each item has its own `answerType`: `"single"` (pick one option), `"multi"` (pick one or more), or `"free"` (open text). `allowOther: true` appends an "Other…" free-text field alongside options. The UI renders the card with one tab per question, completion dots per tab, and a single **Send** button that submits all answers atomically — no more accidental auto-submit on option click. Summary format for the agent's next turn is structured (e.g. `1. [label] → opt1, Other: custom`).
- **Chat input lockout while a question is pending**: the main chat input is now disabled (with the contextual placeholder "Answer the question above to continue" plus a ⬆ badge) as long as the latest assistant message has an unresolved `question` tool_call. Prevents the deadlock where typing in the chat bar would queue a message behind the blocked question Promise.
- **Telegram: sequential multi-question flow**: when the tool is called with `questions.length > 1`, items are presented one at a time with progress `(1/3)` prefix. `single` uses an inline keyboard (click = select + advance), `multi` uses togglable ☑️/☐ buttons + ✅ Confirm, `free` awaits the next plain-text reply. `allowOther` adds a 💬 button that switches the current item into awaiting-text mode.

### Changed
- `createUserMessage` accepts an optional `metadata` param (used by delegation-drilldown injection since v0.71.3).
- `QuestionAsked` bus event payload gains `questions: QuestionItem[]`. Legacy `question` / `options` fields remain populated from the first item for backward-compat with pre-v0.72 subscribers.
- `TelegramPoller.sendMessage` returns the sent message id (when available) so the channel can later `editMessageReplyMarkup` on multi-select toggles. New helper `editMessageReplyMarkup(chatId, messageId, markup)`.

### Backward compatibility
- The tool still accepts the legacy flat shape `{question: "...", options?: [...]}` — it is auto-wrapped into a single-item `questions[]` at `execute()` time. Historic `question` tool_call parts (stored in sessions before v0.72) render via the same flat-shape fallback in `part-question.ts`.
- Legacy Telegram callback data `q:<id>:<url-encoded answer>` is still honored when no in-flight state exists.

---

## [0.71.3] — 2026-04-13

### Added
- **Delegation drill-down**: `[delegation]` and `[Async subagent result]` traces in the Pilot & Home timelines are now **clickable** and expand in-place to show the full sub-session — assistant text, tool calls + results, reasoning, and a summary pill (steps · tokens · cost · duration). Nested delegations drill down recursively. Lazy-loaded on first click via the existing `GET /runtime/sessions/:id/messages` endpoint. Filters from the parent timeline (tools, thinking, etc.) are honored inside nested timelines.

### Changed
- **Runtime** — delegation traces now carry `subSessionId` in the text part's metadata JSON. `createUserMessage()` accepts an optional `metadata` param. `PromptLoopInput.userMetadata` threads through to the async-subagent-result injection in `channel/router.ts`. Traces written before v0.71.3 remain backward-compatible: legacy async-result traces still resolve via the `task_id:` fallback regex; legacy delegation traces render read-only (no drill-down).

---

## [0.71.2] — 2026-04-13

### Fixed
- **`cp_*_flow` tools returned HTTP 404**: the system-dashboard tools `cp_list_flows`, `cp_create_flow`, `cp_run_flow`, `cp_delete_flow` hit `/api/instances/{slug}/runtime/flows` which does not exist — the real route is `/api/instances/{slug}/flows`. All four tools called from agents (e.g. `admin-exec` on cp-system) failed silently with 404, breaking any flow creation via delegation. Stale `/runtime/` prefix removed from all four endpoints.
- **`cp_create_flow` step schema mismatch**: the tool declared step fields as `{ id, agentId, briefing: string, dependsOn? }` but the dashboard route expects `{ id, agentId, prompt: string, dependsOn?, timeoutMs?, retries?, briefing?: object }`. The tool now sends `prompt` (the step instruction), aligned with `FlowStepSchema` in `src/dashboard/routes/instances/flows.ts`.

---

## [0.71.1] — 2026-04-13

### Changed
- **Extended thinking enabled by default** for:
  - The cp-system `system-pilot` agent (on fresh installations — existing installs unaffected). Pairs with the v0.71.0 live reasoning streaming so new users see the "Thinking…" card out of the box.
  - New default pilot agent on fresh instance provisioning (`createDefaultRuntimeConfig`).
  - Agents created via the dashboard (`AgentProvisioner.createAgent`).
  - Budget: `4000` tokens. Only honored by Anthropic providers (see prompt-loop.ts) — non-Anthropic models silently ignore the setting.

---

## [0.71.0] — 2026-04-13

### Added
- **Live reasoning streaming in Pilot & Home chat**: agents that emit reasoning tokens (Anthropic extended thinking, Gemini 2.5 Pro, OpenAI o3) now surface those tokens in real-time as a collapsible "Thinking…" card under the assistant bubble. The card shows a live preview of the last reasoning line (truncated to 80 chars) and a pulsing dot while the stream is active; expanding it auto-scrolls as new tokens arrive. The `thinking` filter is overridden while the reasoning part is streaming (`state === "running"`), then respected once the part is finalized — so Home keeps its clean history even though live feedback is always visible. Implemented via a new `partType: "text" | "reasoning"` discriminator on the existing `message.part.delta` bus event (backward compatible).
- **5-phase status indicator in Pilot header**: the generic `sending`/`streaming` pill is replaced by phase-aware labels — `sending…`, `thinking…`, `using <tool>…`, `responding…`, `idle`. Tool phase is driven by two new bus events `tool.call.started` and `tool.call.ended` emitted from the prompt-loop `onChunk` callback.

---

## [0.70.4] — 2026-04-13

### Fixed
- **Plugin tools (e.g. `cp_create_instance`) silently missing from every agent's toolset**: `ClawRuntime.start()` called `registerPlugin()` for the `system-dashboard` plugin but never `initPlugins()`, so the plugin factory was never invoked and no hooks were registered. As a result, every agent on `cp-system` (including the pilot and `admin-exec`) was missing the full suite of admin CRUD tools — the LLM hit the `invalid` fallback tool when trying to call them, producing refusals shaped like `{"toolName": "cp_create_instance", "reason": "Tool not available in current environment"}`. Fix: invoke `initPlugins()` right after `registerPlugin()` at runtime startup, and `resetPlugins()` on `stop()` to keep the module-global registry clean between restarts. Also extracted a shared `getRuntimeVersion()` helper used by both the engine and the prompt-loop. Adds 2 regression tests pinning the plugin-hook registration behavior.

---

## [0.70.3] — 2026-04-13

### Changed
- **pnpm pinned to 10.33.0 via `packageManager` field**: all environments (local, CI, Docker, self-updater targets) now install the exact same pnpm version. Eliminates "latest" surprises and makes future pnpm upgrades deterministic. Combined with the self-updater bootstrap from v0.70.2, pnpm version switches on existing installs happen transparently via `corepack prepare`.
- **`pnpm/action-setup` bumped to v6.0.0** in CI workflows (`ci.yml`, `deps-check.yml`). v6 reads the `packageManager` field automatically, so the explicit `with: version: latest` override is removed.
- **Dockerfile** pins `pnpm@10.33.0` explicitly.

Stays on pnpm 10 — pnpm 11 is still pre-release (latest on npm is `11.0.0-rc.0`). Upgrade to 11 will be a separate change once it ships stable. Supersedes #62.

---

## [0.70.2] — 2026-04-13

### Added
- **Self-updater bootstraps pnpm via corepack**: before `pnpm install`, the self-updater reads the `packageManager` field from `package.json` and runs `corepack prepare <value> --activate` so the next install uses the pinned pnpm version. Prerequisite for future pnpm major upgrades — without this, an update that ships a newer-format lockfile would fail on hosts still running the old pnpm. Non-breaking: silent no-op when the field is absent or not a pnpm pin.

---

## [0.70.1] — 2026-04-13

### Fixed
- **`uninstall.sh` — orphan and other-user systemd scans never executed on Linux**: `OS=$(uname -s)` was assigned at Step 3 but referenced earlier in Step 1b/1c (orphan service files + multi-user detection), so `[ "$OS" = "Linux" ]` was always false. Moved the `OS` assignment before Step 1b. macOS uninstall flow was unaffected.

---

## [0.70.0] — 2026-04-13

### Added
- **Lean Home chat** (`cp-home-chat`): dedicated simplified component for `/home` — compact header with status and cumulative tokens/cost, messages list, input bar. No right side panel, no filter bar, no agent tabs. The full pilot remains at `/instances/cp-system/pilot`.
- **Live ClawPilot state in cp-system prompts**: every cp-system agent now receives a `<clawpilot_state>` block in its system prompt summarizing named API keys (with usage count), instances (with state), blueprints, and configured providers.
- **`SystemStateChanged` bus event**: emitted from dashboard routes (named-keys, instance lifecycle, blueprints) so the cp-system engine can invalidate cached prompts when platform state changes.
- **Bundled-question detection**: the `question` tool rejects questions containing multiple "?", numbered lists, or bullet lists — forces agents to ask one question at a time.
- **User answers in chat flow**: answers to questions now appear as `YOU` entries in the timeline (synthetic user_chat entry built from the completed tool_call content).

### Changed
- **Question tool UX**: free-text input is now a multi-line `<textarea>` (Enter sends, Shift+Enter inserts newline), and the free-text field is always shown alongside option buttons with an "or type your own" separator.
- **Delegation rendering**: `[delegation] Asked X` / `[delegation] X asked` traces from the `task` tool are now rendered as A2A entries (pink ⬡→ style), not as `YOU` user_chat.
- **Question tool kind**: questions now have their own `"question"` timeline kind (always visible), decoupled from the generic `tool_call` filter.
- **Pilot status during question wait**: clicking an answer flips the status to `streaming` optimistically, and `session.status: idle` at loop end triggers a message reload to guarantee the assistant reply appears without manual refresh.

### Fixed
- **Question tool blocked forever**: the tool's `QuestionAsked` bus event was published on the wrong bus (`ctx.agentId` used as slug); now uses `ctx.instanceSlug`.
- **Question answer routing (IPC)**: dashboard and runtime are separate processes. The dashboard was importing `resolveQuestion()` directly, hitting an empty `_pending` map. Answers now flow via a new `/internal/questions/:id/answer` endpoint on the runtime's internal API.
- **Question ID mismatch**: the tool used a `nanoid` while the UI sent the Vercel AI SDK `toolCallId`. Now both use `toolCallId` so answers resolve correctly.
- **Subagents should not ask the user**: the `question` tool is now stripped from the toolset of any agent whose `kind === "subagent"` (same filter as `task` and `send_message`). Also hardens the runtime with a channel guard refusing non-interactive sessions (no human on the loop).
- **Kind inference for user-defined agents**: `createFromConfig()` now infers `kind: "subagent"` when `promptMode: subagent` or `persistence: ephemeral` — admin-exec, architect, etc. are correctly registered as subagents.
- **Watchdog timeouts during user wait**: the prompt-loop chunk-timeout (120s) and agent-timeout (5 min) fired while the question tool was waiting for a human answer. Added `ctx.onLongWait(fn)` — used by the question tool to suspend both watchdogs during the Promise await.
- **Home status stayed `idle` during active loop**: `message.updated` no longer forces `idle`; busy/idle transitions rely on `session.status` events only.
- **Question tool card hidden by "tools: false" filter**: questions now have a dedicated kind that has no filter mapping and is always shown.
- **Answer extraction**: the previous fix searched for a separate `tool_result` part that doesn't exist in claw-runtime — the output is on the `tool_call` part's own `content`. Fix reads directly from there.
- **cp-system template auto-sync**: `ensureProvisioned()` now compares the YAML template hash with a stored hash and re-syncs workspace files when the template changes — previously, deploying a modified `cp-system.team.yaml` had no effect until manual re-provision.

---

## [0.69.1] — 2026-04-12

### Changed
- **CI complexity gate**: cognitive complexity (≤20) and max function length (≤150 lines) enforced via eslint-plugin-sonarjs — 43 legacy files baselined as warnings
- **Instance middleware**: replaced 104 `instanceGuard` duplications with a single Hono middleware
- **Config PATCH decomposition**: extracted 300-line monolithic handler into 5 focused functions
- **Route splitting**: runtime.ts (800 lines) → 4 modules, tasks.ts (529 lines) → 3 modules
- 47 new tests (2204 total), coverage thresholds adjusted for refactoring

### Fixed
- Workspace cache invalidation holes in runtime daemon
- System pilot now uses question tool for user interactions
- knip false positives on Lit custom elements (HomeScreen, HomeWizard)

---

## [0.69.0] — 2026-04-12

### Added
- **HOMEBOT — Chatbot home screen**: new dashboard entry point with conversational system pilot
- System instance (`cp-system`) auto-provisioned with 6 agents and 6 pre-configured flows
- Home tab as first navigation tab, logo navigates to Home
- Chat-styled setup wizard for first API key and model selection
- System dashboard plugin: 22 tools calling dashboard REST API (instance CRUD, agent management, flow control, API key management)
- `db-analyst` subagent with read-only SQL query tool (`cp_query_db`) on the registry database
- `POST /api/system/query` endpoint for read-only SELECT queries (secrets masked)
- System instance badge ("System") in cluster view instance cards
- Schema v34: `is_system` column on instances table
- `templates/system/cp-system.team.yaml` — editable team config for the system instance
- `templates/system/cp-system.flows.json` — 6 pre-configured flows (Health Check, Onboarding, Cost Audit, Config Backup, Team Builder, Team Optimizer)

### Changed
- Default route changed from cluster view to Home screen
- Provisioner now syncs RuntimeConfig agents with WizardAnswers IDs after creation
- Team import (`importInstanceTeam`) now syncs merged config to DB, propagates `defaultModel` to agents without explicit model
- `LogFormat` type extended with `"compact"` value
- Compaction threshold schema relaxed to accept legacy integer values

### Fixed
- `buildAgentConfig` used `agent.name` (display name) instead of agent ID for config lookup — caused promptMode, archetype, and all RuntimeAgentConfig fields to be lost (masked by case-insensitive macOS)
- RuntimeConfig schema rejected valid configs with `log.format: "compact"` and `compaction.threshold: 40`, causing silent `getRuntimeConfig()` null return and fallback to minimal config
- System instance cannot be deleted (403) or stopped (403) via API
- All system subagents use `toolProfile: sentinel` (no bash/write/edit access)

---

## [0.68.0] — 2026-04-11

### Added
- **FLOW-001 — Declarative workflow orchestration engine**: DAG-based multi-agent workflows with fan-out/fan-in parallel execution
- Schema v33: `rt_flow_definitions`, `rt_flow_runs`, `rt_flow_step_runs` tables
- Flow engine: topological sort, cycle detection, timeout, cancel, Promise.race step completion
- Briefing/SITREP cycle: permanent session context → mission session → structured result summary
- API: 9 flow endpoints with Zod validation + DAG cycle detection
- UI: `cp-flow-list` (run/edit/delete), `cp-flow-editor` (agent select dropdown, DialogMixin), `cp-flow-run-detail` (live polling, step cards, SITREP expandable)
- Bus events: FlowRunStarted, FlowStepCompleted, FlowRunCompleted
- Flows added to FTS5 search index

### Changed
- **Runtime internal API**: all agent execution moved from dashboard to runtime daemon via internal HTTP API (`node:http`, port 19200-19299, Bearer auth via `timingSafeEqual`)
- Dashboard `POST /runtime/chat` simplified from ~230 to ~30 lines (HTTP proxy)
- Dashboard `_wakeup-agent.ts` simplified from ~150 to ~20 lines
- Flow step execution uses `ChannelRouter.route()` directly with runtime's pre-initialized context
- `loadMergedConfigDbFirst` relocated from dashboard to `src/runtime/config/loader.ts`
- Instance must be **running** for chat, flows, and agent wakeup (503 when stopped)

### Fixed
- Flow Run button disabled with tooltip when instance is stopped
- SITREP extraction regex tolerates markdown decoration (`## **OUTCOME**:`, `**OUTCOME**:`)
- Flow step messages now persist in mission sessions (visible in session logs)
- Flow editor correctly parses API response format (`steps_json`, `trigger_json`)

---

## [0.67.1] — 2026-04-11

### Fixed
- **Model selectors harmonized**: heartbeat model dropdowns in instance settings and agent detail panel now filter by API key provider instead of showing all providers
- Extracted `_getSelectedProviderModels()` helper in instance-settings for consistent provider-based model filtering
- Agent heartbeat "Model override" field changed from free-text input to filtered `<select>` dropdown
- Circular dependency between task and activity repositories resolved

---

## [0.67.0] — 2026-04-10

### Added
- **Command Palette (SEARCH-001)**: global search via Cmd+K / Ctrl+K across all entities
- Schema v32: `search_index` (FTS5 contentless) + `search_index_map` (shadow table for rowid tracking)
- Search repository: `upsertSearchEntry`, `removeSearchEntry`, `searchEntities` (BM25 ranking, prefix matching), `rebuildSearchIndex`
- API endpoint: `GET /api/search?q=<term>&limit=<n>` with Zod validation
- Incremental index hooks on all entity mutation paths (instances, agents, tasks, blueprints, templates, team imports)
- UI: `cp-command-palette` component with keyboard navigation (arrows, Enter, Escape), grouped results, debounced input
- Search button with ⌘K hint in dashboard header
- i18n: 8 new search keys × 6 languages

---

## [0.66.0] — 2026-04-10

### Added
- **Activity timeline (TIMELINE-001)**: chronological log of all task mutations per task
- Schema v31: `rt_task_activities` table with cascade delete, indexed by task + date
- Repository: `insertActivity`, `getActivities`, `getActivityCount`, `recordFieldChanges` (field-level diff detection)
- API endpoint: `GET /tasks/:id/timeline` with pagination
- Activity capture on all mutation paths: dashboard routes, agent tool actions, auto-complete epic (system actor)
- UI: Comments section replaced by unified Activity timeline (mutations + comments interleaved)
- i18n: 12 new activity description keys × 6 languages

---

## [0.65.1] — 2026-04-09

### Fixed
- **Heartbeat overhaul**: permanent sessions, timezone validation, structured status in `finish_reason` for tool-only responses
- **Blueprint validation**: return specific error codes (`BLUEPRINT_NAME_REQUIRED`, `INVALID_AGENT_ID`, `FIELD_REQUIRED`) instead of generic `INVALID_BODY`

---

## [0.65.0] — 2026-04-09

### Added
- **Epic hierarchy (GOAL-001)**: enriched task board with epic/task type system and parent_id hierarchy
- Schema v30: `type` (epic/task) and `parent_id` columns on `rt_tasks`
- 6 new repository functions: getEpicsForInstance, getChildTasks, getEpicProgress, getAncestryChain, validateParentId, tryAutoCompleteEpic
- API endpoints: `GET /epics`, `GET /epics/:id/children`, type filter on `GET /tasks`
- Tool `task_board`: `list_epics` action, `type` and `parentId` parameters on `create`
- System prompt: `<task_backlog>` now includes parent epic context via LEFT JOIN
- UI: Board/Epics toggle in task board header
- UI: `cp-epic-tree` component — collapsible tree view with progress bars
- UI: Parent Epic field in task detail (dropdown + assign button)
- UI: Subtasks section in task detail for epics
- UI: Epic indicator `[E]` on Kanban task cards
- Auto-complete: epic status transitions to completed when all children are done
- 10 new i18n keys across 6 languages
- 15 new tests for epic hierarchy

---

## [0.64.2] — 2026-04-07

### Added

- **Zod input validation** on all mutation routes: blueprints (8 schemas), budgets (2), tasks (5), auth (1) — all POST/PUT/PATCH handlers now validate input before processing
- **Silent-catch gate** in pre-push hook: rejects any `catch {}` without logging in production code

### Changed

- **Observability**: all 211 silent catches in production code now log via the project logger (debug/warn/error by severity)
- **Lint zero-warning enforcement**: `oxlint --deny-warnings` blocks any new warning in CI
- **apiError consistency**: all API error responses use the standardized `apiError()` helper (3 remaining sites migrated)
- **Knip config cleanup**: 5 stale ignore entries removed, dead `DiscoveryStatusRow` type deleted
- **19 lint warnings fixed**: unused imports/variables in production and test code

---

## [0.64.1] — 2026-04-07

### Changed

- **Dependencies (prod)**: bump @ai-sdk/anthropic 3.0.67, @ai-sdk/google 3.0.59, @ai-sdk/openai 3.0.51, ai 6.0.149, @modelcontextprotocol/sdk 1.29.0, @openrouter/ai-sdk-provider 2.5.0, hono 4.12.12, marked 18.0.0
- **Dependencies (dev)**: bump @vitest/coverage-v8 4.1.3, cspell 10.0.0, knip 6.3.0, lefthook 2.1.5, oxlint 1.59.0, @hono/node-server 1.19.13

---

## [0.64.0] — 2026-04-08

### Added

- **Task Board (Kanban)** — Full task management with drag & drop between 5 status columns (pending, in_progress, blocked, completed, cancelled). New route `#/instances/:slug/tasks`.
- **Agent tool `task_board`** — Agents can list, create, checkout, complete, block, cancel tasks and add comments. Available to pilot, executor, and manager profiles.
- **Agent-to-agent task assignment** — `assigneeId` parameter on tool `create` action lets agents create tasks for other agents.
- **Task assignment notifications** — Assigning a task (via UI or agent tool) injects a `[task_assigned]` message into the agent's permanent session and triggers an immediate prompt loop via `wakeupAgent` helper.
- **System prompt enrichment** — `<task_backlog>` block injected into agent system prompts showing pending/in_progress tasks, priority-ordered.
- **Explicit Assign button** — Task detail panel shows agent dropdown + "Assign" button (no auto-save), allowing users to fill in task details before triggering assignment.
- **Task delete** — Delete button (trash icon) for pending/cancelled tasks in task detail panel.
- **DB schema v29** — `rt_tasks` and `rt_task_comments` tables with indexes.
- **Bus events** — `TaskCreated`, `TaskStatusChanged`, `TaskAssigned` (with `assignedBy` field).
- **REST API** — 9 endpoints for task CRUD, status changes, reordering, comments, and counts.
- **Task count on instance card** — Badge showing task counts in instance card status bar + "Tasks" menu item.
- **i18n** — 37 task-related keys across 6 locales (en, fr, de, es, it, pt).
- **UX documentation** — `docs/ux-screens/screen-task-board.md` with ASCII mockups.

---

## [0.63.1] — 2026-04-08

### Changed

- **Documentation overhaul** — Sync all docs to v0.63.0 state: schema v28, 8 providers, budget enforcement (v0.62.0), dynamic model discovery (v0.63.0), 16 repositories, ~113 API endpoints. Updated README, main-doc, registry-db, CLAUDE.md, CHANGELOG.md.

---

## [0.63.0] — 2026-04-08

### Added

- **Dynamic model discovery** — Real-time model discovery from provider APIs with polling (24h default), DB persistence (`discovered_models` + `discovery_status` tables, migration v28), and stale cache fallback. 8 provider adapters: Anthropic, OpenAI, Google, OpenRouter, Ollama, Mistral, xAI, OpenCode Zen. Discovery triggered on named key CRUD.
- **3 new providers** — Mistral (`mistral`), xAI/Grok (`xai`), OpenCode Zen (`opencode`). All use OpenAI-compatible Chat Completions API.

### Fixed

- **Circular dependency** in model resolver injection — broke cycle between provider resolution and model discovery.
- **A2A messaging labels** — Fixed sender/receiver swap in `message_from` label and wrong direction in received messages.
- **Named API key resolution** for inter-agent messaging (`send_message`/`task` tools).
- **Chat Completions API** — Use correct API for OpenAI-compatible providers (Mistral, xAI, OpenCode).
- **Provider error details** — Extract and surface provider error details in chat error responses.
- **Agent namedKeyId** — Persist agent's named key ID on save in agent detail panel.

---

## [0.62.3] — 2026-04-05

### Fixed

- **Security: Vite update** — 8.0.3 → 8.0.5 (GHSA-v2wj, GHSA-p9ff).
- **API rate limits** — Raised instance rate limit from 10 to 30 req/min for multi-instance dashboards.
- **CSS layout overflow** — Defensive CSS for dashboard layout overflow.

---

## [0.62.2] — 2026-04-05

### Added

- **Phase 5 test coverage** — 10 test files, +230 tests: agent defaults, model catalog, provider resolution, usage tracker, message builder, workspace cache, and 4 repository modules (agent, agent-blueprint, blueprint, runtime-session).
- **Phase 6 test coverage** — 9 test files, +104 tests: mime, log-rotate, process, request-id, search-tool, channel-factory, profile routes, agent-blueprint routes, key-migration.
- **Coverage totals** — 1901 backend tests, 57.78% lines (up from 53.05%). CI thresholds raised: lines 57%, stmts 56%, funcs 60%, branches 50%.

### Fixed

- **Security: defu prototype pollution** (GHSA-737v-mqg7-c878) — Override `defu@<=6.1.4` to `>=6.1.5` via pnpm overrides. Fixes CI security audit failure.

---

## [0.62.1] — 2026-04-04

### Fixed

- **Budget UI icons** — Replaced emoji icons (🛑, ⚠️, 🔄) with design-consistent Unicode symbols (●, ⚠, ↻) matching the existing app vocabulary. Event icons are now color-coded (red for hard_stop, amber for soft_alert).

---

## [0.62.0] — 2026-04-04

### Added

- **Budget enforcement with auto-pause (BUDGET-001)** — Per-instance and per-agent budget limits with automatic enforcement. Pre/post-LLM budget checks in prompt loop, heartbeat tick blocking when budget exceeded. Monthly reset + periodic reconciliation. REST API (8 endpoints) for budget CRUD, override, and audit events. Telegram notifications on soft alert and hard stop. New DB migration v27 (rt_budgets + rt_budget_events). 55 new tests.
- **Budget management UI** — New "Budgets" tab in Cost Dashboard (cp-budget-settings): budget CRUD with progress bars, create/edit dialog with agent selector, event history log. Budget alert banners (cp-budget-alert-banner) on all instance pages with override confirmation dialog. Budget exceeded indicator on instance cards and agent mini-cards. Full i18n support (6 languages, 54 keys each).
- **CI on develop branch** — GitHub Actions CI now triggers on push to develop and PRs targeting develop (previously only main).

### Changed

- **Instance API rate limit** — Raised from 10 to 30 req/min to accommodate budget status polling across multiple instance pages.
- **Audit bypass cleanup** — Remove dead code, tighten type safety (PR #42).

---

## [0.61.12] — 2026-04-03

### Changed

- **Documentation overhaul** — Sync README, main-doc, and registry-db with current codebase state (v0.61.11). Updated version references (0.49.1/0.42.0 → 0.61.12), schema v16 → v26, 15 repositories (was 9), ~105 API endpoints (was 69). Added documentation for named API keys, user profiles, agent archetypes, 7 new DB tables, 10 new migrations, new CLI commands (auth, service), new dashboard screens, and updated tech stack versions.

---

## [0.61.11] — 2026-04-03

### Added

- **Test coverage Phase 4** — Integration test for compaction-to-memory pipeline (7 tests: real filesystem + FTS5 index + decay scoring). UI service unit tests for auth-state (6 tests) and hash router (46 tests). New `vitest.ui.config.ts` for UI test suite. Total: 1567 backend + 52 UI tests.

---

## [0.61.10] — 2026-04-03

### Changed

- **Test coverage Phase 3** — Added 44 unit tests: CLI withContext pattern, DB schema migrations v24-v26, lib utilities (shellEscape, error classes, platform detection). Overall coverage: 53% lines. Total: 1564 tests.
- **CI coverage thresholds raised** — lines 50→51, statements 49→50, branches 43→44.

---

## [0.61.8] — 2026-04-03

### Changed

- **Test coverage Phase 2** — Added 90 unit tests for moderate-coverage modules: tool-set-builder, tool registry, channel router, Telegram formatter, plugin system, server/local. Overall coverage: 51% → 53% lines. Total: 1520 tests.
- **CI coverage thresholds raised** — lines 49→50, statements 48→49, functions 51→53, branches 42→43.

---

## [0.61.7] — 2026-04-03

### Changed

- **Test coverage Phase 1** — Added 151 unit tests covering previously untested runtime modules: session compaction (9% → 96%), session cleanup (0% → 100%), middleware pipeline (5% → 100%), memory system (5% → 85%), built-in middleware (8% → 83%), built-in tools (48% → 76%). Overall coverage: 46% → 51% lines.
- **CI coverage thresholds raised** — lines 43→49, statements 38→48, functions 46→51, branches 37→42.

---

## [0.61.5] — 2026-04-03

### Changed

- **System prompt dirty-flag cache** — Prompt-loop optimization that avoids rebuilding the system prompt on every turn when no config has changed.

### Fixed

- **Self-updater tag clobber** — `git fetch --tags` now uses `--force` so moved/recreated tags don't cause "would clobber existing tag" errors that abort the update.
- **Circular dependency crypto ↔ named-key-repository** — Extracted key migration functions from `crypto.ts` into `lib/key-migration.ts` to break the cycle that failed the CI circular dependency check.

---

## [0.61.2] — 2026-04-02

### Fixed

- **Self-updater now restarts running runtimes** — After a successful update (git fetch, checkout, pnpm install, build), the self-updater restarts all runtime instances in `running` state before restarting the dashboard service. Previously only the dashboard was restarted, leaving runtimes on old code until manual intervention.

---

## [0.61.0] — 2026-04-02

### Added

- **Session Logs Viewer** — New screen (`#/instances/:slug/session-logs`) to browse all sessions (active + archived, permanent + ephemeral) with infinite scroll, agent/period/type/state filters, conversation and raw LLM view modes, collapsible system prompt, expandable tool calls.
- **System prompt persistence** — New `rt_system_prompts` table (migration v26) stores historical snapshots of built system prompts, deduplicated by content hash. The session logs viewer shows the exact prompt the LLM saw at the time of the conversation.
- **`GET /runtime/sessions` filters** — New query params: `agentId`, `since`, `until`, `persistent`, `before` (cursor), `state=all`. Returns `hasMore` for infinite scroll.

### Fixed

- **Pilot input invisible** — The chat input/send/attach bar was clipped below the viewport due to `calc(100vh)` not accounting for browser chrome. Replaced with `100dvh` + parent-side flex constraints.
- **Named key provider mismatch** — Dashboard chat handler bypassed named key resolution entirely, falling back to missing `.env` keys. Now uses `resolveModelForAgent()` with provider-aware key matching.
- **Runtime master key loading** — Runtime daemon didn't call `ensureMasterEncryptionKey()`, so named key decryption was always skipped. Added static import at runtime startup.
- **Update banner pushing footer** — Self-update banner inside `<main>` added unaccounted height. Moved outside main.
- **Emoji overflow in pilot timeline** — Agent archetype emoji icons overflowed their 20x20 grid cell.
- **Inconsistent menu icons** — Replaced emoji icons (lightning, clipboard) with typographic characters matching the design system.

---

## [0.60.0] — 2026-04-01

### Added

- **Named API Keys** — Centralized API key management at admin level. Keys are stored encrypted (AES-256-GCM) in the database, replacing plaintext `.env` storage. Admin creates named keys in Profile > API Keys, then assigns them to instances.
- **Crypto module** (`src/lib/crypto.ts`) — Consolidates all cryptographic operations: AES-256-GCM encryption, secure random generation (`generateSecureHex`), gateway/dashboard token generation (migrated from `secrets.ts`).
- **Auto-generated master encryption key** — `MASTER_ENCRYPTION_KEY` is automatically generated at dashboard startup if not present. Stored in `~/.claw-pilot/.env`.
- **Auto-migration of existing keys** — At dashboard startup, API keys from `user_providers` and instance `.env` files are automatically migrated to encrypted named keys. Deduplicates shared keys across instances.
- **Named key dropdown in instance creation** — Instance creation dialog now selects a named key instead of typing an API key directly.
- **Default API Key selector in instance settings** — General tab shows all global named keys with provider-filtered model dropdown.
- **Per-agent key override** — Agents can override the instance's default named key with a specific key from the dropdown.
- **DB migrations v24–v25** — `named_api_keys` table (encrypted storage), `instance_named_keys` (deprecated), `instances.default_named_key_id` FK, `agents.named_key_id` FK.

### Changed

- **Simplified provider architecture** — Removed `instance_named_keys` junction table in favor of direct `default_named_key_id` FK on instances. All named keys are globally available to all instances.
- **Removed Providers tab** from profile settings (replaced by API Keys tab).
- **Removed legacy provider management** from instance settings (add/remove/update provider with inline key).

### Removed

- `src/core/secrets.ts` — Consolidated into `src/lib/crypto.ts`.
- Profile provider routes (`GET/PUT/DELETE/PATCH /api/profile/providers/*`).
- Provider section in instance General settings.

---

## [0.59.8] — 2026-03-31

### Fixed

- **Fix self-updater restart on Linux system services** — The self-updater used `systemctl --user restart` which only works for user-level systemd services. On production (CHRONOS/Debian 12), the service is installed as a system service in `/etc/systemd/system/`. The updater now detects the service type and uses `sudo systemctl restart` with a detached subprocess for system services. Also imports `DASHBOARD_SERVICE_UNIT` constant instead of hardcoding the service name.

---

## [0.59.7] — 2026-03-31

### Fixed

- **Log and notify on SubagentCompleted prompt loop failure** — When an async subagent completed but the parent's prompt loop failed (context overflow, rate limit, etc.), the error was silently swallowed by `.catch(() => {})`. The parent agent would hang indefinitely without knowing its subagent had responded. The handler now logs the error with structured context (`subagent_result_injection_failed`) and injects a `[subagent error]` message into the parent session so the agent can react.

---

## [0.59.6] — 2026-03-31

### Changed

- **Soft-deprecate runtime.json file I/O** — All functions that read or write `runtime.json` directly are now marked `@deprecated` with JSDoc. Fallback paths that still read the file emit `logger.warn()` to surface legacy usage. `exportRuntimeJsonSnapshot()` (debug snapshot) is unaffected. Documentation updated to clarify the database is the source of truth since v0.59.3.

### Fixed

- **Clean up orphan sessions on agent deletion** — Deleting an agent left its permanent sessions in `rt_sessions` (no FK cascade), causing the deleted agent to persist as a ghost tab in the pilot screen. `deleteAgent()` now purges all sessions before removing the agent row.

---

## [0.59.4] — 2026-03-31

### Fixed

- **Raise maxSteps ceiling from 100 to 500** — Complex delegations (codebase exploration, multi-step migrations) could exceed the previous 100-step limit, causing task failures. Aligned all validation schemas (runtime config, team schema, dashboard patch) and UI input constraint.

---

## [0.59.3] — 2026-03-31

### Changed

- **`agents.config_json` is now the single source of truth** for agent runtime configs. `getRuntimeConfig()` reconstructs `config.agents[]` from the agents table instead of the monolithic JSON blob, eliminating config drift between agent CRUD and config PATCH paths.
- **AgentProvisioner and BlueprintDeployer** no longer manipulate `runtime.json` directly — they write to the DB and export a debug snapshot.
- **`runtime status` command** now reads config from DB first (was filesystem-only).

---

## [0.59.2] — 2026-03-31

### Fixed

- **Prevent agent self-messaging** — Agents could send messages to themselves via exact ID match in `send_message`, causing conversations to stall (reply never reaches the caller). Added early self-check guard with clear error message. Same guard applied to `task` A2A resolution.

---

## [0.59.1] — 2026-03-30

### Fixed

- **Self-updater finds pnpm on Linux** — Added `~/.local/bin` (corepack) and `~/.local/share/pnpm` (pnpm setup) to the PATH used by the self-updater and the systemd service. Fixes `pnpm: not found` on Debian when pnpm is installed via corepack.

---

## [0.59.0] — 2026-03-30

### Changed

- **Port allocation replaced by deterministic derivation** — Instance ports are now derived from the slug via a djb2 hash (19100–19199 range), matching the actual web-chat WebSocket port. Eliminates the vestigial gateway port system (18789–18838) that was never listened on. Ports displayed in the dashboard and CLI now reflect the real listening port.
- **Port-allocator removed** — `PortAllocator` class and sidecar port reservation (P+1, P+2, P+4) deleted. Port selection prompt removed from the instance creation wizard.
- **DB migration v23** — Backfills existing instances with their correct derived port and clears the sidecar port reservations from the `ports` table.

---

## [0.58.5] — 2026-03-30

### Fixed

- **Eliminated polkit/pkttyagent noise on minimal Linux** — `systemctl` commands for system services now use `sudo` directly instead of trying without sudo first. Avoids `Failed to execute /usr/bin/pkttyagent` errors on Debian minimal installs where PolicyKit agent is not available.

---

## [0.58.4] — 2026-03-30

### Fixed

- **Security: systemd `User=` now resolves correctly under sudo** — When `install.sh` runs `sudo claw-pilot service install`, the service file now uses `SUDO_USER` / `SUDO_UID` environment variables to resolve the real user instead of `root`. Previously, `os.userInfo()` returned `root` because the Node process ran as root via sudo.
- **Wrapper installs to `/usr/local/bin/` with passwordless sudo** — When running via `curl | sh` without a TTY but with `sudo -n` (NOPASSWD), the wrapper script now correctly installs to `/usr/local/bin/` instead of falling back to `~/bin/`.
- **Suppressed verbose "detached HEAD" git message** during fresh installation from a release tag.
- **Removed duplicate service success messages** — `install.sh` no longer prints its own success message when `dashboard-service.ts` already does.

---

## [0.58.3] — 2026-03-30

### Fixed

- **Security: systemd service runs as correct user** : System service template now includes `User=` and `Group=` directives, preventing the dashboard from running as root on Linux.
- **install.sh update path** : Re-running `install.sh` on an existing installation now correctly detects system-level systemd services (was stuck on `systemctl --user`, never restarting the service).
- **install.sh undefined variables** : Crontab fallback message no longer references undefined `$TARGET_USER` / `$TARGET_USER_HOME`.
- **sudo fallback for systemctl** : All `systemctl` commands (install, uninstall, restart, daemon-reload) now try without sudo first, then fallback to sudo — works whether run as root or regular user.
- **journalctl log hint** : Removed obsolete `--user` flag from journalctl instructions (system service, not user service).

### Changed

- **`WantedBy=multi-user.target`** : Standard target for headless Linux servers (was `default.target`).
- **Dead code removal** : Removed unused `ensureLinger()` and `systemctlUser()` functions from `dashboard-service.ts`.

### Added

- **Orphan systemd service scanner** (uninstall.sh) : Detects service files pointing to non-existent installation directories and removes them automatically.
- **Multi-user warning** (uninstall.sh) : Warns when services for other users are detected, with manual cleanup instructions.
- **Crontab fallback** (install.sh) : When systemd is unavailable (Docker, WSL), suggests crontab as auto-start alternative instead of silently skipping.
- **Improved uninstall summary** : End-of-uninstall message now lists remaining manual follow-up actions.

---

## [0.58.2] — 2026-03-30

### Fixed

- **uninstall.sh** : Now detects systemd level (`/run/systemd/system`) and properly removes services from both user (`~/.config/systemd/user/`) and system (`/etc/systemd/system/`) locations. Handles both old user-service installations and new system-service installations.

---

## [0.58.1] — 2026-03-30

### Changed

- **systemd system service** : Dashboard service on Linux now uses system-level systemd (`/etc/systemd/system/`) instead of user-level (`systemctl --user`). Removes dependency on linger and `XDG_RUNTIME_DIR`.
- **install.sh** : Improved systemd detection (`/run/systemd/system` check), cron suggestion as fallback.

### Dependencies

- Bump prod dependencies: ai v6.3.13, @ai-sdk/anthropic v5.1.3, @ai-sdk/google v2.1.8, @ai-sdk/openai v2.1.8, hono v4.7.10, marked v16.1.0, zod v3.25.32.

---

## [0.58.0] — 2026-03-30

### Added

- **`send_file` tool** : New built-in tool enabling agents to deliver workspace files (DOCX, PDF, images, etc.) to users as downloadable documents. Works across web UI (download card) and Telegram (sendDocument attachment).
- **Workspace file download endpoint** : `GET /api/instances/:slug/workspace/download?path=...` with path traversal protection, symlink escape prevention, and 50MB size limit.
- **File card UI component** : `cp-pilot-part-file` renders send_file results as a styled card with file type icon, size, and download button.
- **DB migration v22** : Backfills existing `agents.skills` whitelist data into `runtime_config_json` for seamless upgrade.

### Fixed

- **Skill whitelist enforcement** : Agent skill checkboxes in the dashboard were cosmetic — the `agents.skills` column was written by the UI but never read by the runtime. Skills are now filtered by `listAvailableSkills()` and guarded in `SkillTool.execute()`. `buildAgentConfig()` forwards all config fields (skills, skillUrls, autoSelectSkills, toolProfile, timeoutMs, thinking, promptMode, archetype) from the canonical `runtime_config_json`.
- **Stale tool profiles in context panel** : The session context route had a hardcoded copy of tool profiles missing send_file, create_artifact, send_message, etc. Replaced with a dynamic import of the canonical `TOOL_PROFILES`.
- **File card metadata fallback** : `cp-pilot-part-file` now reads metadata from `call.content` when `result` is unavailable (matching the storage layout used by the runtime).

---

## [0.57.0] — 2026-03-29

### Added

- **Unified activity timeline** : Pilot screen transformed from chat-style bubbles to a chronological timeline with distinct visual styling per event type (user chat, A2A messages, tool calls, reasoning, subtasks). Each entry has a timestamp, typed icon, and source label.
- **Timeline filter bar** : Toggleable chips (Chat, A2A, Tools, Think, Sub, Suggest) to show/hide entry types. Preferences persisted in localStorage.
- **Markdown rendering** : Agent text and A2A message content rendered as rich Markdown (headings, lists, code blocks, tables, bold, links) via marked + DOMPurify.
- **Reset instance script** : `scripts/reset-instance.sh` for session/memory purge.

### Fixed

- **Agent tabs in Pilot** : Permanent sessions created via the internal A2A channel now appear as browsable tabs (was filtered out by `channel != 'internal'`).
- **Target-side A2A detection** : Messages using the `[message_from:agentId]` pattern (recipient's session) are now correctly categorized as A2A instead of showing as "You".

---

## [0.56.2] — 2026-03-29

### Fixed

- **AgentSync link preservation** : `AgentSync.sync()` was destructively replacing all agent_links, deleting a2a links set via the builder UI and ignoring `agentToAgent.allowList` (v2 format). Now preserves existing a2a links and reads spawn targets from both `agentToAgent.allowList` and legacy `subagents.allowAgents`.
- **Agent mini-card** : Removed redundant spawn badges (`→ @archetype`) from cards — already visible as arrows on canvas. Increased card height from 80px to 86px for better content spacing.

---

## [0.56.0] — 2026-03-29

### Added

- **Progressive disclosure for skills** : New per-agent `autoSelectSkills` toggle. When enabled, the runtime pre-selects only the most relevant skills (TF-IDF ranking) based on the user's message instead of injecting all skills into the system prompt. Configurable `autoSelectSkillsTopN` (default: 5). Agents can still load any skill via the `skill` tool.
- **Skills tab UI** : Auto-select toggle at the top of the Skills tab. When active, manual checkboxes are greyed out. Persists via runtime config PATCH.
- **Skill ranker module** : `src/runtime/session/skill-ranker.ts` — lightweight TF-IDF scorer, zero external dependencies, sub-millisecond on 150+ skills.

---

## [0.55.0] — 2026-03-29

### Changed

- **Team YAML export/import v2** : Export now reads from `config_json` (DB source of truth since v20) instead of cherry-picking fields from `runtime.json`. Import writes `config_json` to DB and spreads all config fields generically into `runtime.json`. 14 previously lost config fields now survive round-trip: `persistence`, `thinking`, `agentToAgent`, `temperature`, `maxSteps`, `promptMode`, `instructionUrls`, `timeoutMs`, `chunkTimeoutMs`, `inheritWorkspace`, `bootstrapFiles`, `skillUrls`, `allowSubAgents`.
- **YAML format version** : Bumped to `"2"` (v1 still accepted on import for backward compatibility).
- **BOOTSTRAP.md** : Added to exportable workspace files.
- **BlueprintAgentRecord** : Added `config_json` field to TypeScript type (column already existed in DB).

### Added

- **E2E round-trip test** : New `team-export-import.e2e.test.ts` validates export → import → export → compare.

---

## [0.54.0] — 2026-03-29

### Added

- **Settings > Skills panel** : New sidebar section listing all available skills grouped by source (workspace, global, remote). Upload skills via ZIP archive or install directly from a GitHub URL (Contents API). Delete workspace skills with one click.
- **Agent detail > Skills tab** : Dedicated tab (after Tools) with checkbox per skill, all checked by default. CSS-responsive descriptions adapt to panel width via `text-overflow: ellipsis`, full text on hover. Own Save/Cancel bar with dedicated save mechanism.
- **Skills API** : `GET /api/instances/:slug/skills` lists available skills via `listAvailableSkills()`. `POST .../skills/upload` accepts ZIP archives. `POST .../skills/install` fetches from GitHub tree URLs. `DELETE .../skills/:name` removes workspace skills.
- **Skills route tests** : 14 vitest tests covering listing, GitHub install (success, validation, API failure), and deletion.

### Fixed

- **Skills save** : Skills were incorrectly saved via `patchInstanceConfig` (runtime.json config patch, which doesn't support a `skills` field). Now correctly saved via `updateAgentMeta` (DB `agents.skills` column).

### Changed

- **i18n** : Skills-related strings added to all 6 languages (en, fr, de, es, it, pt).

---

## [0.53.1] — 2026-03-28

### Fixed

- **CI: Security audit** — Override transitive dependencies (picomatch >=2.3.2/>=4.0.4, path-to-regexp >=8.4.0) to eliminate 3 high CVEs.
- **CI: Dead code check** — Remove unused `config-builder.ts` and guardrail registration API. Suppress knip false positives on re-exported and Lit web component symbols.

---

## [0.53.0] — 2026-03-28

### Added

- **Builder UX harness design** : Agent cards now display archetype color stripes (6 archetypes: planner, generator, evaluator, orchestrator, analyst, communicator), persistence-based backgrounds (permanent=opaque, ephemeral=dark, default=accent), and inline @archetype spawn capsules (row 4).
- **Differentiated link styles** : Spawn/delegation links rendered as dotted lines with filled triangle arrows. A2A/messaging links rendered as dashed lines without markers (bidirectional merged). Ray-rectangle intersection clipping ensures lines end precisely at card edges.
- **Canvas legend** (`cp-canvas-legend`) : Collapsible legend in bottom-left corner showing link type explanations. State persisted in localStorage.
- **Multi-select & group drag** : Rubber-band rectangle selection on empty canvas. Group drag moves all selected cards together. Click toggles selection. Detail panel shown only when exactly 1 card selected.
- **Persistence guard** : `task.ts` rejects spawning agents with `persistence: "permanent"`. @archetype resolution filters out permanent candidates. 5 tests.
- **Builder API enrichment** : `GET /builder` endpoint now returns `persistence` and `archetype` per agent from `runtime_config_json`.
- **6 archetype CSS tokens** : `--archetype-planner` through `--archetype-communicator` in design system.

### Changed

- Agent cards have fixed dimensions (186×80px standard, 200×80px default, 186×104px with spawns) for predictable SVG clipping.
- DEFAULT badge removed from pilot card — replaced by accent background. Archetype badge always visible.

### Documentation

- Updated: `comp-agent-card-mini.md`, `comp-agent-links-svg.md`, `screen-agent-builder.md`, `ux-design.md`.
- New: `comp-canvas-legend.md`.

---

## [0.52.0] — 2026-03-26

### Added

- **Artifacts tool** (`create_artifact`) : LLM can produce structured content (code, markdown, JSON, CSV, SVG, HTML) rendered as rich cards in the UI with copy button, collapsible content, and type icons. Configurable via `artifacts.enabled` in runtime config.
- **Follow-up suggestions** : Post-middleware generates 2-3 contextual follow-up actions after each response using a lightweight LLM call (configurable model via `artifacts.suggestionsModel`). Rendered as clickable chips in the web UI. Configurable via `artifacts.suggestionsEnabled` and `artifacts.maxSuggestions`.
- **Telegram artifact delivery** : Artifacts sent as downloadable Telegram documents with MIME-mapped file extensions (`.py`, `.ts`, `.json`, `.md`, etc.). New `sendDocument()` multipart/form-data upload in Telegram poller.
- **Telegram suggestion buttons** : Follow-up suggestions sent as inline keyboard buttons. Clicking a suggestion sends it as a new message to the agent.
- **Built-in middleware registration** : All 4 built-in middlewares (guardrail, multimodal, tool-error-recovery, suggestions) now properly registered at engine startup and in the dashboard chat route.
- **UX documentation** : 4 new component docs (artifact card, suggestion chips, image viewer, question card). Updated Runtime Pilot screen doc (18 → 22 components, input features, part types table).

### Fixed

- **Dashboard middleware bypass** : `POST /runtime/chat` was calling `runPromptLoop()` directly, bypassing the middleware pipeline. Now wrapped in `runMiddlewarePipeline()`.
- **Middleware registry isolation** : Dashboard and runtime daemon run as separate processes. Middleware registry was empty in the dashboard process. Now registers middlewares in both processes.

---

## [0.51.0] — 2026-03-25

### Changed

- **Tool profiles redesign** : Replace old profiles (minimal/messaging/coding/full) with role-based profiles matching team delegation strategy: `sentinel` (monitoring), `pilot` (orchestrator), `executor` (coding agent), `manager` (coding + delegation). New `custom` profile with arbitrary tool selection via `customTools` array.
- **`send_message` available for all profiles except sentinel** : Every agent can now communicate with peers. `task` (spawn delegation) remains limited to pilot and manager profiles.
- **Profile-driven tool injection** : `tool-set-builder.ts` now reads from `TOOL_PROFILES` instead of hardcoded `profile === "full"` check. Subagents blocked from both `task` and `send_message`.

### Added

- **Tools tab in agent detail panel** : New tab with radio-button profile selector and checkbox grid for all 14 tools. Changing a checkbox auto-switches to "custom" profile. Save/Cancel with `patchInstanceConfig`.
- **`GET /runtime/tools` API endpoint** : Returns `ALL_TOOL_IDS` and `TOOL_PROFILES` for UI tool discovery.
- **`customTools` field in agent config** : Persisted in `runtime.json`, passed through config API GET/PATCH.
- **i18n for profile descriptions** : Localized labels in 6 languages (en, fr, de, es, it, pt).

---

## [0.50.2] — 2026-03-25

### Added

- **Multimodal vision support** : Agents can now receive and process images in conversations. Telegram photos are downloaded and sent to vision-capable models (Claude, GPT-4o). New `InboundAttachment` type, `"image"` part type, multimodal pre-middleware, and `cp-pilot-part-image` UI component with click-to-zoom.
- **Multimodal config** : New `multimodal` section in runtime config (enabled by default, 20 MB max, JPEG/PNG/WebP/GIF).
- **Telegram photo/document handling** : `TelegramPoller.getFile()` and `downloadFileAsBase64()` methods. Channel now processes photo and image document messages.
- **File upload in Pilot** : Paperclip attach button with thumbnail preview, drag & drop support, base64 encoding and transmission to backend via POST /runtime/chat.
- **Send/Stop toggle** : Pilot input button intelligently switches between Send (idle) and Stop (streaming). Stop aborts the active prompt loop via new `POST /runtime/sessions/:sessionId/abort` route with AbortController registry.

---

## [0.49.1] — 2026-03-24

### Fixed

- **Fire-and-forget `send_message` now triggers async prompt loop** : Previously, `send_message(expect_reply=false)` only wrote the message to the target session DB without triggering LLM processing — messages were permanently stuck. Now launches an async `runPromptLoop()` on the target agent (non-blocking for the caller).

### Changed

- **Dependency bumps** : TypeScript 5.9 → 6.0, Vitest 4.1.0 → 4.1.1, oxlint 1.56 → 1.57, knip 6.0.2 → 6.0.5, nanoid, ws, hono, AI SDK updates.

---

## [0.49.0] — 2026-03-24

### Added

- **Middleware chain foundation** : New extensible pre/post middleware pipeline in `ChannelRouter.route()`. Types (`Middleware`, `MiddlewareContext`), pipeline runner, and registry. Supports abort, shared metadata, and ordered execution.
- **Guardrail middleware** : Pluggable `GuardrailProvider` interface for dynamic pre-message authorization (content moderation, cost gates). Publishes `GuardrailBlocked` bus event.
- **Tool error recovery middleware** : Post-middleware that classifies tool errors (rate-limit, timeout, parsing) and stores recovery hints in metadata.
- **New bus events** : `GuardrailBlocked`, `ToolErrorRecovered`.

### Fixed

- **Session lifecycle hooks** : `SessionCreated` now emitted from `createSession()` and on permanent session reactivation. `SessionEnded` emitted from `archiveSession()`. Plugin hooks `session.start` / `session.end` now actually fire.
- **Plugin hook uniformity** : `message.sending` wired via bus (consistent with `message.received`). `tool.definition` hooks now applied to ALL tools (task, send_message, memory_search), not just built-in tools.
- **Silent error swallowing** : `tool.afterCall` error path now logs warning instead of `.catch(() => {})`.

### Removed

- **Dead `routes` plugin hook** : Removed from `PluginHooks` type (never invoked). Will be reintroduced properly if needed.

---

## [0.48.2] — 2026-03-24

### Added

- **Enhanced New Agent dialog** : Added agent type (primary/subagent), tool profile (coding/full/messaging/minimal), and provider filtering by user profile. New "Configuration" section in the dialog. 12 new i18n keys across 6 languages.

---

## [0.48.1] — 2026-03-23

### Fixed

- **Fully remove TOOLS.md from codebase** : Removed `TOOLS.md` from `agent-provisioner.ts` (subagent workspace files), `runtime.ts` (workspace discovery), deleted `templates/workspace/TOOLS.md` template, and fixed E2E tests to use correct agent ID.

---

## [0.47.3] — 2026-03-23

### Changed

- **Remove TOOLS.md from workspace file lists** : `TOOLS.md` removed from `DISCOVERABLE_FILES`, `EDITABLE_FILES`, `TEMPLATE_FILES`, `EXPORTABLE_FILES`, and `WORKSPACE_FILES` in constants. Tool descriptions are fully auto-generated by Vercel AI SDK — the static file was dead weight.
- **Update agent template dialog** : seed files hint no longer lists TOOLS.md (all 6 locales updated).
- **Update comments** : `promptMode` docs in `config/index.ts` and `system-prompt.ts` now reflect the actual discovery file lists.

---

## [0.47.2] — 2026-03-23

### Changed

- **System prompt cleanup — remove duplicated static content** : `AGENTS.md` template stripped of `## Agent` (duplicated by `<agent_identity>` block), `## Team roster` (duplicated by `<teammates>` block), and obsolete `agentToAgent` protocol. Only A2A guidance (`task` / `send_message`) and memory section remain.
- **Remove TOOLS.md from discovery** : `TOOLS.md` was 100% redundant with auto-generated tool descriptions from Vercel AI SDK. Removed from `DISCOVERY_FILES_FULL`, `DISCOVERY_FILES_MINIMAL`, and `DISCOVERY_FILES_SUBAGENT`. Existing workspace files are simply ignored.
- **Enriched A2A delegation context** : the `extraSystemPrompt` injected into target agents during A2A peer delegation now includes the source channel and an explicit "this is not a user message" framing.

---

## [0.47.1] — 2026-03-23

### Fixed

- **A2A provider key resolution** : `resolveAgentModel()` in the task tool now receives an explicit `env` map (merged from global `~/.claw-pilot/.env` + instance `.env`), so delegating to agents using a different provider (e.g. OpenAI) no longer fails with a missing API key error. Previously, `resolveModel()` fell back to `process.env` which was incomplete in the dashboard chat path.
- **Dashboard chat — missing profile merge** : the `/runtime/chat` endpoint now uses `loadMergedConfig()` with `CommunityProfileResolver`, so user-level provider configs from the DB (`user_providers`) are included in the runtime config — matching the daemon behavior.
- **Dashboard chat — incomplete env loading** : replaced `readEnvFileSync(stateDir)` with `buildResolvedEnv(stateDir)` which merges both global and instance `.env` files.
- **Heartbeat model resolution** : the heartbeat runner's `resolveModel` lambda now passes an explicit `env` map from `buildResolvedEnv()` instead of relying on `process.env`.

### Added

- `buildResolvedEnv(stateDir)` helper in `env-reader.ts` — single function to merge global + instance `.env` files (instance wins).

---

## [0.41.42] — 2026-03-19

### Fixed

- **Anthropic Opus/Sonnet 4.6 missing in runtime** : `claude-opus-4-6` (and `claude-sonnet-4-6`) were absent from the runtime model catalog. `findModel()` returned `null`, so `prompt-loop` fell back to a 100k context window while the UI used 200k. Result: auto-compaction never triggered for Pilot sessions. Added both models with 200k context windows and aligned the runtime fallback to 200k when a model is unknown.

---

## [0.41.41] — 2026-03-19

### Fixed

- **Agent Info tab — double-prefix bug on model save** : when saving the Provider/Model in the agent Info tab, the model was incorrectly stored as `"anthropic/anthropic/claude-sonnet-4-6"` instead of `"anthropic/claude-sonnet-4-6"`. Root cause: `_initInfoFields()` was splitting `rawModel` on `/` to initialize `_editModel` to the short form (`"claude-sonnet-4-6"`), but catalog option values use the full `"provider/model"` format — so on re-save the provider was prepended a second time. Fix: `_editModel` now stores the full `"provider/model"` string (matching catalog option values); `_saveInfo()` uses `_editModel` directly instead of re-concatenating `_editProvider + "/" + _editModel`.

---

## [0.41.40] — 2026-03-19

### Changed

- **`cp-instance-card` — header redesign** : removed `⚡ runtime` badge (no longer relevant without OpenClaw). Status badge now shows transitional states during start/stop actions:
  - Start: `STOPPED` → `STARTING` (amber badge + spinner) → `RUNNING`
  - Stop: `RUNNING` → `STOPPING` (amber badge + spinner) → `STOPPED`
  - Restart: shows `STARTING` spinner while the API call is in flight
- Locales updated for all 6 languages (`state-starting` / `state-stopping`)

---

## [0.41.39] — 2026-03-19

### Fixed

- **Info Tab — unable to change Provider/Model** : root cause identified via server logs — an agent's `runtime.json` with `heartbeat.activeHours` but no `tz` field failed Zod validation (`tz` was `z.string().min(1)` required). Any attempt to `PATCH /config` (changing Provider, Model, or any other Info tab field) triggered `loadRuntimeConfig()` → throw → `CONFIG_PATCH_FAILED` → "An unexpected error occurred".
  - **Fix Zod** : `tz` made optional (`z.string().min(1).optional()`) in `HeartbeatConfigSchema` — backward compatible with existing `runtime.json` files without timezone
  - **Fix `isWithinActiveHours()`** : signature expanded to `tz?: string`, fallback to system timezone if absent
  - **Fix UX** : "An unexpected error" message resolved — `CONFIG_PATCH_FAILED` is now included in codes that transmit raw server message (`error-messages.ts`)
  - **Fix model logic** : changing Provider without reselecting a Model no longer silently triggers `model: null` — UI validation blocks Save with explicit message; `model` field only included in patch if both `provider + model` are selected
  - **Eager provider loading** : `_initInfoFields()` now triggers `_loadProviders()` immediately on tab display (instance only), instead of waiting for first select focus

---

## [0.41.38] — 2026-03-19

### Fixed

- **Heartbeat — silent save errors** : the `catch` in `_saveHeartbeat()` was silently swallowing all network/validation errors without any feedback. Added `_hbError` state: error is now displayed above the save bar, and reset on each save attempt or tab reload.

### Changed

- **Heartbeat — Active hours selector redesigned** :
  - The two `<input type="time">` fields now have individual labels **From** / **To** (no more unlabeled fields)
  - **Timezone** field is now visible as soon as one time is entered (instead of waiting for both to be filled) — avoids the situation where the field is unfindable
  - Active hours section moved out of the 2-column grid to have its own linear section with hint `(optional — leave empty for 24/7)`

---

## [0.41.37] — 2026-03-19

### Changed

- **UX Agent card — Info tab in direct edit mode** : removed the view/edit toggle mode from the Info tab. The tab is now always in editable mode (like Config and Heartbeat), with a conditional save bar that only appears when a field is modified. Name, Provider/Model (instance only), Role, Tags, Notes, Skills fields are directly editable; Workspace and Last sync remain read-only.
- **Removal of 2 buttons in Agent card header** : the "Edit agent" (pencil) and "Save" (save-as-template) buttons are removed. The header now contains only Delete, Expand and Close.
- **Lazy loading of providers** : the Provider select loads the API list on first focus, without blocking component mount.

### Technical

- `agent-detail-panel.ts` : −475 lines / +336 → net balance −139 lines. Removal of `_fieldEditMode`, `_fieldSaving`, `_fieldError`, `_availableSkills`, `_skillsAvailable`, `_loadingSkills` (6 `@state`). Replacement of `_enterFieldEditMode`, `_cancelFieldEdit`, `_saveFields`, `_renderFieldEditForm` (4 methods ~450 lines) with `_loadProviders` + `_saveInfo` + `_initInfoFields` (3 methods ~80 lines). Removal of imports `fetchInstanceSkills`, `SkillInfo`, `SkillsListResponse`, `ProvidersResponse`.
- Locales (×6) : removal of obsolete keys (`adp-skills-loading`, `adp-skills-unavailable`, `adp-btn-save-template`), addition of Info tab keys (`adp-label-name`, `adp-label-provider`, `adp-label-role`, `adp-label-tags`, `adp-tags-hint`, `adp-model-placeholder`, `adp-provider-placeholder`, `adp-skills-hint`, `adp-info-save`, `adp-info-cancel`).

---

## [0.41.36] — 2026-03-19

### Fixed

- **UI — "Save" button in Agent card** : the save button (disk icon) in the header of `cp-agent-detail-panel` (instance context) triggered navigation to `/agent-templates` after each click, because it called `saveAgentAsBlueprint` followed by `navigate: {view: "agent-templates"}`. Removed post-save navigation — the template is created silently, the user stays in the builder.
- **Button rename** : the label "Save as template" is replaced with "Save" in all 6 languages, because the card is used in multiple contexts and the previous name was misleading.

---

## [0.41.35] — 2026-03-19

### Fixed

- **UI — Agent card : spurious redirects after file save** : fixed an anti-pattern introduced in `cp-agent-file-editor` refactor. The `loadFile`/`saveFile` functions were recreated on each `render()` (inline factory calls), causing spurious `updated()` cycles in the child component and, under certain scheduling conditions, triggered a `navigate` event to `/agent-templates` after each save. Fix : memoization of callbacks as stable class fields, rebuilt only when `agent`, `context` or `templateId` change (`agent-detail-panel.ts`, `agent-template-detail.ts`).
- **UI — loss of in-progress edits in `cp-agent-file-editor`** : the `filenames` array was recalculated inline in `render()` of `agent-template-detail`, triggering complete reset of cache and edit state on each parent re-render. Fix : `_filenames` is now a stable class field, fed once after fetch in `_load()`.
- **UI — `context` inline object in parents of `cp-agent-detail-panel`** : in `agents-builder.ts`, `instance-settings.ts` and `blueprint-builder.ts`, the `PanelContext` was created inline (`${{ kind: "instance", slug: this.slug }}`), causing unnecessary rebuilds of file-editor closures on each parent render. Fix : `_panelContext` is now a class field, rebuilt only in `updated()` when `slug` or `blueprintId` change.

### Changed

- **Removal of `IDENTITY.md` file** in agent workspaces : permanently replaced by `BOOTSTRAP.md` (onboarding file). Updated in: `constants.ts`, `system-prompt.ts`, `runtime.ts` (route), templates workspace, template creation dialog, locales (6 languages), tests.

---

## [0.41.34] — 2026-03-19

### Added

- **System prompt real-time viewer** in CONTEXT tab of /pilot panel :
  - The built system prompt (actual prompt sent to LLM) is displayed below the token consumption bar in CONTEXT tab.
  - **Collapsible sections** : the prompt is parsed into XML blocks (`<agent_identity>`, `<instructions>`, `<teammates>`, `<env>`, `<behavior>`, `<session_context>`, `<available_skills>`) — each section is an independent accordion with icon, label, character count and Copy button.
  - **Real-time update** via bus event `session.system_prompt` emitted in `prompt-loop.ts` after each prompt rebuild. Frontend listens to SSE event and patches `_context.systemPrompt` without full reload.
  - **In-memory cache** (`system-prompt-cache.ts`) : the last prompt built per session is memoized and served by the `GET .../sessions/:id/context` endpoint (`systemPrompt` field + `systemPromptBuiltAt`).
  - Informative empty state ("Available after first message") until no LLM call has occurred for the session.
  - i18n : 6 keys added in 6 languages (en/fr/de/es/it/pt).

---

## [0.41.33] — 2026-03-19

### Added

- **Level 3+ — Skills visible in `<teammates>` block** : agent system prompts now inject declared skills (`expertIn`) of each agent into the `<teammates>` block. LLM sees directly who can do what when reasoning, without waiting to call the `task` tool.
  - Format : `- dev-agent (Dev) [skills: code-review, test-writing]`
  - Routing hint added when at least one agent declares skills : `"To route by skill, use the skill name as subagent_type in the task tool (e.g. task({ subagent_type: "code-review", ... }))."`
  - `runtimeAgentConfigs` now passed to `buildSystemPrompt()` from `prompt-loop.ts`
  - 6 new unit tests covering cases : skills displayed, hint present/absent, [you] marker, runtimeAgentConfigs absent (backward compat)

---

## [0.41.32] — 2026-03-19

### Added

- **Level 3 — A2A routing by skills** (`expertIn`) :
  - New field `expertIn: string[]` in `AgentConfigSchema` (runtime.json) and `Agent.Info` (runtime registry). Allows each primary agent to declare its domains of expertise (ex: `["code-review", "test-writing"]`).
  - **Resolution by skill in the `task` tool** : if `subagent_type` doesn't match either by agent ID or built-in name, engine searches the first primary agent that declares this skill in `expertIn`. Example : `task({ subagent_type: "code-review", prompt: "..." })` → resolves to the agent with `expertIn: ["code-review"]`.
  - Declared skills are displayed in the `task` tool description (next to agent name) to guide LLM.
  - Error message on unknown agent now lists available skills for routing.
  - **UI — Config tab** : new "Skill routing" field with tag input to edit `expertIn`. Free entry by input or comma, with tag removal. Saved via PATCH config.
  - **API** : `expertIn` exposed in `GET /api/instances/:slug/config` (field `expertIn: string[]` per agent) and patchable via `PATCH /api/instances/:slug/config`.
  - **i18n** : 5 new keys (`cfg-skill-routing`, `cfg-expert-in-label`, `cfg-skill-remove-aria`, `cfg-expert-in-placeholder`, `cfg-expert-in-add`) in 6 languages (en, fr, de, es, it, pt).

---

## [0.41.31] — 2026-03-19

### Changed

- **UI — agent file editing** : extraction of workspace file editing code into a reusable component `cp-agent-file-editor`. This component is now used in all 3 editing surfaces: instance agents, blueprint agents, and agent templates (`/agent-templates`). The templates page gains Markdown preview (Edit/Preview), dirty tracking, file cache and discard dialog confirmation before leaving without saving, previously available only in the agent panel.

---

## [0.41.30] — 2026-03-19

### Changed

- **Agent templates — creation** : workspace files (SOUL.md, HEARTBEAT.md, AGENTS.md, TOOLS.md, USER.md, IDENTITY.md) are now pre-filled with application default templates on agent template creation, instead of being empty. Placeholders (`{{agentName}}`, `{{agentId}}`, etc.) are substituted with template name and ID.

---

## [0.41.29] — 2026-03-19

### Added

- **Agent templates — create dialog** (Level 2 V2) : "New Agent Template" dialog to create a template from scratch (name, description, category, default workspace files). "+ New template" button in gallery now functional.
- **Agent templates — "Use template" flow** (Level 2 V2) : "Use" button on gallery cards and "Use template" in detail view. Opens agent creation dialog with target instance selector, pre-filled with template name. Calls `POST /agents/from-template` with workspace file copy.
- **Agent templates — YAML import/export** (Level 2 V2) :
  - Export : `GET /api/agent-blueprints/:id/export` returns YAML file with metadata + workspace files. "Export" button in detail view.
  - Import : `POST /api/agent-blueprints/import` accepts YAML and creates template. "Import YAML" button with file picker in gallery.
- **API** : `createAgentBlueprint()` now accepts `category` field. New functions `exportAgentBlueprint()` and `importAgentBlueprint()`.
- **i18n** : translations of creation dialog, "Use template" flow, and import/export in 6 languages (en, fr, de, es, it, pt).

### Fixed

- Cleanup of unused imports in `agent-templates-view.ts` and `agent-template-detail.ts` (0 oxlint warnings UI).

---

## [0.41.28] — 2026-03-18

### Added

- **Agent blueprints — dashboard UI** (Level 2, Phase 2) : complete interface for managing agent templates.
  - **"Templates" page** : gallery of agent blueprints with cards (name, description, category, file count, date). Actions: clone, deletion, open detail.
  - **Detail view** : template metadata + workspace file editor (tabs per file, textarea with save).
  - **Navigation** : "Templates" tab in nav bar (hash routes `#/agent-templates` and `#/agent-templates/:id`).
  - **"Save as template"** : button in agent detail panel (instance context) to create template from existing agent.
  - **Types + API** : `AgentBlueprintInfo`, `AgentBlueprintFileContent` + 10 API functions (`fetchAgentBlueprints`, `createAgentBlueprint`, `cloneAgentBlueprint`, `saveAgentAsBlueprint`, `createAgentFromTemplate`, etc.).
  - **i18n** : translations of nav tab and "Save as template" button in 6 languages.

---

## [0.41.27] — 2026-03-18

### Added

- **Agent blueprints — backend** (Level 2, Phase 1) : complete infrastructure for reusable agent templates.
  - **DB migration v16** : `agent_blueprints` table (id TEXT PK, name, description, category, config_json, icon, tags) + `agent_blueprint_files` (workspace files per blueprint).
  - **Repository** : `AgentBlueprintRepository` — CRUD blueprints + files + clone (deep copy).
  - **API** (11 routes) : `GET/POST /api/agent-blueprints`, `GET/PUT/DELETE .../\:id`, `POST .../\:id/clone`, `GET/PUT/DELETE .../\:id/files/\:filename`, `POST .../from-agent` (Save as template).
  - **Create from template** : `POST /api/instances/\:slug/agents/from-template` — creates agent in instance by copying blueprint workspace files.

---

## [0.41.26] — 2026-03-18

### Added

- **`category` field in `Agent.Info`** (Level 1.1) : formalizes implicit classification of built-in agents. Three values: `"user"` (Pilot, custom agents), `"tool"` (explore, general, build, plan), `"system"` (compaction, title, summary). Field is exposed in builder API (`AgentPayloadItem.category`) and displayed in dashboard (badges "Tool", "System", "Agent" on mini cards + category badge in detail panel). Translations added in 6 languages.
- **`Agent.Summary` extended** : now includes `category` in Summary type and `toSummary()` function.
- **Tests** : 5 new tests validating categories of built-in agents, custom agents, and `toSummary()`.

---

## [0.41.25] — 2026-03-18

### Added

- **Heartbeat UI — `tz` and `model` fields** : Heartbeat tab now exposes timezone selector (required if `activeHours` defined) and dedicated model for ticks. Existing plumbing (state, load, save) was already present — only HTML inputs were missing.

### Fixed

- **`bootstrapFiles` wired end-to-end** : the "Additional workspace files (globs)" feature in agent card Config tab was dead code — GET didn't return the field, PATCH didn't accept it, UI save didn't send it. Renamed `workspaceGlobs` → `bootstrapFiles` in UI to align with backend schema, and complete wiring (GET response, PATCH schema + apply, UI save).

---

## [0.41.24] — 2026-03-18

### Fixed

- **Agent card — Config and Heartbeat tabs non-editable** : `_initConfigTab()` and `_initHeartbeatTab()` now call `fetchInstanceConfig()` to load real values from `runtime.json` instead of reading absent `.config`/`.heartbeat` fields from `AgentBuilderInfo`. A spinner displays during load. Config and Heartbeat tabs are hidden in Blueprint context (this data is instance-specific).

---

## [0.41.23] — 2026-03-18

### Changed

- **Rename default agent `main` → `pilot`** : agentId and display name of default agent change from `"main"` / `"Main"` to `"pilot"` / `"Pilot"`. Impacts: `createDefaultRuntimeConfig`, synthetic agent in `discovery.ts` and `agent-sync.ts`, workspace path `workspaces/pilot`, fallback API instance creation, seed blueprint, CLI wizard, UI dialog. Existing instances not affected (recreate to benefit from new name).

---

## [0.41.22] — 2026-03-18

### Fixed

- **Dead code removed** : `getWorkspaceCacheSize()` was exported from `workspace-cache.ts` but never used. Removed to fix knip check in CI.

---

## [0.41.21] — 2026-03-18

### Fixed

- **File tools used `process.cwd()` instead of instance workDir** : glob, grep, read, edit, write, multiedit, bash and skill used `process.cwd()` as root directory. When claw-runtime daemon is launched from dashboard, `process.cwd()` equals `/` (filesystem root), causing infinite scans. Fix : added `workDir` field in `Tool.Context`, injected from `prompt-loop.ts`. All file tools now use `ctx.workDir ?? process.cwd()`.

---

## [0.41.20] — 2026-03-18

### Fixed

- **Duplicate `tool_call` parts and `chunk_timeout` spam** : `tool-set-builder` now reuses the part created by `onChunk` (Path-A) via `getOrCreateToolCallPart()`, eliminating duplicates without `toolCallId` causing `MissingToolResultsError`. The `chunk_timeout` watchdog is now cancelled on first timeout to avoid repeated events every 5s. Added handling of `tool-error` chunks via `onStepFinish` with emission of synthetic `tool-result` to keep LLM context valid between turns of permanent session. Propagated fields `toolProfile`, `permissions`, `heartbeat`, `humanDelay`, `identity`, `sandbox`, `groupChat` in team export/import/schema.

---

## [0.41.19] — 2026-03-18

### Fixed

- **Current version always stale in banner (root cause)** : the 5-minute cache on `SelfUpdateChecker` also stored `currentVersion` (local version). After manual deployment, cache returned old local version for 5 minutes. Fix : only GitHub result (`latestVersion` + `latestTag`) is cached. `currentVersion` is re-read from `package.json` on disk at each check — negligible cost (~1 ms).

---

## [0.41.18] — 2026-03-18

### Fixed

- **Current version always wrong in update banner** : `_getCurrentVersion()` used `require("../package.json")` whose result is cached by Node for the process lifetime. After auto-update (without restart), process kept reading old version from `require` cache. Fix : direct read with `readFileSync` + `JSON.parse` — no Node cache, and `invalidateCache()` also resets `_currentVersion` to re-read file on next check.
- **`system.ts` read `package.json` with wrong path** : `../../../package.json` (3 levels) instead of `../package.json` (1 level from `dist/`). Version returned by `GET /api/health` was "unknown" on deployed server.

---

## [0.41.17] — 2026-03-18

### Fixed

- **Auto-update doesn't restart service on macOS** : the command `launchctl stop … && sleep 2 && launchctl start …` executed in same shell — `stop` killed the process before `start` could run. Fix : `launchctl start` now launched in detached sub-shell (`nohup sh -c 'sleep 3 && launchctl start …' &`) that survives parent kill, then `launchctl stop` is called last.
- **GitHub cache for version check** : `GET /api/self/update-status` called GitHub API on every UI request (every 60s). Result now cached 5 minutes server-side. Cache is invalidated when update is triggered.

---

## [0.41.16] — 2026-03-18

### Fixed

- **Telegram token not saved** : after save in `cp-instance-channels`, parent (`cp-instance-settings`) kept old `_config` and passed it to child on next re-render (triggered by WS health_update), overwriting freshly saved token. Fix : child emits `channels-config-saved` event with fresh config; parent updates `_config` accordingly.
- **Infinite UX loop (save → restart → save)** : two combined causes.
  1. Backend returned `requiresRestart: true` even after automatically restarting instance. Fix : `requiresRestart` is now `false` if automatic restart succeeded.
  2. `_syncFromConfig()` didn't reset `_requiresRestart`, so "Restart runtime" banner persisted after config reload. Fix : `_requiresRestart = false` at start of `_syncFromConfig()`.

---

## [0.41.15] — 2026-03-18

### Added

- **A2A primary-to-primary** : the `task` tool can now delegate to a *primary* agent (ex: `dev`) in addition to built-in subagents. Target agent uses its permanent session — its context and memory are preserved between delegations. LLM sees peer agents listed in tool description with their `id` as `subagent_type`.

### Changed

- `buildToolSet` / `createTaskTool` : addition of `runtimeAgentConfigs` (primary agents of runtime) and `modelAliases` (peer model resolution). Full `runtimeConfig` now propagated from `runPromptLoop` to task tool.
- `task` tool description : primary peer agents appear in dedicated section "User-defined primary agents".

---

## [0.41.14] — 2026-03-18

### Fixed

- **A2A : main agent couldn't communicate with other agents** : the default `toolProfile` of main agent was `"coding"`, which doesn't include `task` tool (the actual A2A communication mechanism). Fix: `toolProfile` changed to `"full"` by default for main agent in `createDefaultRuntimeConfig`.
- **Misleading system prompt** : the `<teammates>` block said to use `"the agentToAgent tool"` while tool is named `task`. LLM looked for non-existent tool. Fix: message now says `"the task tool"`.

---

## [0.41.13] — 2026-03-18

### Fixed

- **Persistent update banner** : after update on macOS, service didn't restart because `systemctl` unavailable — job stayed in `done` state indefinitely. Fix : use `launchctl stop/start` on macOS, `systemctl` on Linux.
- **Dismiss of banner ignored** : closing "Updated successfully" banner via × button didn't survive page reloads (state purely in-memory). Fix : dismiss now persisted in `sessionStorage` with job key, maintaining it between reloads of same session.

---

## [0.41.12] — 2026-03-18

### Fixed

- **Pilot view too tall** : pilot container used hardcoded `height: calc(100vh - 56px - 48px)` in template, adding to `min-height` of `<main>` and causing vertical overflow. Fix : `<main>` gets `pilot` class in pilot view (`height` exact, `min-height: unset`), and internal container uses `height: 100%`.

---

## [0.41.11] — 2026-03-18

### Fixed

- **Persistent horizontal scroll** : `header`, `footer`, `main` and `cp-login-view` lacked `width: 100%; box-sizing: border-box` — they overflowed outside host despite `overflow-x: hidden` on `:host`. Fixed on all shadow DOM root elements of `cp-app` and on `cp-login-view`.

---

## [0.41.10] — 2026-03-18

### Fixed

- **UI horizontal/vertical scroll** : the `<main>` displayed 2305 × 1109 px due to missing `width: 100%` and `overflow-x: hidden` on host `<cp-app>`. Added `width: 100%; max-width: 100vw; overflow-x: hidden` on `:host` of `app.ts` and `overflow-x: hidden` on `<body>` in `index.html`.

---

## [0.41.9] — 2026-03-18

### Changed

- **UI full-width** : reduction of side margins to better use available space.
  - **Header / Footer** : side padding reduced from 24 px to 16 px (12 px on mobile).
  - **Cluster view / Blueprints view** : padding reduced from 24 px to 16 px (12 px on mobile).
  - **Settings** : removal of `max-width: 1100px` — Settings view now uses 100% width. Padding reduced from 24 px to 16 px (12 px on mobile).

---

## [0.41.8] — 2026-03-18

### Changed

- **UI responsive** : application now adapts to narrow windows (breakpoint 640 px).
  - **Header** : `flex-wrap` on small screens, auto height, WS indicator hidden under 640 px.
  - **Footer** : fixed height removed (`min-height` instead) — content can wrap to 2 lines without being cut.
  - **Cluster / Blueprints** : `.section-header` (title + "+ New Instance" / "+ New Blueprint" button) switches to column under 640 px — button no longer off-screen.
  - **Settings** : sidebar (180 px fixed) transforms to horizontal tab bar under 640 px. `.field-grid` switches from 2 columns to 1 column. Agent drawer uses `min(420px, 100vw)`.
  - **Pilot header** : token/cost stats can shrink (`flex-shrink: 1`) without overflow.
  - **Agents Builder / Blueprint Builder** : tool header switches to `flex-wrap` and "+ Add Agent" button spans full width under 640 px.
  - **Pilot breadcrumb** : slug truncated with `text-overflow: ellipsis` if too long.

---

## [0.41.7] — 2026-03-18

### Fixed

- **Workspace path convention** : standardized to `workspaces/<agentId>/` everywhere in application. Before, provisioner/sync/discovery used `workspaces/workspace/` (default agent) and `workspaces/workspace-<id>/` (secondary agents), while runtime (`resolveAgentWorkspacePath`, `discoverWorkspaceInstructions`, `resolveWorkspaceDir`, `compaction`, `memory/index`) used incompatible paths (`workspace-<agentId>/` flat in stateDir or `workspaces/<agentId>/`). Result: files `SOUL.md`, `USER.md`, `HEARTBEAT.md`, `memory/*.md` were never loaded in system prompt — agents worked without any workspace context.
- **`resolveAgentWorkspacePath`** : simplified signature (removed `agentsList` parameter). Always returns `workspaces/<agentId>` (or explicit path if provided in config).

---

## [0.41.6] — 2026-03-18

### Changed

- **Instance card** : added **"Pilot"** button in instance card popover menu (visible only if instance `running`), between Start/Stop and Agents. Opens standalone full-screen view `/instances/:slug/pilot`.
- **Pilot view** : new dedicated route `#/instances/:slug/pilot` with navigation header (← Back / slug / Pilot) and full-screen `cp-runtime-pilot`. No Settings sidebar bar around.
- **Settings — sidebar** : removed "Pilot" entry from sidebar. Pilot is no longer a Settings section.
- **⚠ PERM badge** : now navigates directly to Pilot view (instead of Settings runtime section).

---

## [0.41.5] — 2026-03-18

### Changed

- **Settings — General** : added "Default provider" selector (visible when multiple providers configured on instance). Changing provider automatically updates default model to first model of that provider.
- **Settings — General** : "Default model" selector now filtered by selected provider (instead of showing all models from all configured providers in one group). Models from unconfigured providers not offered.
- **Settings — Config / Models** : "Internal model" field is now a `<select>` grouped by provider (identical to model selector in General) when providers configured. Includes "— same as default model —" option to use main model.

---

## [0.41.4] — 2026-03-18

### Fixed

- **Channels — Telegram** : component displayed "Telegram not configured" even with configured bot. Cause: `connectedCallback()` called `_syncFromConfig()` before Lit passed props — `this.config` was `null` at that moment. Fixed by removing call in `connectedCallback()` (initialization now only via `updated()`, after first render with props).

---

## [0.41.3] — 2026-03-18

### Fixed

- **Settings — General** : removed "Tools profile" field (not persisted on runtime). `defaultModel` is now also synced to SQLite DB in addition to `runtime.json`.
- **Settings — Agents (defaults)** : compaction mode now saved to `runtime.json`. Removed dummy fields (`workspace`, `maxConcurrent`, `archiveAfterMinutes`, global heartbeat) that had no effect.
- **Settings — Agents (edit panel)** : Config tabs (toolProfile, maxSteps, temperature, thinking, timeoutMs…) and Heartbeat now correctly save to `runtime.json` via `PATCH /config` instead of `PATCH /agents/:id/meta` which rejected them in 400.
- **Settings — Config** : Config tab (internal models, aliases, compaction threshold, subagents) now correctly loads and saves from/to `runtime.json` via correct fields (`agentDefaults.*`).
- **API `PATCH /config`** : Zod schema extended to accept `agentDefaults` (compaction, subagents, models, defaultInternalModel) and `agents[]` (all config fields per agent).

---

## [0.41.2] — 2026-03-17

### Fixed

- **SYSTEM tab — "No workspace files detected"** : `/context` endpoint looked for workspace files directly at stateDir root (`~/.claw-pilot/instances/<slug>/SOUL.md`) instead of actual workspace folder (`workspaces/<agentId>/` or `workspaces/workspace/`). Fixed by resolving workspace folder with same layout as runtime. Added `MEMORY.md` to list of candidates.

---

## [0.41.1] — 2026-03-17

### Fixed

- **Teammates panel** : technical subagents (`explore`, `general`) no longer appear in Pilot Teammates list. Only agents with `kind: "primary"` displayed.
- **Auto-exclusion Teammates** : current agent no longer appeared in its own Teammates list — comparison `a.name !== agentId` was case-sensitive (`"Main" !== "main"`). Fixed with `.toLowerCase()`.

---

## [0.40.1] — 2026-03-17

### Security

- **Workspace isolation** : the "Working directory" displayed to agent in system prompt now points to its workspace (`~/.claw-pilot/instances/{slug}/workspaces/{workspace}`) rather than instance root, avoiding exposure of `.env`, `runtime.json` and `runtime.pid` to agent.

### Changed

- Added `agentWorkDir` in `SystemPromptContext`, `PromptLoopInput` and `RouterInput` — the `workDir` (stateDir) continues to be used internally for workspace file resolution, skills and memory.

---

## [0.39.0] — 2026-03-17

### Changed

- **Reclassification of built-in agents** : all 7 built-in agents (`build`, `plan`, `explore`, `general`, `compaction`, `title`, `summary`) are now technical subagents (`kind: "subagent"`, `hidden: true` for `build`, `plan`, `compaction`, `title`, `summary`). `explore` and `general` remain visible for task tool.
- **"Main" agent as default primary agent** : `createDefaultRuntimeConfig()` creates agent `id: "main"`, `name: "Main"` with full permissions (`DEFAULT_RULESET + question:allow`) and `persistence: "permanent"`. Now the actual work agent for user.
- **`defaultAgentName()` rewritten** : no more hardcoded preference for `"build"`. Function returns agent with `isDefault: true`, or first visible non-subagent (agents config). Throws error if no visible primary agent found.
- **`isDefault` propagated in `Agent.Info`** : new optional field, propagated from `RuntimeAgentConfig.isDefault` via `createFromConfig()` and `mergeAgentConfig()`.
- **`build` and `plan` now have inline prompt** : `PROMPT_BUILD` and `PROMPT_PLAN` assigned to corresponding built-in agents (necessary in subagent mode).
- **Default permissions for "Main"** : `createDefaultRuntimeConfig()` now includes full `DEFAULT_RULESET`, plus `question: allow`. No more "ask" mode for every tool.
- **Pilot header shows display name** : `cp-pilot-header` now receives `agentName` (display name) plus `agentId` and displays `"Main"` instead of `"main"` (or `"build"`).

### Fixed

- **Wrong agent name in Pilot header** : header displayed `"build"` (built-in agent id) instead of config agent's display name. Fixed by passing `context.agent.name` to header.

---

## [0.38.1] — 2026-03-17

### Fixed

- **"claw-pilot updated" banner** : no longer reappears after being closed when changing page — dismiss now persisted until real functional status change (`idle`/`running`/`done`/`error`), not on each poller re-render

### Changed

- **Instance Settings layout** : all sections (General, Agents, Channels, MCP, Permissions, Config) now use same full-screen layout as Pilot (`max-width: none`)
- **Pilot height** : corrected — `calc(100vh - 56px - 56px - 48px)` accounts for 3 chrome layers (app nav + settings header + save bar), no more involuntary scroll

---

## [0.38.0] — 2026-03-17

### Added

- **`cp-runtime-pilot` near real-time** — automatic loading of permanent session on startup (without first message), messages from other channels (Telegram, CLI) visible in real-time
- **Auto-session detection** : `_detectPermanentSession()` lists active sessions on load and selects most recent with `persistent: true` — history displays immediately
- **SSE auto-reconnection** with exponential backoff (1s → 2s → … → 30s max) — no silent stream loss
- **Light 10s polling** — safety net for messages arriving during micro-disconnection
- **`visibilitychange`** — immediate refresh + SSE reopen on returning to tab
- **`message.created` role=user** handled client-side — incoming message from Telegram/CLI immediately triggers `_reloadLastMessages()`
- **Session adoption via SSE** — if event arrives with `sessionId` before auto-detect completes, component adopts it immediately

### Changed

- **"Runtime" tab → "Pilot"** in Instance Settings sidebar
- **Header block removed** in Pilot section (Engine, Config file, description) — `cp-runtime-pilot` now occupies full available surface
- **Full-screen layout** for Pilot section: `max-width: none`, height = `100vh - header - savebar`, component stretches with `flex: 1`

---

## [0.37.0] — 2026-03-17

### Added

- **`cp-runtime-pilot`** — replaces `cp-runtime-chat` with complete agent and LLM control screen :
  - Display of full message history with their **parts** : text, tool_call (args + collapsible output + execution duration), reasoning (collapsible), subtask (subagent link + summary), compaction (visual marker)
  - **Collapsible context panel** on side (5 sections : token gauge, available tools, agent info + session tree, system prompt / workspace files, real-time event log)
  - **17 event types** bus forwarded via SSE (vs 5 before) : permissions, provider failover, doom loop, MCP tools changed, agent timeout, subagent completed, etc.
  - Cross-channel : messages from all channels in same stream
- **`GET /sessions/:id/context` endpoint** — synthetic view of LLM context (agent config, model capabilities, estimated token usage, tools, MCP servers, workspace files, session tree)
- **Cursor pagination** on `GET /sessions/:id/messages` (`?limit=50&before=<id>`) + `hasMore` — prepares for long permanent sessions
- **`durationMs`** persisted in `tool_call` parts metadata for UI display
- `fetchSessionMessages()` and `fetchSessionContext()` in `api.ts`
- Types `PilotMessage`, `PilotPart`, `SessionContext`, `PilotBusEvent` in `types.ts`

### Changed

- `cp-runtime-chat` removed — replaced by `cp-runtime-pilot`
- Runtime panel height in Instance Settings changed from 480px to 560px
- SSE stream : `sessionId` query param now optional (stream all-instance events)
- `getRuntimeChatStreamUrl()` : `sessionId` made optional

---

## [0.36.1] — 2026-03-17

### Fixed

- **PLAN-16: Unique session per permanent agent** — permanent session key now `<slug>:<agentId>` (no peerId). Permanent agent has single session shared across all channels (Telegram, web, CLI). Fixes session fragmentation introduced in v0.34.0 :
  - `buildPermanentSessionKey(slug, agentId)` — signature reduced to 2 arguments (peerId removed)
  - `getOrCreatePermanentSession()` — no longer depends on peerId for key
  - `POST /runtime/chat` route — removed peerId derivation from `X-Device-Id` / IP
  - DB migration v14 extended : archives duplicate permanents (keeps oldest), recalculates keys to `<slug>:<agentId>` format, removes `idx_rt_sessions_permanent` index
- **workDir absent from daemon** — `ClawRuntime` now receives `workDir` (= `stateDir`) as 4th constructor argument. Messages received via Telegram/WebChat now load workspace files (SOUL.md, IDENTITY.md, AGENTS.md, TOOLS.md, etc.) in system prompt. Propagated to `ChannelRouter.route()` and heartbeat runner.
- **Legacy prompts BUILD_AGENT / PLAN_AGENT** — removal of `prompt` field inline hardcoded on `BUILD_AGENT` and `PLAN_AGENT` in `defaults.ts`. These agents now use workspace files (SOUL.md, IDENTITY.md) or `DEFAULT_INSTRUCTIONS` fallback. Internal agents (compaction, title, summary, explore, general) keep inline prompt.

### Changed

- **UI runtime chat** — "New session" button and corresponding dropdown option hidden for permanent agents. "🔒 Permanent" badge displayed in chat header. `persistent: boolean` field added to `RuntimeSession` and propagated in repository.
- **Documentation updated** — CLAUDE.md, main-doc.md, registry-db.md, ux-design.md updated for PLAN-16 (permanent sessions, schema v15, Devices removal).

---

## [0.36.0] — 2026-03-17

### Changed

- **Instance state directories relocated** — moved from `~/.runtime-<slug>/` to `~/.claw-pilot/instances/<slug>/` for better organization and discoverability. All claw-pilot data now consolidated under `~/.claw-pilot/`:
  - `constants.ts`: replaced `RUNTIME_STATE_PREFIX` with `INSTANCES_DIR`
  - `platform.ts`: removed `getHomeDir()`, added `getInstancesDir()`
  - `discovery.ts`: adapted directory scanning to new structure
  - `provisioner.ts`: creates `instances/` parent directory
  - **DB migration v15**: recalculates `state_dir` and `config_path` for all instances
  - All tests updated and passing (892 tests)

---

## [0.35.0] — 2026-03-17

### Fixed

- **Critical bug "Connection to runtime lost"** — removal of `hasBus()` check in dashboard routes (`runtime.ts`, `mcp.ts`, `permissions.ts`). This check verified process dashboard's bus registry, which is always empty because buses are created in separate runtime daemon processes. Consequence: SSE route `GET /runtime/chat/stream` systematically returned 404 `RUNTIME_NOT_RUNNING`, blocking web chat on all instances. Bus is now created lazily by `getBus()` in dashboard process on first call to `runPromptLoop()`.

---

## [0.34.0] — 2026-03-16

### Added

- **Cross-channel permanent sessions (PLAN-15c/d)** — a `primary` agent now has single session per user, independent of channel (chat, Telegram, CLI) :
  - `getOrCreatePermanentSession()` — unique session scoped by `(instanceSlug, agentId, peerId)` without channel
  - `ChannelRouter` : safeguard — agents `kind: "subagent"` can no longer receive user messages
  - `createDefaultRuntimeConfig()` : `main` agent explicitly `persistence: "permanent"`
  - `POST /runtime/chat` : uses `getOrCreatePermanentSession()` for permanent agents
  - `ui/api.ts` : stable `deviceId` in `localStorage` sent via `X-Device-Id` to guarantee session continuity between reloads
- **UI services** — extraction from `app.ts` into testable modules :
  - `ui/src/services/auth-state.ts` : encapsulation of Bearer token (replaces `window.__CP_TOKEN__`)
  - `ui/src/services/ws-monitor.ts` : WS management with auth by app message (token no longer visible in query param)
  - `ui/src/services/router.ts` : hash-based routing extracted as pure functions
  - `ui/src/services/update-poller.ts` : self-update polling extracted as class
- **Runtime chat UI** — compact header (36px) with agent selector :
  - Agent combo replaces session combo — displayed only if multiple agents configured
  - Stats (msg count, cost) inline in header — stats bar removed
- **DB migration v14** — composite index `idx_rt_messages_session_role` on `(session_id, role)` to optimize `countHeartbeatAlerts()`

### Changed

- **`prompt-loop.ts` decomposed** (1100 → 495 lines) into 4 cohesive modules :
  - `message-builder.ts` : LLM message construction, fixed N+1 on parts loading (single batch SQL query)
  - `tool-set-builder.ts` : Vercel AI SDK toolset, doom-loop, plugin hooks, resolved circular dependency injection
  - `usage-tracker.ts` : normalized token counting (Anthropic vs OpenAI)
  - `workspace-cache.ts` : mtime/TTL cache for workspace files (SOUL.md etc.)
- **`runtime-session-repository.ts`** — enriched SQL query (cost, tokens, msg count) extracted from route handler to repository
- **CSP hardened** — `unsafe-inline` removed from `script-src` in `dashboard/server.ts`
- **`resolveEffectivePersistence()`** exported from `agent/index.ts`

### Removed

- **Device pairing removed** (dead feature) : `devices.ts` (CLI), `device-manager.ts` (core), `instance-devices.ts` (UI, 588 lines), `devices.e2e.test.ts`, route handler, types, i18n translations

---

## [0.33.0] — 2026-03-16

### Added

- **Structured memory (Phase 4)** — intelligent long-term memory system with 5 categories, deduplication, consolidation and decay :
  - `templates/workspace/memory/` — 5 default memory templates (`facts.md`, `decisions.md`, `user-prefs.md`, `timeline.md`, `knowledge.md`) created on `primary` agent provisioning
  - `memory/decay.ts` (new module) — `parseMemoryEntry()`, `applyDecayToFile()`, `extractReferencedContents()` : confidence score `[0.0-1.0]` decreases on each compaction, entries below `0.3` deleted
  - `appendToMemoryFileDeduped()` in `writer.ts` — semantic deduplication via FTS5 before adding (fallback to basic dedup if index absent)
  - `consolidateMemoryFileIfNeeded()` in `writer.ts` — async LLM consolidation when file exceeds 150 lines (backup before overwrite, deleted after success)
  - Score `[1.0]` prefixed on all new memory entries

### Changed

- `ExtractedKnowledge` in `compaction.ts` — extended to 5 categories : `facts`, `decisions`, `preferences`, `timeline`, `knowledge`
- `EXTRACTION_PROMPT` in `compaction.ts` — V2 prompt with 5 categories and format examples
- `compact()` — integrates decay (except `timeline.md`) and async consolidation after extraction
- `readCurrentMemory()` — reads 5 memory files for deduplication during extraction
- `rebuildMemoryIndex()` in `memory/index.ts` — cleans score `[x.x]` markers before FTS5 indexing to avoid polluting searches
- `AgentProvisioner.createAgent()` — creates 5 memory files for `primary` agents
- `templates/workspace/SOUL.md` — "Memory and Continuity" section added with memory file list and `memory_search` instruction

---

## [0.32.0] — 2026-03-16

### Added

- **Permanent session (Phase 3)** — unique cross-channel session per user, never archived, with resumption context after restart :
  - `getOrCreatePermanentSession()` in `session.ts` — finds or creates permanent session scoped by `(instanceSlug, agentId, peerId)` without channel; automatically reactivates archived session by force
  - Initial title of permanent sessions = `agentId` (updated by `title` agent after first interaction)
  - `SystemPromptContext` extended — new optional fields `db`, `sessionId`, `runtimeConfig` (backward-compat)
  - `getCompactionSummary()` + `buildSessionContextBlock()` in `system-prompt.ts` — injection of last compaction summary into system prompt under `<session_context>` for permanent agents (continuity after restart)
  - `PromptLoopInput.runtimeConfig` — new optional field to pass full config to `buildSystemPrompt()`
  - `CompactionConfigSchema.periodicMessageCount` — periodic compaction trigger every N messages for permanent agents (0 = disabled, default)
  - Periodic compaction in `prompt-loop.ts` — `compactedThisTurn` flag to avoid double compaction in same turn

### Changed

- `ChannelRouter.findOrCreateSession()` — conditional routing: permanent agents → `getOrCreatePermanentSession()`, ephemeral agents → current behavior
- `buildAgentConfig()` in `router.ts` — resolves and injects `persistence` into dynamically built `RuntimeAgentConfig`
- `runPromptLoop()` — passes `db`, `sessionId` and `runtimeConfig` to `buildSystemPrompt()`
- `buildSystemPrompt()` — injects `<session_context>` after `BEHAVIOR_BLOCK` for permanent agents with existing compaction

---

## [0.31.0] — 2026-03-16

### Added

- **Subagents as pure tools (Phase 2)** — formalization of ephemeral subagents without identity, memory, or spawn capability :
  - `promptMode: "subagent"` — new workspace discovery mode loading only `AGENTS.md` and `TOOLS.md` (estimated saving: 4,000–10,000 tokens per subagent call)
  - `DISCOVERY_FILES_SUBAGENT` in `system-prompt.ts` — reduced list for ephemeral subagents
  - `resolveDiscoveryFiles()` — automatic mode inference from `agentKind` if `promptMode` absent (`kind="subagent"` → `"subagent"`, `kind="primary"` → `"full"`)
  - `discoverWorkspaceInstructions()` — new `skipMemory` parameter — skip reading `memory/*.md` for subagents
  - `getToolsForAgent()` in `registry.ts` — wrapper of `getTools()` filtering `task` tool for agents `kind="subagent"` (hard rule: subagents can never spawn)
  - `session/cleanup.ts` (new module) — `cleanupEphemeralSessions()` : cascade deletion (parts → messages → sessions) of archived ephemeral sessions beyond retention period
  - `SubagentsConfigSchema.retentionHours` — configurable retention period (default: 72h, 0 = indefinite)
  - Cleanup triggered on runtime startup + periodic timer every 6h in `engine.ts`
  - `ListSessionsOptions.excludeChannels` in `session.ts` — channel filter for `listSessions()`
  - `agent-provisioner.ts` — agents `kind="subagent"` receive only `AGENTS.md` and `TOOLS.md` during provisioning

### Changed

- `listSessions()` — new `ListSessionsOptions` interface with `excludeChannels` (backward compatible)
- `GET /api/instances/:slug/runtime/sessions` — default filter `channel != "internal"` ; `?includeInternal=true` parameter for audit
- `runPromptLoop()` — uses `getToolsForAgent()` with `agentKind` instead of `getTools()`
- `task.ts` — removal of `canSpawnSubagents` (now managed at registry level by `getToolsForAgent`)

---

## [0.30.0] — 2026-03-16

### Added

- **Intelligent compaction (Phase 1)** — transformation of compaction into coherent memory system for permanent sessions :
  - `listMessagesFromCompaction()` in `message.ts` — loads only compaction message + later messages (selective compaction) ; backward-compat if no compaction
  - `countMessagesSinceLastCompaction()` in `message.ts` — count messages since last compaction (for periodic trigger Phase 3)
  - `memory/writer.ts` (new module) — `appendToMemoryFile()` with basic dedup, `archiveBootstrap()` for post-bootstrap archiving
  - `extractKnowledge()` in `compaction.ts` — dedicated LLM call before each compaction to extract facts/decisions/preferences to `memory/facts.md`, `memory/decisions.md`, `memory/user-prefs.md` (permanent agents only)
  - `COMPACTION_PROMPT_V2` — structured prompt with 5 sections (Active Goals, Key Constraints, Current State, Open Items, Working Context) replacing free-form prose
  - `CompactionInput.workDir` (optional) — work directory for knowledge extraction
  - `compaction` agent prompt updated for alignment with new structured format

### Changed

- `buildCoreMessages()` in `prompt-loop.ts` — `"compaction"` parts now treated as text (included in LLM context)
- `runPromptLoop()` uses `listMessagesFromCompaction()` instead of `listMessages()` — selective context loading after compaction
