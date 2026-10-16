<!-- cspell:ignore HMAC -->

# Flow Triggers: Cron and Incoming Webhooks

Reviewed against Community 0.84.13. Open /instances/:slug/triggers for the instance that owns the flow. A trigger is a separate resource attached to a flow; it is not a replacement for the flow definition.

## Configure

1. Create a nonempty flow with agents that exist in that instance. Validate and activate it for unattended execution; see [Workflow governance](governance.md).
2. Select Cron or Webhook, then the target flow. Configure the name and kind-specific fields. Review concurrency and enabled state before saving.
3. For Cron, choose the schedule and timezone explicitly. Interpret daylight-saving behavior in that timezone rather than assuming the browser timezone is the scheduler timezone.
4. For Webhook, set a unique instance-scoped slug, initial shared secret, optional IP/CIDR restrictions and JSONPath input mapping; see [Incoming webhooks and revocation](webhooks.md).
5. Inspect run history and the linked flow result. Admission, execution and completion are different states.

Instance-scoped management endpoints start at /api/instances/:slug/triggers. These are authenticated, permission-checked APIs, not cp_* tools. Do not grant secret permissions to work around a management error.

## Execution and history

By default, a pending/running admission blocks concurrent firing of that trigger. Enable concurrency only when the flow's side effects permit it. Completion releases the reservation; a daemon transport error can leave an unconfirmed reservation because the daemon may already have accepted the request.

The cron scheduler rechecks configuration and unattended workflow eligibility when firing. A saved schedule or running instance is not a guarantee of successful execution. Review history for skips/failures and actual results.

Fire now tests the authenticated flow path directly. It does not validate an external emitter's HMAC, clock, replay key or payload transmission. Successful Fire now is not an end-to-end webhook test.

## Interrupted work

On daemon startup, interrupted linked trigger flows are marked failed without automatic replay. Unlinked pending admissions expire after five minutes. Inspect linked runs and possible side effects before a new event key/manual run; do not retry blindly.
