# claw-pilot Update Banner (`cp-self-update-banner`)

> **Source**: `ui/src/components/self-update-banner.ts`

Component `<cp-self-update-banner>` displayed **at top of `<main>`**, above all views (cluster, blueprints, settings…). Light wrapper around `<cp-update-banner-base>`.

## Mockup

```
┌─────────────────────────────────────────────────────────────────┐
│  [nav header]                                                   │
├─────────────────────────────────────────────────────────────────┤
│  ┌─ claw-pilot update banner (conditional) ──────────────────┐ │
│  │  ↑ claw-pilot update available  v0.12.0   [Update claw-pilot]│ │
│  └─────────────────────────────────────────────────────────────┘ │
│  [active view content]                                          │
└─────────────────────────────────────────────────────────────────┘
```

## States

| State | Style | Content |
|---|---|---|
| **idle + updateAvailable** | Amber (`--state-warning`) | "claw-pilot update available vX.Y.Z" + current version + **[Update claw-pilot]** button |
| **running** | Cyan (`--state-info`) | Spinner + "Updating claw-pilot…" + "This may take several minutes (git + build)" |
| **done** | Green (`--state-running`) | "claw-pilot updated → vX.Y.Z" + "Dashboard service restarted" + **[×]** button (dismiss) |
| **error** | Red (`--state-error`) | "claw-pilot update failed" + error message + **[Retry]** button |

**Polling**: immediate check on startup + every 60s. Accelerated to 3s during `status === "running"`.

**Post-done**: automatic `location.reload()` after 2s (loads new JS bundle). If reload doesn't happen (slow restart, network issue), **×** button allows manual banner close.

**Event**: Update/Retry button emits `cp-update-action` (bubbles + composed) → captured by `cp-app` via `@cp-update-action` on `<main>`.

**Version source**: GitHub Releases API (`/repos/swoelffel/claw-pilot/releases/latest`). Standard semver comparison.

## Related

- Components: [Update Banner Base](comp-update-banner-base.md)
