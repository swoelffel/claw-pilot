# Onboarding & Start CTA for Persistent Agents — Design

**Date:** 2026-04-19
**Branch:** `feature/onboarding-start-cta`
**Status:** Spec approved, pending implementation plan

## 1. Problem

After installation and the first-run wizard (name, API key, language, timezone), the user lands on the home screen with no guidance. The `cp-system` instance and its default orchestrator agent exist, but nothing invites the user to engage — they must guess that the chat composer is where to start. Same issue on `/pilot/:agentId` for any newly created persistent agent: empty session, blank screen.

## 2. Goal

Add a central, animated "Start" CTA that appears on any **empty permanent session** of a persistent agent. Clicking it triggers a scripted first-contact prompt-loop where the agent introduces itself using a `bootstrap.md` file from its workspace (or a generic i18n fallback), then proposes 2–3 next actions. The same mechanic serves both the post-install onboarding (Pilot `cp-system`) and every persistent agent created thereafter.

## 3. Non-goals

- No new onboarding wizard steps — the existing `home-wizard.ts` is untouched.
- No tutorial overlay, no product tour, no multi-step coach marks.
- No persisted "onboarding state" flag — emptiness of `rt_messages` is the single source of truth.
- No change to non-persistent (ephemeral / subagent) sessions.

## 4. Trigger rule

**A `<cp-start-cta>` is rendered if and only if the permanent session of the currently-viewed agent contains zero messages in `rt_messages`.**

- Persistent session = `rt_sessions` row with key `<slug>:<agentId>` (no peerId, no channel).
- "Zero messages" covers both "session row absent" and "session row exists but empty".
- As soon as one message exists (user or assistant), the CTA is gone forever for that session.
- No archetype filter, no `kind` filter — persistence is the criterion.

## 5. Architecture

### 5.1 Backend

**New route:** `POST /api/instances/:slug/agents/:agentId/kickoff`

- Validates that the permanent session `<slug>:<agentId>` is empty (`rt_messages` count === 0 for that `session_id`). Returns `409 KICKOFF_ALREADY_DONE` otherwise.
- Builds a synthetic kickoff directive (not persisted as a visible user message) asking the agent to introduce itself using its BOOTSTRAP content, then calls the existing prompt-loop entry point.
- Streams via the existing WS channel so the frontend picks up parts live.

