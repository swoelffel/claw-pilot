# Screen 1 — Instances View (`cp-cluster-view`)

> **Source**: `ui/src/components/cluster-view.ts`
> **Route**: `#/` or `#/instances`

Home page. Grid of instance cards. `padding: 24px`.

## Mockup

```
┌─────────────────────────────────────────────────────────────────┐
│  2 instances                          [+ New Instance]          │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐                    │
│  │  Instance Card   │  │  Instance Card   │                    │
│  └──────────────────┘  └──────────────────┘                    │
└─────────────────────────────────────────────────────────────────┘
```

## States

| State | Rendering |
|---|---|
| **Loading** | Centered text "Loading instances..." (early return — header not shown) |
| **Error** | Red error banner at top, empty grid |
| **Empty** | Icon + "No instances found" centered + **[Discover instances]** button |
| **Normal** | Header "N instances" + grid `auto-fill minmax(300px, 1fr)`, gap 16px |

**Empty state — detail:**

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                    ▪                                            │
│              No instances found                                 │
│                                                                 │
│              [Discover instances]                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

The **[Discover instances]** button (`btn btn-secondary`) opens the `cp-discover-dialog` which scans the system for existing claw-runtime instances and offers to adopt them.

## Interactions

- **Click on a card** → navigate to Instance Detail view
- **"+ New Instance" button** → open creation dialog (`cp-create-dialog`)
- After creation: close dialog + reload list

## Related

- Components: [Instance Card](../ux-components/comp-instance-card.md), [New Instance Dialog](../ux-components/dialog-create-instance.md), [Delete Instance Dialog](../ux-components/dialog-delete-instance.md), [Discover Dialog](../ux-components/dialog-discover.md)
