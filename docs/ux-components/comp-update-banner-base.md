# Update Banner Base (`cp-update-banner-base`)

> **Source**: `ui/src/components/update-banner-base.ts`

Base Lit component factoring CSS and HTML structure for the claw-pilot update banner. Not used directly — instantiated via the `cp-self-update-banner` wrapper.

## Props

| Prop | Type | Description |
|---|---|---|
| `status` | `SelfUpdateStatus \| null` | Update status passed by the wrapper |
| `productName` | `string` | Product name displayed in messages (e.g., `"claw-pilot"`) |
| `buttonLabel` | `string` | Action button label (idle+updateAvailable state) |
| `runningSubtitle` | `string` | Subtitle displayed during running state |
| `doneSubtitle` | `string` | Subtitle displayed after success (done state) |
| `dismissable` | `boolean` | If `true`, displays × button on done state |

## Emitted Events

| Event | Condition | Description |
|---|---|---|
| `cp-update-action` | Update or Retry click | Bubbles + composed. Captured by wrapper which re-emits. |
| `cp-update-dismiss` | × click (if dismissable) | Bubbles + composed. Local dismiss (state `_dismissed`). |

## Dismiss Behavior

- The `_dismissed` state is local to the component (property `@state`).
- It automatically resets if `status` changes (new update cycle).
- Dismiss is purely visual — no API calls.

## Design System

Same tokens as the rest of the application:

| State | Color | Token |
|---|---|---|
| warning (update available) | Amber | `--state-warning` (#f59e0b) |
| info (in progress) | Cyan | `--state-info` (#0ea5e9) |
| success (done) | Green | `--state-running` (#10b981) |
| error | Red | `--state-error` (#ef4444) |

Spinner: `border: 2px solid currentColor`, `border-top-color: transparent`, `animation: spin 0.7s linear infinite`.
Version tags: `font-family: var(--font-mono)`, `font-size: 12px`, `font-weight: 600`.

## Related

- Components: [Self Update Banner](comp-self-update-banner.md)
