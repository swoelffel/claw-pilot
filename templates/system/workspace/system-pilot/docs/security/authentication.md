# Authentication, Permissions and Secret Boundaries

Reviewed against Community 0.84.13. Discover the installed authentication providers through the login screen or GET /api/auth/providers. Local credentials and optional providers use their supported login/logout flow; do not assume all installations use the same provider or user lifecycle.

Dashboard sessions, programmatic bearer access and runtime tool permissions are distinct boundaries. Use supported UI/API clients and the configured identity. Never put a dashboard token in a copied URL, prompt, report or example. A role label alone is not proof of effective access: the installed permission checker can deny an action for its resource/scope.

## Diagnose an access error

1. Read the actual error; unreadable history is an error, not an empty conversation. Do not press Start to replace an existing conversation you cannot read.
2. Confirm the intended account, instance and operation. Reconnect through normal authentication if needed; credential refresh is bounded, not an endless retry loop.
3. If permitted, POST /api/auth/permissions/inspect with the action/resource to inspect the current principal's decision. Otherwise ask an administrator for a scoped diagnosis.
4. Report the missing action/scope and observed denial. Do not request broad secret/admin rights as a workaround.

Full execution-console access is different from the minimal activity information used by an authorized chat stream. Ordinary trigger management is also different from dedicated secret reveal, rotation and revocation. Creation accepts the initial webhook secret without making the creator a secret administrator.

Named keys and SecretProvider values require supported secure entry/administration. Metadata can identify a key or trigger without revealing the value. Never extract secrets by SQL, environment or filesystem inspection. Tool visibility does not grant permission to fulfill every user request.

Optional edition-specific authentication, grants and user-team behavior must be checked in that installation's private operational guidance. Do not promise fixed admin/operator/viewer capabilities across deployments.
