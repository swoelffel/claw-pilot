# Permission Overlay (`cp-permission-request-overlay`)

> **Source**: `ui/src/components/permission-request-overlay.ts`

Fixed overlay bottom-right corner (`bottom: 24px`, `right: 24px`, `z-index: 9999`, `width: 480px`). Automatically displayed when a claw-runtime agent emits `permission.asked` event via SSE stream. Managed by `cp-app` (or parent component monitoring active instance).

## Mockup

```
┌─ 🔐 Permission Request ──────────────────────── [✕] ─┐
│                                                       │
│  Request description (if provided)                    │
│                                                       │
│  ┌─ Details ────────────────────────────────────────┐ │
│  │  Permission  Bash                                │ │
│  │  Pattern     /tmp/**                             │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  42s  ████████████████░░░░░░░░  (countdown bar)       │
│                                                       │
│  [toggle]  This time only / Always (for this agent)   │
│                                                       │
│  [Deny]  [Deny with feedback]  [Approve]  [Dismiss]   │
└───────────────────────────────────────────────────────┘
```

## Behavior

| Element | Description |
|---|---|
| **Header** | Transparent red background `rgba(239,68,68,0.06)`. Red title `--state-error` + 🔐 icon. Count badge if multiple requests queued. **[✕]** dismiss button. |
| **Description** | Free text provided by agent (optional). |
| **Details** | `--bg-hover` background, `--bg-border` border. Lines: Permission (monospace) + Pattern (monospace). |
| **Countdown** | Red progress bar emptying over 60s. Auto-dismiss at 0. |
| **Persist toggle** | "This time only" (default) / "Always (for this agent)". Controls if rule persisted. |
| **[Deny]** | Red outline. Send `decision: "deny"` immediately. |
| **[Deny with feedback]** | Transparent red outline. First click → show comment textarea. Second click → send with comment. |
| **[Approve]** | Green outline. Send `decision: "allow"`. |
| **[Dismiss]** | Gray, `margin-left: auto`. Remove request from queue without responding. |

## FIFO Queue

Requests accumulate in queue. Only one displayed at a time. After response or dismiss, next displays and countdown restarts at 60s.

## SSE Source

Listen to `GET /api/instances/:slug/runtime/chat/stream`. Event `permission.asked` → add to queue.

## Response API

`POST /api/instances/:slug/runtime/permission/reply` with `{ permissionId, decision, persist, comment? }`.