**Reuse of existing `BOOTSTRAP.md` mechanism.** `src/runtime/session/system-prompt.ts` already handles `BOOTSTRAP.md` (in the agent's workspace root — `<workDir>/workspaces/<agentId>/BOOTSTRAP.md`) as a one-shot: read on the first call, appended to the system prompt, then marked `bootstrapDone` in the workspace state so subsequent calls skip it. This **already implements** the first-run injection. No change required in `system-prompt.ts` — the kickoff route simply triggers the first prompt-loop call, which naturally consumes BOOTSTRAP.md.

**Fallback when `BOOTSTRAP.md` is missing or a stub:** `src/runtime/session/bootstrap-fallback.ts` (new) — returns a generic first-contact directive localized in the 6 supported languages, derived from `user_profiles.language`. The kickoff route embeds this directive in its synthetic user-turn text when the agent workspace has no usable BOOTSTRAP.md (detected by peeking the file before calling prompt-loop).

**No schema migration.** Existing tables suffice. Emptiness of `rt_messages` is the flag.

### 5.2 Frontend

**New component:** `ui/src/components/cp-start-cta.ts`

- Lit element, `<cp-start-cta>` custom tag.
- Props: `instanceSlug: string`, `agentId: string`, `label?: string` (i18n'd default), `subtitle?: string`.
- Emits `cp-kickoff-start` on click, then calls the kickoff endpoint; switches to a spinner state until the first streamed part arrives; then dispatches `cp-kickoff-done` so the parent can unmount it and show the chat as usual.
- Respects `prefers-reduced-motion: reduce` (static glow instead of pulse).

**Integration points:**
- `ui/src/components/home-screen.ts`: render `<cp-start-cta>` centered when the default persistent agent of `cp-system` has an empty permanent session. Hide it as soon as the WS stream delivers the first message part.
- `ui/src/components/home-chat.ts`: replace the composer with `<cp-start-cta>` when the current agent's permanent session is empty. Composer returns after first message.
- Shared helper `ui/src/services/session-state.ts` (new): `isPermanentSessionEmpty(slug, agentId): Promise<boolean>` — queries an existing lightweight endpoint (e.g. `/api/instances/:slug/agents/:agentId/messages?limit=1`) or subscribes to the monitor WS payload. Chosen to avoid one-off logic in each component.

### 5.3 Data flow

1. UI queries session emptiness on mount.
2. If empty → renders CTA; otherwise normal chat.
3. User clicks Start → UI disables the button, shows spinner, POSTs `/kickoff`.
4. Backend validates emptiness, builds a synthetic kickoff directive, calls prompt-loop. The existing BOOTSTRAP.md one-shot mechanism injects the bootstrap content into the system prompt automatically on this first call.
5. Prompt-loop produces an assistant-only turn; parts stream to the WS monitor.
6. UI receives the first `rt.part.append` for this session → unmounts CTA, mounts normal chat view with the streaming message already in place.
7. Any subsequent reload never re-shows the CTA (messages exist now).

## 6. `BOOTSTRAP.md` convention (existing, extended)

- **Path:** `<workDir>/workspaces/<agentId>/BOOTSTRAP.md` (this is the existing location used by the discovery mechanism in `system-prompt.ts`).
- **Status:** optional. Absence or a stub (`# AgentName` with one line) → generic i18n fallback used in the kickoff directive.
- **Lifecycle:** consumed one-shot on the first prompt-loop call (tracked via `bootstrapDone` in the workspace state file). Subsequent turns no longer include it in the system prompt.
- **Recommended structure** (documented in `docs/ux-components/start-cta.md` and in `templates/workspace/BOOTSTRAP.md`):
  ```markdown
  # Bootstrap — First contact

  You are meeting the user for the first time.
  1. Introduce yourself (name, role, mission).
  2. State concretely what you can do (max three bullets).
  3. Propose two or three actionable starting points tailored to your role.
  4. End with an open question.
  ```
- **Provided for `cp-system`:** ship a meaningful `BOOTSTRAP.md` in `templates/system/workspace/system-pilot/BOOTSTRAP.md` (the template copied into the workspace when `ensureSystemInstance()` runs). It references the wizard data (user first name, language) via runtime placeholders already handled by the workspace file loader.

## 7. UX

### 7.1 Layout

- CTA centered in the available chat area (home chat panel or `/pilot/:agentId` chat panel).
- Disc or pill shape, ~160×160px, play icon + "Start" label, subtitle below the button (i18n, e.g. *"Say hello to your Pilot"*).
- Composer hidden while CTA is shown; reappears after first message.

### 7.2 Animation

- `@keyframes pulse` — outer glow (`box-shadow` halo) expanding every 2s, plus subtle scale 1 → 1.03.
- Hover: halo intensifies, cursor `pointer`.
- Reduced motion: halo and scale removed, replaced by a static glow.

### 7.3 Loading state

- On click: CTA morphs into a circular spinner at the same dimensions.
- As soon as the first streamed part arrives, the spinner fades out and the chat transcript fades in with the assistant message already streaming.

### 7.4 No skip

- The CTA is not dismissible on purpose: the session is empty, there is nothing else useful to do on that panel. Navigation elsewhere is always possible. If the user returns later, the CTA is still there — which is the correct behavior.

## 8. i18n

- Two new keys in each `ui/src/locales/<lang>.ts`:
  - `startCta.label` — button text.
  - `startCta.subtitle` — one-line invitation.
- Fallback `bootstrap` template lives in a new module `src/runtime/session/bootstrap-fallback.ts`, keyed by language code, returning plain markdown.

## 9. Error handling

- Network error on `/kickoff` → CTA reverts to idle with an inline error message and a retry button.
- `409 KICKOFF_ALREADY_DONE` → UI reloads the session view (means another client already consumed the kickoff).
- Prompt-loop failure mid-stream → the assistant message is persisted as-is (even partial). CTA does not reappear, since `rt_messages` is no longer empty. User can continue normally.
- Missing `bootstrap.md` → silent fallback to generic template (not an error).

## 10. Testing

### 10.1 Backend

- Route contract: valid call on empty session → 202 and stream starts; call on non-empty session → 409.
- `bootstrap.md` loader: file present → content appears in system prompt under `## First contact instructions`; file absent → generic template in the user's language; unsupported language → English fallback.
- `isFirstRun` flag never leaks to subsequent turns.

### 10.2 Frontend

- `<cp-start-cta>` renders when session is empty, unmounts on first message part.
- Disabled button during kickoff; error state on network failure; retry recovers.
- Accessibility: focusable, `aria-label` matches `startCta.label`, `prefers-reduced-motion` disables animation.

### 10.3 E2E

- Fresh install scenario: run wizard → land on home → Start CTA visible → click → assistant message streams in → CTA gone. Reload → CTA still gone.
- Multi-agent scenario: create a second persistent agent via `/pilot` → visit it → CTA visible for it but not for the first agent.

## 11. Scope of changes

| Area | File(s) | Change type |
|---|---|---|
| Backend route | `src/dashboard/routes/instances/agents/kickoff.ts` (new) | add |
| Route registration | parent registrar that mounts agent routes | edit |
| Fallback directive | `src/runtime/session/bootstrap-fallback.ts` (new) | add |
| Docs | `docs/ux-components/start-cta.md` (new) | add |
| UI component | `ui/src/components/cp-start-cta.ts` (new) | add |
| UI integration | `ui/src/components/home-screen.ts`, `ui/src/components/home-chat.ts` | edit |
| i18n | `ui/src/locales/*.ts` (6 files) | edit |
| System BOOTSTRAP | `templates/system/workspace/system-pilot/BOOTSTRAP.md` (new) | add |
| Tests | backend `__tests__` + UI `__tests__` + one e2e | add |

No change to `src/runtime/session/system-prompt.ts` — its existing BOOTSTRAP.md one-shot logic is exactly what we need.

## 12. Open points deferred to implementation plan

- Exact shape of the kickoff input passed to the prompt-loop (reuse `PromptLoopInput` with an optional `firstRun` field vs. a thin wrapper).
- Mechanism for the UI to learn that a session is empty without N requests (WS payload vs. dedicated endpoint).
- Bootstrap variable substitution: reuse the existing workspace file templating path or add a minimal `{{user.name}}` replacer in the loader.
- Final dimensions, colors, and pulse timing (design token alignment).
