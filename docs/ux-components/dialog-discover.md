# Dialog: Instance Discovery (`cp-discover-dialog`)

> **Source**: `ui/src/components/discover-dialog.ts`

Centered modal, dark overlay with `backdrop-filter: blur(4px)`. Max width `520px`. Triggered by **[Discover instances]** button in Instances view (empty state). Implements `DialogMixin`.

Scan starts automatically on open (`connectedCallback`).

## Mockup

```
┌─ Discover instances ──────────────────────────── [✕] ┐
│                                                       │
│  Phase scanning:                                      │
│  ┌─────────────────────────────────────────────────┐  │
│  │  [spinner]                                      │  │
│  │  Scanning system...                             │  │
│  │  Looking for claw-runtime instances              │  │
│  └─────────────────────────────────────────────────┘  │
│                                                       │
│  Phase results (instances found):                     │
│  Found 2 instance(s) on this system:                  │
│  ┌─ Instance card ───────────────────────────────┐    │
│  │  default                    ● running         │    │
│  │  :18789  ✈ @my_bot  claude-sonnet  3 agents   │    │
│  └───────────────────────────────────────────────┘    │
│  ┌─ Instance card ───────────────────────────────┐    │
│  │  staging                    ○ stopped         │    │
│  │  :18790                                       │    │
│  └───────────────────────────────────────────────┘    │
│                                [Cancel]  [Adopt all (2)]│
│                                                       │
│  Phase adopting:                                      │
│  [spinner]  Registering instances...                  │
│                                                       │
│  Phase done:                                          │
│  ✓  2 instance(s) registered successfully.            │
│                                                       │
│  Phase error:                                         │
│  [red banner]  [Close]  [Retry]                       │
└───────────────────────────────────────────────────────┘
```

## Phase Details

| Phase | Trigger | Rendering |
|---|---|---|
| **scanning** | Dialog open | Centered spinner + "Scanning system..." + subtitle "Looking for claw-runtime instances" |
| **results** | Scan complete | List of found instances (or message "No claw-runtime instances found") + footer [Cancel] [Adopt all (N)] |
| **adopting** | Click [Adopt all] | Spinner + "Registering instances..." |
| **done** | Adoption succeeded | Green ✓ icon + "N instance(s) registered successfully." Auto-close after 1.5s with `instances-adopted` emission |
| **error** | Scan or adoption error | Red banner + [Close] + [Retry] |

## Instance Card (in results list)

Background `--bg-base`, border `--bg-border`, `border-radius: --radius-md`.

| Element | Description |
|---|---|
| **Slug** | `font-weight: 700`, `font-size: 14px` |
| **State badge** | Green pill "● running" if `gatewayHealthy`, gray "○ stopped" otherwise |
| **Port** | Monospace muted `:XXXXX` |
| **Telegram** | Blue pill `#0088cc` if `telegramBot` defined |
| **Model** | Monospace muted if `defaultModel` defined |
| **Agent count** | "N agents" if `agentCount > 0` |

## Behaviors

- **Close**: ✕ button (disabled during `adopting` phase) or overlay click (same)
- **Retry**: restart scan from `scanning` phase
- **Adopt all**: adopt all found instances in single action
- **After adoption**: emit `instances-adopted { count }` → `cluster-view` closes dialog and reloads list

## Accessibility

`role="dialog"`, `aria-modal="true"`, `aria-labelledby`. Implements `DialogMixin` (focus trap, Escape).

## Related

- Screens: [Instances View](../ux-screens/screen-instances.md)
