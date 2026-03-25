# Changelog

All notable changes to claw-pilot are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

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

- **Info Tab — unable to change Provider/Model** : root cause identified via MACMINI-INT logs — an agent's `runtime.json` with `heartbeat.activeHours` but no `tz` field failed Zod validation (`tz` was `z.string().min(1)` required). Any attempt to `PATCH /config` (changing Provider, Model, or any other Info tab field) triggered `loadRuntimeConfig()` → throw → `CONFIG_PATCH_FAILED` → "An unexpected error occurred".
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

- **Persistent update banner** : after update on macOS (MACMINI-INT), service didn't restart because `systemctl` unavailable — job stayed in `done` state indefinitely. Fix : use `launchctl stop/start` on macOS, `systemctl` on Linux.
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
