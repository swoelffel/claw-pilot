# Onboarding Start CTA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a centered, animated "Start" CTA on any empty permanent agent session. Clicking it triggers the first prompt-loop turn; the existing `BOOTSTRAP.md` one-shot mechanism supplies the first-contact instructions.

**Architecture:** The CTA is a reusable Lit component mounted by `home-chat.ts` (and transitively by `home-screen.ts`) whenever the current agent's permanent session has zero messages. Clicking it calls a new dashboard route `POST /api/instances/:slug/agents/:agentId/kickoff` which validates emptiness, picks a localized greeting, and proxies to the existing runtime chat endpoint. The runtime then runs a normal prompt-loop turn — which, being the first turn, automatically consumes `BOOTSTRAP.md` via the existing discovery logic in `system-prompt.ts`. No change to the runtime or system-prompt loader.

**Design note — visible greeting:** The spec originally described a "synthetic invisible user message". We use a **visible localized greeting** instead (e.g. *"Bonjour 👋 Présente-toi, s'il te plaît."*) because (a) it requires no runtime plumbing, (b) it reads as a natural opening of a conversation, (c) it's trivial to translate. Flagged to the reviewer — easy to change later to an invisible form if preferred.

**Tech Stack:** Node.js 22 + Hono (backend), Lit + @lit/localize (frontend), Vitest (tests), better-sqlite3 (registry DB).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/runtime/session/bootstrap-fallback.ts` (new) | Pure module returning a localized kickoff greeting per supported language. No side effects. |
| `src/dashboard/routes/instances/agents/kickoff.ts` (new) | Hono route handler: validates emptiness, selects greeting, forwards to runtime chat endpoint. |
| `src/dashboard/routes/instances/agents.ts` (edit) | Register the new kickoff route. |
| `src/dashboard/routes/instances/agents/__tests__/kickoff.test.ts` (new) | Route contract tests. |
| `src/runtime/session/__tests__/bootstrap-fallback.test.ts` (new) | Unit tests for the fallback module. |
| `templates/system/workspace/system-pilot/BOOTSTRAP.md` (new) | First-contact instructions shipped with `cp-system`. |
| `ui/src/api.ts` (edit) | Add `postAgentKickoff()` client. |
| `ui/src/components/cp-start-cta.ts` (new) | Lit component rendering the animated Start button. |
| `ui/src/components/home-chat.ts` (edit) | Mount `<cp-start-cta>` when session is empty; unmount on first message. |
| `ui/src/locales/{en,fr,de,es,it,pt}.ts` (edit) | Two new i18n strings: `startCta.label` and `startCta.subtitle`. |
| `ui/src/components/__tests__/cp-start-cta.test.ts` (new) | Component tests (render, click, unmount). |
| `src/e2e/onboarding-kickoff.e2e.test.ts` (new) | End-to-end: empty session → kickoff → message appears. |
| `docs/ux-components/start-cta.md` (new) | Component doc (triggers, UX rules, BOOTSTRAP.md convention). |

---

## Task 1: Localized kickoff greeting module

**Files:**
- Create: `src/runtime/session/bootstrap-fallback.ts`
- Test: `src/runtime/session/__tests__/bootstrap-fallback.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/runtime/session/__tests__/bootstrap-fallback.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { getKickoffGreeting, SUPPORTED_GREETING_LANGS } from "../bootstrap-fallback.js";

