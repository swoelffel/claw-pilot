# Component — Input Mapping Editor (`cp-input-mapping-editor`)

> **Source**: `ui/src/components/triggers/cp-input-mapping-editor.ts`
> **Used in**: `cp-trigger-wizard` (step 3)

Array editor for trigger input mappings. Each row is a `{ from: <JSONPath>, to: <flow variable> }` pair. Emits a `change` event on every mutation with the full updated array.

## Mockup

```
+-- row ---------------------------------------------------------+
| [$.path.to.field        ] [flow_var_name        ] [Remove]      |
+----------------------------------------------------------------+
[+ Add mapping]
Use JSONPath in the left column, target flow variable on the right.
```

Empty state: italic muted "No mapping defined" above the `[+ Add mapping]` button.

## Props

| Property | Type | Description |
|---|---|---|
| `value` | `InputMappingEntry[]` | Initial rows. Component keeps an internal copy in `_rows`. |

## Events emitted

| Event | Detail | When |
|---|---|---|
| `change` | `InputMappingEntry[]` | After add / remove / per-key edit (`from` or `to`) |

`bubbles: true, composed: true`.

## Layout

`grid-template-columns: 1fr 1fr auto`. Inputs are mono (`--font-mono`, 13px). The `Remove` button uses `--state-error` text on a bordered transparent background.

## Validation

No client-side validation. Server validates JSONPath syntax and flow-variable identifiers when the parent submits the trigger.

## Hint text

Static helper line under the rows (i18n id `trigger-mapping-hint`):
"Use JSONPath in the left column, target flow variable on the right."

## Related

- Parent: [comp-trigger-wizard.md](comp-trigger-wizard.md)

---

*Since v0.81.0 (TRIGGER-001a)*
