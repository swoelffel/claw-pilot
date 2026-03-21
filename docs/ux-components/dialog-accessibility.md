# Dialog Accessibility

Since v0.7.1, all modal dialogs implement `DialogMixin`:

| Behavior | Detail |
|---|---|
| **Focus trap** | Focus remains in dialog while open (Tab / Shift+Tab cycle in dialog) |
| **Escape** | Close dialog (except during operation in progress) |
| **aria-modal** | `aria-modal="true"` on dialog root element |

Dialogs covered: `cp-create-dialog`, `cp-delete-instance-dialog`, `cp-create-agent-dialog`, `cp-delete-agent-dialog`, `cp-import-team-dialog`.
