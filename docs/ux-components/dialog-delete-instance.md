# Dialog: Delete Instance (`cp-delete-instance-dialog`)

> **Source**: `ui/src/components/delete-instance-dialog.ts`

Centered modal, dark overlay with `backdrop-filter: blur(4px)`. Max width `440px`. Triggered by ✕ button on instance card (event `request-delete` captured by `cluster-view`).

## Mockup

```
┌─ Delete instance ───────────────────── [✕] ┐
│                                              │
│  ┌─ Warning ──────────────────────────────┐  │
│  │  This will permanently stop the        │  │
│  │  service, remove all files...          │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  My instance — default                       │
│                                              │
│  Type the instance slug to confirm           │
│  [default                              ]     │
│                                              │
│                    [Cancel]  [Destroy]       │
└──────────────────────────────────────────────┘
```

## Behavior

- **Destroy** button solid red, disabled while input ≠ exact slug
- `Enter` in input → confirms
- During deletion: spinner + "Destroying instance... **slug**"
- After deletion: emit `instance-deleted { slug }` → `cluster-view` reloads list

## Related

- Screens: [Instances View](../ux-screens/screen-instances.md)
