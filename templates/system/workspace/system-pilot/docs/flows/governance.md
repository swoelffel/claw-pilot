# Workflow Validation and Unattended Execution

Reviewed against Community 0.84.13. A flow's enabled flag, lifecycle and validation result are distinct. Cron and incoming webhooks require an ACTIVE workflow and current VALID or supported LEGACY_VALID status, within its hourly run limit.

## Supported lifecycle

| Current state | Allowed next states |
|---|---|
| DRAFT | TESTING, ARCHIVED |
| TESTING | DRAFT, VALIDATED, ARCHIVED |
| VALIDATED | ACTIVE, TESTING, ARCHIVED |
| ACTIVE | PAUSED, ARCHIVED |
| PAUSED | ACTIVE, TESTING, ARCHIVED |
| ARCHIVED | None |

POST /api/instances/:slug/flows/:id/validate returns the current validation report and can move a valid DRAFT/TESTING flow to VALIDATED. PUT /api/instances/:slug/flows/:id/lifecycle takes a lifecycle value. These routes require their effective permissions; they are not implicit cp_* tool abilities.

Validation inspects the referenced instance, agents and step/configuration prerequisites. It is a bounded report, not proof of business correctness or a comprehensive security certification. Inspect its issues; do not patch validation_status or lifecycle columns to bypass a failure.

After an authorized activation, test the actual input path and inspect the terminal result. Fire now and a real signed incoming call prove different things. Modification, pausing, stale validation, hourly limits and failure handling can affect eligibility; re-read current metadata when diagnosing admission.

Governance also provides APIs for agent version/promotion, business tasks/outcomes, use cases and cost/adoption data. Those are foundations with their own permissions, not a claim that every feature has a complete UI or is enabled on this installation.
