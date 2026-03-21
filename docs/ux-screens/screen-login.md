# Screen 0 — Login (`cp-login-view`)

> **Source**: `ui/src/components/login-view.ts`

Displayed instead of the entire application if the user is not authenticated (or session expired). Centered vertically and horizontally on `min-height: 100vh`.

## Mockup

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│              ┌─ Card (max-width 360px) ──────────────────┐     │
│              │                                           │     │
│              │           Claw Pilot                      │     │
│              │                                           │     │
│              │  [Bandeau session expirée — ambre]        │     │
│              │  (conditionnel)                           │     │
│              │                                           │     │
│              │  Username                                 │     │
│              │  [admin                          ]        │     │
│              │                                           │     │
│              │  Password                                 │     │
│              │  [                               ]        │     │
│              │                                           │     │
│              │  [Sign in]                                │     │
│              │                                           │     │
│              │  (message d'erreur si échec)              │     │
│              │                                           │     │
│              │  v0.41.24                                 │     │
│              └───────────────────────────────────────────┘     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Elements

| Element | Description |
|---|---|
| **Title** | "Claw**Pilot**" — accent span on "Pilot", `font-size: --text-xl`, `font-weight: 700`, centered |
| **Session expired banner** | Amber background `rgba(245,158,11,0.1)`, amber border. Visible if prop `sessionExpired = true`. Message: "Your session has expired. Please sign in again." |
| **Username** | Text input, pre-filled with `"admin"` |
| **Password** | Password input, autofocus on open |
| **[Sign in]** | Full button `--accent`, width 100%, `min-height: 44px`. Shows "…" during submission. |
| **Error** | Red text centered below button. Messages: "Invalid credentials" (401), "Too many attempts. Please wait a moment." (429), "An error occurred. Please try again." (others). |
| **Version** | `v{APP_VERSION}` monospace muted, centered, `font-size: 11px` |

## Behaviors

- `Enter` in any field → submit form
- During submission: button disabled
- Success: emits `authenticated { token }` → `cp-app` stores token and initializes app
- Card has `background: --bg-surface`, `border: 1px solid --bg-border`, `border-radius: 8px`, `padding: 32px`
