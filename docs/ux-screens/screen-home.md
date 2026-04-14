# Screen — Home Screen (`cp-home-screen`)

> **Source**: `ui/src/components/home-screen.ts`
> **Route**: `#/home`
> **Entry point**: Default landing page after login

Dashboard home screen with automatic system instance management. Three-state flow: wizard (no API keys) → provisioning → chat.

## Mockup

```
┌─ Home ──────────────────────────────────────────────────────────┐
│                                                                  │
│   State: wizard         State: provisioning    State: ready      │
│   ┌──────────────┐      ┌──────────────┐      ┌──────────────┐  │
│   │ cp-home-     │      │  (spinner)   │      │ cp-home-chat │  │
│   │ wizard       │  →   │ Provisioning │  →   │              │  │
│   │ (setup form) │      │ cp-system... │      │ (lean chat)  │  │
│   └──────────────┘      └──────────────┘      └──────────────┘  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## State Machine

| State | Condition | Display |
|---|---|---|
| `loading` | Initial boot | Centered spinner |
| `wizard` | No named API keys exist | `cp-home-wizard` setup form |
| `provisioning` | Keys exist, system instance not provisioned | Spinner + "Provisioning cp-system..." |
| `starting` | Provisioned but stopped | Spinner + "Starting..." |
| `ready` | System instance running | `cp-home-chat` with system slug |
| `error` | Any failure | Error message + Retry button |

## Initialization Flow

1. Fetch named API keys (`GET /api/named-keys`)
2. If no keys → `wizard` state (render `cp-home-wizard`)
3. Fetch system instance status (`GET /api/system-instance/status`)
4. If not provisioned → auto-provision via `POST /api/system-instance/provision` (passes first key ID)
5. Poll until ready (1s interval, max 30 attempts)
6. If ready → `ready` state (render `cp-home-chat` with slug)

## Sub-components

| Component | When | Purpose |
|---|---|---|
| `cp-home-wizard` | `wizard` state | Setup form for provider/API key/model. Emits `wizard-complete` on success. |
| `cp-home-chat` | `ready` state | Lean chat interface for system instance. No context panel, no filter bar. |

## Events

| Event | Direction | Description |
|---|---|---|
| `wizard-complete` | wizard → home-screen | Re-triggers initialization (keys now exist) |

## Data Fetching

| Endpoint | Description |
|---|---|
| `GET /api/named-keys` | List API keys (determines wizard vs chat) |
| `GET /api/system-instance/status` | System instance provisioning status |
| `POST /api/system-instance/provision` | Auto-provision cp-system |

## i18n

All strings use `msg("...", { id: "home.*" })` prefix.

---

*Since v0.70.0*
