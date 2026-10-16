# Resource Health, Circuit Breakers and Diagnostics

Reviewed against Community 0.84.13. Use the approved resource and identity that the execution actually has.

- Permission/access denial is not a transient outage: request the missing access or choose an already approved resource.
- Credential failure needs a scoped credential repair; do not repeatedly retry with unrelated credentials.
- Missing resources/tools need configuration or a different supported target.
- Temporary network/provider/rate-limit failures have bounded retry allowances. A circuit breaker can quarantine a repeatedly failing resource; honor its cooldown instead of looping.

GET /api/instances/:slug/preflight reports execution prerequisites under the caller's permissions. Observability routes below /api/instances/:slug/observability expose metrics, traces/:traceId, alerts and retention policies. They can require execution read/analytics rights; basic chat permission is not equivalent.

POST /api/auth/permissions/inspect inspects a supplied action/resource for the authenticated principal. It explains a decision; it neither grants permission nor permits impersonation. Do not recommend a global admin token or changing role assignments as a diagnostic shortcut.

Record request/trace/execution IDs, scoped error codes, observed state and time. Redact payloads/credentials and minimize conversation data. Distinguish application events, security audit events and log severity. Zero system-priority journal errors is not proof of zero application errors or complete telemetry persistence.

Retention changes and recovery actions are mutations that need explicit scope and effective permission. Inspect before changing; do not delete history or reconcile an old running row to hide a warning.
