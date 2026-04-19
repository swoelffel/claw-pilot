# Start CTA (`<cp-start-cta>`)

Centered animated button rendered when the currently-viewed agent's permanent
session is empty. Clicking it triggers the first prompt-loop turn so the agent
introduces itself (using its `BOOTSTRAP.md` if present, or a localized default
greeting otherwise).

## When it appears

- The agent has a **permanent session** (primary agents with persistence).
- The permanent session has **zero messages** in `rt_messages`.

As soon as any message exists for that session, the CTA is no longer rendered
and never reappears.

## Click flow

1. UI POSTs `/api/instances/:slug/agents/:agentId/kickoff`.
2. Backend validates emptiness (409 otherwise).
3. Backend picks a localized greeting (`src/runtime/session/bootstrap-fallback.ts`).
4. Backend forwards to the runtime chat endpoint via `callRuntimeApi`.
5. Runtime starts a normal prompt-loop turn. The existing `BOOTSTRAP.md`
   discovery logic in `src/runtime/session/system-prompt.ts` injects the
   agent's first-contact instructions on this first call (one-shot, tracked via
   `bootstrapDone` in the workspace state).
6. Frontend receives streaming parts via the existing WS/SSE channel.
7. CTA unmounts, composer takes its place.

## `BOOTSTRAP.md` convention

Each agent may ship a `BOOTSTRAP.md` in its workspace root
(`<workDir>/workspaces/<agentId>/BOOTSTRAP.md`). Recommended contents:

- Brief self-introduction (name, role, mission).
- 2–3 concrete capabilities stated as actions.
- 2–3 suggested starting points.
- One open question.

Absence or a stub file → the localized greeting alone drives the first turn.

The system pilot ships one by default at
`templates/system/workspace/system-pilot/BOOTSTRAP.md`.

## Accessibility

- `aria-label` matches the `startCta.label` i18n key.
- `prefers-reduced-motion: reduce` disables the halo pulse; a static glow
  remains for visual affordance.

## Events

| Event | Detail | Fires |
|---|---|---|
| `cp-kickoff-start` | none | On click, before the POST. |
| `cp-kickoff-done` | `{ sessionId, greeting }` | On successful 202 response. |

Both events bubble and compose — parent components can listen at the host level.