describe("bootstrap-fallback", () => {
  it("returns the French greeting for 'fr'", () => {
    const g = getKickoffGreeting("fr");
    expect(g).toMatch(/Présente-toi/i);
  });

  it("returns the English greeting for 'en'", () => {
    const g = getKickoffGreeting("en");
    expect(g).toMatch(/introduce yourself/i);
  });

  it("falls back to English for an unsupported language", () => {
    const g = getKickoffGreeting("zz");
    expect(g).toMatch(/introduce yourself/i);
  });

  it("falls back to English when language is undefined", () => {
    const g = getKickoffGreeting(undefined);
    expect(g).toMatch(/introduce yourself/i);
  });

  it("exports the six supported languages", () => {
    expect(SUPPORTED_GREETING_LANGS).toEqual(["en", "fr", "de", "es", "it", "pt"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/runtime/session/__tests__/bootstrap-fallback.test.ts`
Expected: FAIL with "Cannot find module '../bootstrap-fallback.js'".

- [ ] **Step 3: Write the module**

Create `src/runtime/session/bootstrap-fallback.ts`:

```typescript
// src/runtime/session/bootstrap-fallback.ts
//
// Localized first-contact greeting used by the kickoff route when the user
// clicks the Start CTA. The greeting is posted as a normal user message — it
// becomes the first turn of the permanent session and triggers the agent's
// introduction (BOOTSTRAP.md is consumed automatically on this first call).

/** Supported greeting languages (mirrors the UI i18n matrix). */
export const SUPPORTED_GREETING_LANGS = ["en", "fr", "de", "es", "it", "pt"] as const;

export type GreetingLang = (typeof SUPPORTED_GREETING_LANGS)[number];

const GREETINGS: Record<GreetingLang, string> = {
  en: "Hi 👋 Please introduce yourself, explain what you can do, and suggest a couple of starting points.",
  fr: "Bonjour 👋 Présente-toi, explique ce que tu peux faire, et propose quelques points de départ.",
  de: "Hallo 👋 Stell dich bitte vor, erkläre was du kannst, und schlage ein paar Ausgangspunkte vor.",
  es: "Hola 👋 Por favor, preséntate, explica lo que puedes hacer y sugiere algunos puntos de partida.",
  it: "Ciao 👋 Presentati, spiega cosa puoi fare e suggerisci qualche punto di partenza.",
  pt: "Olá 👋 Apresenta-te, explica o que podes fazer e sugere alguns pontos de partida.",
};

function isSupportedLang(value: string | undefined | null): value is GreetingLang {
  return typeof value === "string" && (SUPPORTED_GREETING_LANGS as readonly string[]).includes(value);
}

/**
 * Return the localized kickoff greeting for the given language code.
 * Falls back to English when the language is unknown or undefined.
 */
export function getKickoffGreeting(lang: string | undefined | null): string {
  return GREETINGS[isSupportedLang(lang) ? lang : "en"];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/runtime/session/__tests__/bootstrap-fallback.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/runtime/session/bootstrap-fallback.ts src/runtime/session/__tests__/bootstrap-fallback.test.ts
git commit -m "feat(runtime): add localized kickoff greeting module"
```

---

## Task 2: Kickoff dashboard route

**Files:**
- Create: `src/dashboard/routes/instances/agents/kickoff.ts`
- Test: `src/dashboard/routes/instances/agents/__tests__/kickoff.test.ts`

Contract:
- `POST /api/instances/:slug/agents/:agentId/kickoff`
- Body: `{}` (no fields required).
- Success: `202 { greeting: string, sessionId: string }` — the runtime started handling the greeting; the caller subscribes to the existing WS stream for parts.
- Error `404 AGENT_NOT_FOUND` — agent does not exist for this instance.
- Error `409 KICKOFF_ALREADY_DONE` — permanent session already has at least one message.
- Error `502 RUNTIME_UNREACHABLE` — the runtime chat endpoint failed.

- [ ] **Step 1: Write the failing test**

Create `src/dashboard/routes/instances/agents/__tests__/kickoff.test.ts`. This test file uses the same scaffolding patterns as `src/dashboard/__tests__/routes.test.ts` — read that file first for the `buildTestApp()` helper pattern if unfamiliar.

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { registerAgentKickoffRoutes } from "../kickoff.js";
import type { RouteDeps } from "../../../../route-deps.js";

function makeDeps(overrides: Partial<RouteDeps> = {}): RouteDeps {
  return {
    registry: {
      getInstanceBySlug: vi.fn().mockReturnValue({ id: 1, slug: "cp-system", port: 18789 }),
      getAgentById: vi.fn().mockReturnValue({ id: "pilot", config_json: "{}" }),
    },
    db: {
      prepare: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue({ count: 0 }) }),
    },
    monitor: {
      setTransitioning: vi.fn(),
      clearTransitioning: vi.fn(),
    },
    ...overrides,
  } as unknown as RouteDeps;
}

beforeEach(() => {
  vi.restoreAllMocks();
  // Mock global fetch — the route calls the runtime chat endpoint.
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ sessionId: "cp-system:pilot" }), { status: 200 }),
  );
});

describe("POST /api/instances/:slug/agents/:agentId/kickoff", () => {
  it("returns 202 and the greeting when session is empty", async () => {
    const app = new Hono();
    registerAgentKickoffRoutes(app, makeDeps());

    const res = await app.request("/api/instances/cp-system/agents/pilot/kickoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(res.status).toBe(202);
    const body = (await res.json()) as { greeting: string; sessionId: string };
    expect(body.greeting.length).toBeGreaterThan(0);
    expect(body.sessionId).toBe("cp-system:pilot");
  });

  it("returns 409 when session already has messages", async () => {
    const deps = makeDeps({
      db: {
        prepare: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue({ count: 3 }) }),
      } as unknown as RouteDeps["db"],
    });
    const app = new Hono();
    registerAgentKickoffRoutes(app, deps);

    const res = await app.request("/api/instances/cp-system/agents/pilot/kickoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("KICKOFF_ALREADY_DONE");
  });

  it("returns 404 when the agent does not exist", async () => {
    const deps = makeDeps({
      registry: {
        getInstanceBySlug: vi.fn().mockReturnValue({ id: 1, slug: "cp-system", port: 18789 }),
        getAgentById: vi.fn().mockReturnValue(null),
      } as unknown as RouteDeps["registry"],
    });
    const app = new Hono();
    registerAgentKickoffRoutes(app, deps);

    const res = await app.request("/api/instances/cp-system/agents/ghost/kickoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(res.status).toBe(404);
  });

  it("returns 502 when the runtime is unreachable", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const app = new Hono();
    registerAgentKickoffRoutes(app, makeDeps());

    const res = await app.request("/api/instances/cp-system/agents/pilot/kickoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(res.status).toBe(502);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/dashboard/routes/instances/agents/__tests__/kickoff.test.ts`
Expected: FAIL with "Cannot find module '../kickoff.js'".

- [ ] **Step 3: Implement the route**

Create `src/dashboard/routes/instances/agents/kickoff.ts`:

```typescript
// src/dashboard/routes/instances/agents/kickoff.ts
// POST /api/instances/:slug/agents/:agentId/kickoff
//
// Validates that the agent's permanent session is empty, then forwards a
// localized greeting to the runtime chat endpoint. The first prompt-loop
// turn naturally consumes BOOTSTRAP.md via the existing discovery logic in
// system-prompt.ts — no additional runtime plumbing required.
import type { Hono } from "hono";
import type { RouteDeps } from "../../../route-deps.js";
import { apiError } from "../../_helpers.js";
import { getKickoffGreeting } from "../../../../runtime/session/bootstrap-fallback.js";
import { buildPermanentSessionKey } from "../../../../runtime/session/session.js";
import { logger } from "../../../../lib/logger.js";

interface KickoffResponse {
  greeting: string;
  sessionId: string;
}

export function registerAgentKickoffRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, db } = deps;

  app.post("/api/instances/:slug/agents/:agentId/kickoff", async (c) => {
    const slug = c.req.param("slug");
    const agentId = c.req.param("agentId");

    // 1. Resolve the instance + agent.
    const instance = registry.getInstanceBySlug(slug);
    if (!instance) return apiError(c, 404, "INSTANCE_NOT_FOUND", `Unknown instance ${slug}`);

    const agent = registry.getAgentById(instance.id, agentId);
    if (!agent) return apiError(c, 404, "AGENT_NOT_FOUND", `Unknown agent ${agentId}`);

    // 2. Check that the permanent session is empty.
    const sessionKey = buildPermanentSessionKey(slug, agentId);
    const row = db
      .prepare(
        `SELECT COUNT(*) AS count
           FROM rt_messages
           WHERE session_id = (SELECT id FROM rt_sessions WHERE key = ?)`,
      )
      .get(sessionKey) as { count: number } | undefined;

    if ((row?.count ?? 0) > 0) {
      return apiError(c, 409, "KICKOFF_ALREADY_DONE", "Session already has messages");
    }

    // 3. Pick a greeting based on the user's language preference.
    const lang = registry.getUserProfile?.()?.language ?? "en";
    const greeting = getKickoffGreeting(lang);

    // 4. Forward to the runtime chat endpoint (same path the UI uses for normal sends).
    const chatUrl = `http://127.0.0.1:${instance.port}/chat`;
    try {
      const resp = await fetch(chatUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: greeting, agentId }),
      });
      if (!resp.ok) {
        return apiError(c, 502, "RUNTIME_UNREACHABLE", `Runtime responded ${resp.status}`);
      }
      const data = (await resp.json()) as { sessionId?: string };
      const response: KickoffResponse = { greeting, sessionId: data.sessionId ?? sessionKey };
      return c.json(response, 202);
    } catch (err) {
      logger.warn("[route:kickoff] runtime fetch failed", { error: String(err) });
      return apiError(c, 502, "RUNTIME_UNREACHABLE", "Failed to reach runtime");
    }
  });
}
```

> **Note for the implementer:** If `registry.getUserProfile` does not exist with that exact signature, use the existing user-profile repository method (find it via `grep -rn "user_profiles" src/core/repositories/`). If `buildPermanentSessionKey` is not exported from `session.ts`, import it from the actual module that defines it — check `grep -rn "buildPermanentSessionKey" src/runtime/`. The test above mocks both, so the exact import path only matters at runtime.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/dashboard/routes/instances/agents/__tests__/kickoff.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/routes/instances/agents/kickoff.ts src/dashboard/routes/instances/agents/__tests__/kickoff.test.ts
git commit -m "feat(dashboard): add kickoff route for empty permanent sessions"
```

---

## Task 3: Register the kickoff route

**Files:**
- Modify: `src/dashboard/routes/instances/agents.ts`

- [ ] **Step 1: Add the import and the registration line**

Edit `src/dashboard/routes/instances/agents.ts`. Add the import near the other agent route imports:

```typescript
import { registerAgentKickoffRoutes } from "./agents/kickoff.js";
```

And inside `registerAgentRoutes`, add the registration after `registerAgentSpawnLinkRoutes`:

```typescript
  registerAgentKickoffRoutes(app, deps); // POST .../agents/:id/kickoff
```

Final order must keep specific paths before parameterized ones (kickoff is parameterized, so registration order relative to the others is flexible — place it right before `registerAgentCreateRoutes` for readability).

- [ ] **Step 2: Run the typecheck**

Run: `pnpm typecheck`
Expected: no new errors.

- [ ] **Step 3: Run the existing agent route tests to ensure no regression**

Run: `pnpm vitest run src/dashboard/routes/instances/agents/`
Expected: PASS (all agent route tests, including the new kickoff tests).

- [ ] **Step 4: Commit**

```bash
git add src/dashboard/routes/instances/agents.ts
git commit -m "feat(dashboard): register kickoff route in agent orchestrator"
```

---

## Task 4: Ship a BOOTSTRAP.md for the system pilot

**Files:**
- Create: `templates/system/workspace/system-pilot/BOOTSTRAP.md`

- [ ] **Step 1: Write the template**

Create `templates/system/workspace/system-pilot/BOOTSTRAP.md`:

```markdown
# Bootstrap — First contact

You are meeting the user for the first time on the ClawPilot dashboard.
This file is consumed once and will not be shown to you again, so make it count.

## What to do

1. **Introduce yourself** briefly. Your name is Pilot. Your mission is to help the user operate ClawPilot — orchestrate agent teams, run flows, manage API keys, and keep things tidy.
2. **State three concrete things you can do** right now, phrased as actions:
   - Create a new team from a template or from scratch.
   - Start or stop any existing instance.
   - Answer questions about ClawPilot configuration, flows, or the database.
3. **Propose two or three starting points** the user can pick from — for example: *"Would you like to create your first team, take a guided tour of the dashboard, or connect a Telegram bot?"*
4. **End with a single open question** inviting the user to react.

## Tone

- Warm, concise, professional. Match the user's language (their preference is already set in their profile).
- No walls of text. Use short paragraphs and a bulleted list for the starting points.
- Do not recite this file. Rephrase in your own words.

## What NOT to do

- Do not ask for API keys, passwords, or credentials — they are already configured.
- Do not list every capability you have. Three is enough.
- Do not start working on a task before the user has picked a direction.
```

- [ ] **Step 2: Verify the template is picked up**

The file lives under `templates/system/workspace/system-pilot/` — the same directory as the existing `docs/` subfolder. `ensureSystemInstance()` copies this entire tree into the system instance's workspace at provisioning time. Confirm by checking `src/core/system-instance.ts` (or wherever `ensureSystemInstance` is defined) — grep for `copyRecursiveSync` or the function that seeds the workspace.

Run: `pnpm build:cli && node dist/index.js --help`
Expected: builds cleanly, no path issue related to the new template.

- [ ] **Step 3: Commit**

```bash
git add templates/system/workspace/system-pilot/BOOTSTRAP.md
git commit -m "feat(templates): add first-contact BOOTSTRAP.md for system pilot"
```

---

## Task 5: Add i18n strings

**Files:**
- Modify: `ui/src/locales/en.ts`, `ui/src/locales/fr.ts`, `ui/src/locales/de.ts`, `ui/src/locales/es.ts`, `ui/src/locales/it.ts`, `ui/src/locales/pt.ts`

- [ ] **Step 1: Find the existing pattern**

Run: `grep -n "home" ui/src/locales/en.ts | head -20` — look at how existing keys are grouped (e.g. `home.title`, `home.subtitle`). The codebase uses `@lit/localize`, so strings may be declared as `msg("...", { id: "key" })` directly in components, OR stored as constants in the locale files. Match whatever pattern exists.

- [ ] **Step 2: Add the strings**

In each of the 6 locale files, add two entries using the existing file's pattern. The values:

| Lang | `startCta.label` | `startCta.subtitle` |
|---|---|---|
| en | Start | Say hello to your Pilot |
| fr | Démarrer | Dis bonjour à ton Pilot |
| de | Starten | Sag hallo zu deinem Pilot |
| es | Empezar | Saluda a tu Pilot |
| it | Inizia | Saluta il tuo Pilot |
| pt | Começar | Cumprimenta o teu Pilot |

- [ ] **Step 3: Typecheck the UI**

Run: `pnpm typecheck:ui`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add ui/src/locales/
git commit -m "feat(ui): add i18n strings for Start CTA"
```

---

## Task 6: Add the `postAgentKickoff` API client

**Files:**
- Modify: `ui/src/api.ts`

- [ ] **Step 1: Add the function**

Open `ui/src/api.ts`. Near `postRuntimeChat` (around line 575), add:

```typescript
export interface AgentKickoffResponse {
  greeting: string;
  sessionId: string;
}

/**
 * Trigger the first prompt-loop turn for an empty permanent session.
 * Backed by POST /api/instances/:slug/agents/:agentId/kickoff.
 */
export async function postAgentKickoff(
  slug: string,
  agentId: string,
): Promise<AgentKickoffResponse> {
  return apiFetch<AgentKickoffResponse>(
    `/instances/${slug}/agents/${agentId}/kickoff`,
    { method: "POST", body: "{}" },
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck:ui`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add ui/src/api.ts
git commit -m "feat(ui): add postAgentKickoff API client"
```

---

## Task 7: Build the `<cp-start-cta>` component

**Files:**
- Create: `ui/src/components/cp-start-cta.ts`
- Test: `ui/src/components/__tests__/cp-start-cta.test.ts`

- [ ] **Step 1: Write the failing test**

Create `ui/src/components/__tests__/cp-start-cta.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fixture, html } from "@open-wc/testing-helpers";
import "../cp-start-cta.js";
import type { StartCta } from "../cp-start-cta.js";

beforeEach(() => {
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ greeting: "Hi", sessionId: "cp-system:pilot" }), { status: 202 }),
  );
});

describe("<cp-start-cta>", () => {
  it("renders a button with the Start label", async () => {
    const el = await fixture<StartCta>(
      html`<cp-start-cta slug="cp-system" agentId="pilot"></cp-start-cta>`,
    );
    const btn = el.shadowRoot!.querySelector("button");
    expect(btn).toBeTruthy();
    expect(btn!.textContent).toMatch(/Start|Démarrer|Starten/i);
  });

  it("enters loading state on click", async () => {
    const el = await fixture<StartCta>(
      html`<cp-start-cta slug="cp-system" agentId="pilot"></cp-start-cta>`,
    );
    const btn = el.shadowRoot!.querySelector("button")!;
    btn.click();
    await el.updateComplete;
    expect(btn.disabled).toBe(true);
    expect(el.shadowRoot!.querySelector(".spinner")).toBeTruthy();
  });

  it("dispatches cp-kickoff-done after a successful kickoff", async () => {
    const el = await fixture<StartCta>(
      html`<cp-start-cta slug="cp-system" agentId="pilot"></cp-start-cta>`,
    );
    const done = new Promise<CustomEvent>((resolve) => {
      el.addEventListener("cp-kickoff-done", (e) => resolve(e as CustomEvent));
    });
    el.shadowRoot!.querySelector("button")!.click();
    const evt = await done;
    expect(evt.detail).toMatchObject({ sessionId: "cp-system:pilot" });
  });

  it("reverts to idle on network failure", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("boom"));
    const el = await fixture<StartCta>(
      html`<cp-start-cta slug="cp-system" agentId="pilot"></cp-start-cta>`,
    );
    el.shadowRoot!.querySelector("button")!.click();
    await new Promise((r) => setTimeout(r, 10));
    expect(el.shadowRoot!.querySelector(".error")).toBeTruthy();
    expect(el.shadowRoot!.querySelector("button")!.disabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run ui/src/components/__tests__/cp-start-cta.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `ui/src/components/cp-start-cta.ts`:

```typescript
// ui/src/components/cp-start-cta.ts
//
// cp-start-cta — Centered animated "Start" button. Shown when the current
// agent's permanent session is empty. Calls the kickoff endpoint on click
// and dispatches `cp-kickoff-done` once the runtime accepts the greeting.

import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { msg } from "@lit/localize";
import { postAgentKickoff } from "../api.js";

@customElement("cp-start-cta")
export class StartCta extends LitElement {
  @property({ type: String }) slug = "";
  @property({ type: String }) agentId = "";

  @state() private _loading = false;
  @state() private _error: string | null = null;

  static override styles = css`
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 20px;
      padding: 32px;
    }
    button {
      width: 160px;
      height: 160px;
      border-radius: 50%;
      border: none;
      background: radial-gradient(circle, var(--accent, #7c5cfc) 0%, #4a3fb5 100%);
      color: white;
      font-size: 20px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 0 0 0 rgba(124, 92, 252, 0.6);
      animation: pulse 2s infinite;
      transition: transform 0.15s ease;
    }
    button:hover:not(:disabled) {
      transform: scale(1.05);
    }
    button:disabled {
      cursor: wait;
      animation: none;
      opacity: 0.85;
    }
    .subtitle {
      font-size: 14px;
      color: var(--text-secondary, #888);
    }
    .error {
      font-size: 13px;
      color: var(--danger, #ef4444);
    }
    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid rgba(255, 255, 255, 0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(124, 92, 252, 0.6); }
      70% { box-shadow: 0 0 0 24px rgba(124, 92, 252, 0); }
      100% { box-shadow: 0 0 0 0 rgba(124, 92, 252, 0); }
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      button { animation: none; box-shadow: 0 0 12px rgba(124, 92, 252, 0.6); }
      .spinner { animation-duration: 1.6s; }
    }
  `;

  private async _onClick(): Promise<void> {
    if (this._loading || !this.slug || !this.agentId) return;
    this._loading = true;
    this._error = null;
    this.dispatchEvent(new CustomEvent("cp-kickoff-start", { bubbles: true, composed: true }));
    try {
      const res = await postAgentKickoff(this.slug, this.agentId);
      this.dispatchEvent(
        new CustomEvent("cp-kickoff-done", {
          detail: { sessionId: res.sessionId, greeting: res.greeting },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      this._error = String((err as Error).message ?? err);
      this._loading = false;
    }
  }

  override render() {
    return html`
      <button
        type="button"
        aria-label=${msg("Start", { id: "startCta.label" })}
        ?disabled=${this._loading}
        @click=${() => void this._onClick()}
      >
        ${this._loading
          ? html`<div class="spinner" role="status"></div>`
          : msg("Start", { id: "startCta.label" })}
      </button>
      <div class="subtitle">
        ${msg("Say hello to your Pilot", { id: "startCta.subtitle" })}
      </div>
      ${this._error ? html`<div class="error">${this._error}</div>` : ""}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-start-cta": StartCta;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run ui/src/components/__tests__/cp-start-cta.test.ts`
Expected: PASS (4 tests). If the UI test runner complains about `@open-wc/testing-helpers`, check whether the project already uses a different Lit test helper — grep existing UI tests for `fixture` and match their import pattern.

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/cp-start-cta.ts ui/src/components/__tests__/cp-start-cta.test.ts
git commit -m "feat(ui): add cp-start-cta component"
```

---

## Task 8: Integrate the CTA into `home-chat.ts`

**Files:**
- Modify: `ui/src/components/home-chat.ts`

- [ ] **Step 1: Read the current render logic**

Run: `grep -n "render\|composer\|_messages" ui/src/components/home-chat.ts | head -30` to locate:
- The `render()` method (main template).
- Where the composer is rendered (usually a child component or an inline input area).

Note the exact variable holding the message list (per exploration: `this._messages`, length checked via `this._messages.length`).

- [ ] **Step 2: Add the import**

At the top of `ui/src/components/home-chat.ts`, add next to the other component imports:

```typescript
import "./cp-start-cta.js";
```

- [ ] **Step 3: Add conditional rendering**

Inside the `render()` method, locate the block that renders the composer (input area). Wrap it so the CTA is rendered **instead of** the composer when `this._messages.length === 0` and a session exists. Add this pattern (adjust property names to whatever the component currently uses):

```typescript
// Inside render()
${this._messages.length === 0
  ? html`<cp-start-cta
      .slug=${this.slug}
      .agentId=${this._agentId ?? ""}
      @cp-kickoff-done=${this._onKickoffDone}
    ></cp-start-cta>`
  : /* existing composer markup */ html`<!-- keep existing composer here -->`}
```

And add a handler on the class:

```typescript
private _onKickoffDone = (e: Event): void => {
  const detail = (e as CustomEvent<{ sessionId: string }>).detail;
  if (!this._activeSessionId) this._activeSessionId = detail.sessionId;
  // The WS stream will deliver the first parts; no additional action needed.
};
```

If there is an existing "empty state" placeholder in `home-chat.ts` (a grayed-out "No messages yet" panel), replace that placeholder entirely with the CTA — the CTA is the new empty-state.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck:ui`
Expected: no errors.

- [ ] **Step 5: Manually verify in the browser**

```bash
pnpm dev:ui   # or whatever dev server script is configured
```

Open the dashboard, reach the home screen after the wizard. Confirm:
- CTA appears centered when no messages exist.
- Click → spinner → first message streams in → CTA disappears, composer appears.

If there is no dev-server script, skip this step and rely on the e2e test in Task 10.

- [ ] **Step 6: Commit**

```bash
git add ui/src/components/home-chat.ts
git commit -m "feat(ui): mount Start CTA in empty home-chat state"
```

---

## Task 9: End-to-end test

**Files:**
- Create: `src/e2e/onboarding-kickoff.e2e.test.ts`

- [ ] **Step 1: Read an existing e2e test for the scaffolding pattern**

Run: `ls src/e2e/*.e2e.test.ts | head -5` then read one of them (e.g. the smallest). They all follow the same pattern: spin a real HTTP server with an in-memory DB + stub runtime, exercise routes via fetch.

- [ ] **Step 2: Write the e2e test**

Create `src/e2e/onboarding-kickoff.e2e.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { startTestServer, type TestServer } from "./helpers/server.js";
import { seedInstance, seedAgent } from "./helpers/seed.js";

let srv: TestServer;

beforeAll(async () => {
  srv = await startTestServer();
  seedInstance(srv.db, { slug: "cp-system", port: 18789 });
  seedAgent(srv.db, { instanceSlug: "cp-system", id: "pilot", persistence: "permanent" });
  // Mock runtime fetch — the kickoff route calls the runtime, we short-circuit.
  globalThis.fetch = vi.fn(async (input) => {
    if (String(input).includes("/chat")) {
      return new Response(JSON.stringify({ sessionId: "cp-system:pilot" }), { status: 200 });
    }
    return new Response("", { status: 404 });
  });
});

afterAll(async () => {
  await srv.close();
});

describe("onboarding kickoff (e2e)", () => {
  it("accepts a kickoff on an empty session and rejects a second one", async () => {
    const first = await srv.request("/api/instances/cp-system/agents/pilot/kickoff", {
      method: "POST",
      body: "{}",
    });
    expect(first.status).toBe(202);

    // Simulate that a message is now in the session.
    srv.db
      .prepare("INSERT INTO rt_sessions (key, instance_slug, agent_id) VALUES (?, ?, ?)")
      .run("cp-system:pilot", "cp-system", "pilot");
    const sid = (srv.db.prepare("SELECT id FROM rt_sessions WHERE key = ?")
      .get("cp-system:pilot") as { id: number }).id;
    srv.db
      .prepare("INSERT INTO rt_messages (session_id, role, created_at) VALUES (?, 'user', datetime('now'))")
      .run(sid);

    const second = await srv.request("/api/instances/cp-system/agents/pilot/kickoff", {
      method: "POST",
      body: "{}",
    });
    expect(second.status).toBe(409);
  });
});
```

> **Note to the implementer:** the exact helper signatures (`startTestServer`, `seedInstance`, `seedAgent`) must match the existing `src/e2e/helpers/` modules. If the helper API differs, adapt the test accordingly — the intent (seed one instance + one agent, call kickoff twice) is what matters.

- [ ] **Step 3: Run the e2e test**

Run: `pnpm test:e2e -t "onboarding kickoff"`
Expected: PASS (1 test).

- [ ] **Step 4: Commit**

```bash
git add src/e2e/onboarding-kickoff.e2e.test.ts
git commit -m "test(e2e): kickoff accepted on empty session, rejected on second call"
```

---

## Task 10: Document the component

**Files:**
- Create: `docs/ux-components/start-cta.md`

- [ ] **Step 1: Write the doc**

Create `docs/ux-components/start-cta.md`:

```markdown
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
4. Backend forwards to the runtime chat endpoint.
5. Runtime starts a normal prompt-loop turn. The existing `BOOTSTRAP.md`
   discovery logic in `src/runtime/session/system-prompt.ts` injects the
   agent's first-contact instructions on this first call (one-shot, tracked via
   `bootstrapDone` in the workspace state).
6. Frontend receives streaming parts via the existing WS channel.
7. CTA unmounts, composer takes its place.

## `BOOTSTRAP.md` convention

Each agent may ship a `BOOTSTRAP.md` in its workspace root (`<workDir>/workspaces/<agentId>/BOOTSTRAP.md`).
Recommended contents:

- Brief self-introduction (name, role, mission).
- 2–3 concrete capabilities stated as actions.
- 2–3 suggested starting points.
- One open question.

Absence or a stub file triggers the generic localized greeting.

## Accessibility

- `aria-label` matches the `startCta.label` i18n key.
- `prefers-reduced-motion: reduce` disables the halo pulse; a static glow
  remains for visual affordance.
```

- [ ] **Step 2: Commit**

```bash
git add docs/ux-components/start-cta.md
git commit -m "docs: document Start CTA component and BOOTSTRAP.md convention"
```

---

## Task 11: Full validation + push

- [ ] **Step 1: Run the full local validation suite**

Run (sequentially):
- `pnpm format:check`
- `pnpm lint:all`
- `pnpm typecheck:all`
- `pnpm test:run`
- `pnpm spellcheck`

Expected: all green. Fix anything that fails before pushing.

- [ ] **Step 2: Push the branch**

```bash
git push -u origin feature/onboarding-start-cta
```

- [ ] **Step 3: Open the pull request**

```bash
gh pr create --base develop \
  --title "feat(onboarding): Start CTA on empty persistent sessions" \
  --body "$(cat <<'EOF'
## Summary
- Add a central animated Start CTA on empty permanent agent sessions.
- New dashboard route `/api/instances/:slug/agents/:agentId/kickoff` validates emptiness and forwards a localized greeting to the runtime chat endpoint.
- Reuse the existing `BOOTSTRAP.md` one-shot mechanism for the agent's self-introduction. No change to `system-prompt.ts`.
- Ship a `BOOTSTRAP.md` for the system pilot so post-install onboarding works out of the box.

## Test plan
- [x] Unit: `bootstrap-fallback` returns correct greeting per language.
- [x] Route: kickoff accepts empty session, rejects non-empty (409), handles runtime failure (502).
- [x] Component: `cp-start-cta` renders, loads, emits `cp-kickoff-done`, reverts on failure.
- [x] E2E: kickoff flow end-to-end against the test server.
- [ ] Manual: fresh wizard → home → CTA visible → click → Pilot introduces itself → CTA gone after reload.

## Docs
- `docs/ux-components/start-cta.md` describes the component and `BOOTSTRAP.md` convention.
EOF
)"
```

- [ ] **Step 4: Verify CI is green**

Run: `gh pr checks --watch`
Expected: all checks pass.

---

## Self-Review

**Spec coverage** — every section of `docs/superpowers/specs/2026-04-19-onboarding-start-cta-design.md` maps to at least one task:
- §4 Trigger rule → Task 2 emptiness check, Task 8 UI guard.
- §5.1 Backend → Tasks 1, 2, 3.
- §5.2 Frontend → Tasks 6, 7, 8.
- §5.3 Data flow → Task 7 event dispatch, Task 8 integration.
- §6 `BOOTSTRAP.md` convention → Task 4 + Task 10 doc.
- §7 UX → Task 7 (animation, reduced-motion, loading state).
- §8 i18n → Task 5.
- §9 Error handling → Task 2 (409/502), Task 7 (`.error` state).
- §10 Testing → Tasks 1, 2, 7, 9.
- §11 Scope → every row covered by a task.

**Placeholder scan** — no "TBD", "implement later", or undefined references. Every code block is complete or explicitly flagged with an implementer note when the local API can differ (route registration, e2e helpers).

**Type consistency** — `AgentKickoffResponse { greeting, sessionId }` is consistent between Task 2 (route), Task 6 (client), Task 7 (component event detail).
