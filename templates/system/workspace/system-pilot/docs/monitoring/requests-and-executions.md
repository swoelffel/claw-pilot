# Requests, Executions and Delivered Results

Reviewed against Community 0.84.13.

| Concept | Meaning |
|---|---|
| Request | Stable inbound identity, trace/parent lineage, source-scoped idempotency and durable result/delivery state |
| Execution | One accepted/running/terminal processing attempt; retries may create another attempt |
| Delivery | Whether a result reached or was acknowledged by the intended client |
| Business outcome | Whether a human considers the result useful/accepted; distinct from technical success |

Use /instances/:slug/requests and the authorized instance request/execution APIs. Filter by the actual instance, session, agent and source; identities cannot be reused across unrelated work. Do not copy someone else's request ID to resume a conversation.

## Inspect before repeating

1. Identify the request and session, then inspect attempts and persisted text/artifacts.
2. Distinguish a successful execution with undelivered output from failed/partial execution. A disconnected browser does not prove tools failed.
3. Recover delivery through its supported authorized endpoint when appropriate. This returns saved output; it does not rerun the original tools or automatically resend to an external channel.
4. Acknowledge only output actually received. Recovery or acknowledgment is not human business acceptance.

Read APIs: /api/instances/:slug/requests, /requests/:requestId and /executions. Acknowledgment and recover-delivery are POST actions under /api/instances/:slug/requests/:requestId and require their own permissions. Full execution-console access is different from the minimal session-scoped activity projection available to an authorized chat stream.

Persisted partial results retain diagnostics. Artifacts and final text should be checked directly rather than inferred from a green status badge. See [Recovery and timeouts](recovery-and-timeouts.md) before retrying an operation with side effects.
