# Component — Trigger wizard (`cp-trigger-wizard`)

The instance-scoped wizard creates cron and inbound webhook triggers. Edit mode locks the kind and target flow and updates the existing trigger.

1. Select Cron or Webhook.
2. Select an enabled flow from the current instance. The server attributes creation to the authenticated user; the owner field does not delegate execution privileges.
3. Enter the name and kind-specific settings. Cron uses the interval/cron picker and timezone. Webhook uses a lower-case slug (3–64 letters, digits or hyphens), a masked initial shared secret (16–256 characters, no newlines), optional IP/CIDR restrictions and JSONPath input mapping. Enabled defaults on; concurrency defaults off.

Creation sends `POST /api/instances/:slug/triggers`; editing uses `PUT /api/instances/:slug/triggers/:id`. Clearing the mapping or IP list removes the restriction. The initial secret is supplied only on creation, persisted through SecretProvider, and never returned. Reveal, rotation and revocation are separate administrator actions in the detail drawer.

New webhooks use the versioned signature contract in [Flow triggers](../architecture/flow-triggers.md). A flow must pass unattended-execution governance when invoked, even if it was selectable at creation time.
