# Repairing legacy cp-system built-in flows

The three-agent system team uses `system-pilot`, `ops` and `analyst`. Older
Onboarding, Config Backup, Team Builder and Team Optimizer definitions reference
removed agents (`admin-exec` / `architect`). Updating the installed template alone
does **not** repair these definitions: provisioning skips existing flows by name.
There is no automatic migration in this fix.

## Corrected behavior

| Flow | Steps | Result |
| --- | --- | --- |
| Onboarding | analyst discovery → system-pilot proposal | Readiness assessment and first-team proposal; no provisioning |
| Config Backup | analyst inventory | Read-only metadata report; not a restorable backup |
| Team Builder | system-pilot design | Proposal from explicit `vars.brief`; no provisioning |
| Team Optimizer | analyst audit → system-pilot recommendations | Advice for explicit `vars.targetSlug`; no changes |

Health Check and Cost Audit are unchanged. Team creation or configuration changes
require a separate explicit request in conversation, with a reviewed specification
and the user's model/key choices, then delegation to ops. Proposal content belongs
in the step's `complete_step.keyFindings`, visible in run results.

Team Builder and Team Optimizer do not infer input from conversation history.
The manual run API accepts input, for example:

```text
POST /api/instances/cp-system/flows/<builder-copy-id>/run
{"vars":{"brief":"Design a two-agent support triage team"}}

POST /api/instances/cp-system/flows/<optimizer-copy-id>/run
{"vars":{"targetSlug":"support-team"}}
```

These are execution examples, **not repair steps**. `cp_run_flow` currently accepts
only `slug` and `flowId`, without vars. Use the authenticated manual run API for
these inputs, or a reviewed copy whose prompts explicitly replace the variable
tags with the fixed brief or target.
Missing input is left as an unresolved template tag; the prompts instruct the
agent to report `partial` and stop. This is prompt guidance, not schema validation.

## Explicit upgrade procedure (operator approval required)

Perform this only as separately authorized installation work. Do not launch the
legacy flows to diagnose or repair them. Use the supported authenticated APIs or
dashboard; do not edit registry.db directly.

1. Read `GET /api/instances/cp-system/agents` and confirm the three required agents
   and their actual tool access. Export each affected definition using
   `GET /api/instances/cp-system/flows/<id>`, including its IDs, lifecycle, enabled
   state, steps, trigger, and recent runs. Export any separately configured cron
   or webhook triggers as well. Store this evidence securely.
2. Check for pending/running executions and coordinate with the operator before
   changing any activation or trigger settings. Preserve existing executions and
   history; do not cancel, replay or relabel them as part of this repair.
3. Compare each exported definition with the old shipped template from its
   installed release and the corrected `templates/system/cp-system.flows.json`.
   A matching name does not prove an unmodified built-in. Review custom prompts,
   dependencies, models, limits, briefing context and triggers individually.
4. Prepare four **new** definitions with unique names such as `Team Builder
   (repaired)`. Start from the corrected template, merge desired customizations
   deliberately, and set `enabled: false` and `trigger: {"type":"manual"}`.
   Submit `POST /api/instances/cp-system/flows` with only `name`, `description`,
   `steps`, `trigger` and `enabled`. The route creates a DRAFT. Do not send copied
   IDs, lifecycle, version or validation fields. Do not overwrite the originals.
   Do not copy legacy provisioning instructions back into proposal flows.
5. Read the copies back and compare every step. Confirm the originals, run IDs,
   histories and customizations are unchanged. Keep a table of old ID → new ID
   for review, and verify no cron/webhook trigger points at a copy. Repeated
   attempts must reuse an already reviewed copy, not create more duplicates.
6. Validate each copy with
   `POST /api/instances/cp-system/flows/<copy-id>/validate`. Review the returned
   report. Structural validation does not prove model behavior or a restorable
   backup. Test on isolated data with an approved provider only when separately
   authorized; do not run production workflows merely to complete the repair.
7. Present the final diff, retained customizations, input requirements and trigger
   mapping for approval. Only after approval, retire/disable the affected legacy
   definitions and their external triggers, and activate/enable the copies using
   the normal lifecycle controls. Do not copy cron schedules or webhook routing
   automatically. Update callers that store old flow IDs. Keep originals and
   histories for inspection; leave Health Check and Cost Audit alone.

Rollback: disable/pause the copies and revert callers/trigger routing using the
recorded mapping. Preserve the originals; do not reactivate a definition that
still references a removed agent. No database migration or service restart is
required merely to create or review the draft copies.

## Verification boundary

Regression tests check the shipped agents, scoped `cp_*` tools, DAG scheduling
and explicit-input interpolation on SQLite in memory. An isolated API test covers
draft-copy creation without changing the original definition or run history.
These checks do not exercise a real LLM or prove it follows prompt instructions.
