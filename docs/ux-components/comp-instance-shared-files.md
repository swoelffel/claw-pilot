# Component — Instance Shared Files (`cp-instance-shared-files`)

> **Source**: `ui/src/components/instance-shared-files.ts`
> **Used in**: `cp-instance-settings` ("Shared files" sidebar section)

Admin panel for the per-instance shared workspace. Files live at `<stateDir>/workspaces/shared/` on the server and are readable by every agent of the instance via `ws_list_files` / `ws_search_files` (entries prefixed with `@shared/`).

## Mockup

```
+-- 2-pane layout --------------------------------------+
| Tree (cp-agent-file-tree)  | Editor (cp-agent-file-edit) |
|  + new file                |  /content of selected file/  |
|  + new folder              |  [Save] [Delete]              |
|  - foo.md                  |                                |
|  - notes/                  |                                |
+--------------------------------------------------------+
```

## Props

| Property | Type | Description |
|---|---|---|
| `slug` | `string` | Instance slug |

## State

| Field | Purpose |
|---|---|
| `_tree` | `AgentFileTreeNode[]` from `fetchSharedFileTree` |
| `_activePath` | Currently edited file |
| `_newFileDialogOpen` / `_newFolderMode` / `_newFileParentDir` | New-file dialog state |
| `_deleteDialogOpen` / `_deleteTarget` | Delete dialog state |

## Children

- `cp-agent-file-tree` — collapsible directory tree, per-folder "+ new" actions.
- `cp-agent-file-editor` — Monaco-style textarea wrapper, save on demand.
- `cp-workspace-file-dialogs` — shared "new file" + "delete" confirmations (also used by agent detail panel).

## API

| Endpoint | Use |
|---|---|
| `GET /api/instances/:slug/shared-files/tree` | Initial + post-save reload |
| `GET /api/instances/:slug/shared-files/*path` | Open file content |
| `PUT /api/instances/:slug/shared-files/*path` | Save edits |
| `DELETE /api/instances/:slug/shared-files/*path` | Remove file |

## Related

- Parent screen: [screen-instance-settings.md](../ux-screens/screen-instance-settings.md).
- Tree: [comp-agent-file-tree.md](comp-agent-file-tree.md).

---

*Since v0.78+ (schema v38 — shared workspace)*
