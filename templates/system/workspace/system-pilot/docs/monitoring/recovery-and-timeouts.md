# Recovery, Expired Questions and Timeouts

Reviewed against Community 0.84.13. Recovery should preserve identity and avoid duplicate effects.

## After a disconnect or restart

The UI reconciles saved session messages, ordered durable replay events and terminal execution state without resubmitting the originating request. Explicit replay cursors request history; new subscriptions start live. Transient events are not durable, so absence from replay does not prove an action did not happen.

A stale question can be expired after a runtime restart. The supported answer path returns HTTP 410 for an orphaned question and the UI displays expiration. Reopen the current conversation and ask for a new prompt if required; repeatedly submitting an old answer will not restore its resolver.

## Side-effect recovery

Operations are classified read_only, idempotent or unsafe, with safe/uncertain/review-required outcomes. Automatic retry is restricted to failed_safely operations whose safety is not unsafe. Do not turn an uncertain write into an automatic retry. Inspect the external system or request administrator review before repeating it.

Delivery recovery retrieves saved results. It is different from execution recovery and from a new flow run or webhook event. Reusing the original event identity preserves deduplication; inventing a new one can perform the work again.

## Timeouts and cancellation

Runtime policy distinguishes provider connection, first token, chunk inactivity, tool, whole-agent and reconnection limits. Defaults are 30s, 60s, 120s, 120s, 300s and 30s respectively; inspect the effective configuration before diagnosing a particular request. Human waits suspend execution deadline accounting. A tool actually running is not an idle LLM chunk, while overall execution/tool deadlines and cancellation still apply.

Cancellation is recorded as cancellation, not automatically as a provider outage. Unix shell descendant cancellation has automated qualification; do not promise equivalent Windows process-tree behavior or cancellation of remote MCP operations. A cancellation response does not prove an external write was undone.

Use [Requests and executions](requests-and-executions.md) and [Resource health](resource-health.md) to distinguish timeout, authorization failure, quarantined resource and an already completed request whose delivery was interrupted.
