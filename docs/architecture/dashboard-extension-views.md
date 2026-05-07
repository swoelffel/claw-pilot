# Dashboard extension views

**Extension-Point**: `dashboard-extension-views`

A small registry exposed by `ui/src/services/extension-views.ts` that
lets non-Community editions (Enterprise, third-party plugins) ship
additional top-level views inside the dashboard without forking the
router.

## Why

The Community router (`ui/src/services/router.ts`) is exhaustive over
its `Route` discriminated union. Adding a new view to ship an
Enterprise admin console required modifying both `router.ts` and
`app.ts`, both of which are frozen paths in the EE fork — every
upstream sync would surface a conflict.

The hook decouples view registration from the router: an extension
owns the URL prefix `/ext/<id>` and provides its own match / render /
nav metadata. The router stays untouched; `app.ts` only learned how
to delegate when the hash matches an extension.

## Contract

```ts
import { registerExtensionView } from "@/services/extension-views";

registerExtensionView({
  id: "rbac-roles", // becomes /ext/rbac-roles
  toHash: () => "",
  render: () => html`<my-rbac-roles-list></my-rbac-roles-list>`,
  nav: { label: "Roles", order: 50 },
});
```

| Field          | Required | Description                                                                                       |
| -------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `id`           | yes      | `/^[a-z][a-z0-9-]*$/`. Owns `/ext/<id>` and identifies the registration.                          |
| `toHash`       | yes      | Builds the canonical hash for navigation. Receives optional params, returns `""` or `/sub-path`. |
| `render`       | yes      | Returns a Lit `TemplateResult`. Invoked on every render while the extension is active.            |
| `matchSubPath` | no       | Parses the substring after `/ext/<id>/`. Default: only the bare id matches.                       |
| `nav`          | no       | `{ label, order? }`. Omit for hidden views (only reachable via deep links).                       |

`registerExtensionView` throws on invalid ids and on duplicate
registrations — there is no idempotent re-registration because a
duplicate signals two consumers fighting for the same slot.

## Capability gating

The hook is invoked unconditionally by `app.ts`. Capability gating is
the consumer's responsibility — register from a bootstrap module that
is only loaded when the relevant capability is set:

```ts
// In Enterprise bootstrap:
if (capabilities.has("rbac-fine")) {
  await import("./rbac-views.js"); // calls registerExtensionView
}
```

This keeps Community free of any "if Enterprise" branches.

## Where this is wired

- `ui/src/app.ts` — header nav iterates `listExtensionNavItems()` after
  the built-in tabs; `_renderMain()` calls `matchExtensionHash()`
  before falling back to the home view.
- `ui/src/services/router.ts` — **not modified**. Unknown hashes
  resolve to `{ view: "home" }`; `app.ts` intercepts them when an
  extension claims the prefix.

## Testing

`ui/src/services/__tests__/extension-views.test.ts` covers the
registry surface (validation, ordering, sub-path parsing, hash
building). Use `resetExtensionViews()` between tests to keep the
module-level Map isolated.
