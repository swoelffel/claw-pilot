# Plugin API

> **Status**: hook H8 shipped in Community. Enterprise consumes the contract via `registerPlugin(enterprisePolicyPlugin)` — no core modification.
> **SDK entry point**: `src/runtime/plugin/types.ts` (`Plugin`, `PluginHooks`, `ToolCallContext`, `ToolCallDecision`).
> **Dispatcher**: `src/runtime/plugin/dispatcher.ts` (`dispatchToolBeforeCall`).

## Why this doc

H8 hardens the plugin API so Enterprise B2B can wire **policy-as-code**, **approval workflows**, and **DLP / args rewriting** on tool calls without patching `src/runtime/plugin/plugin.ts` or `src/runtime/session/tool-set-builder.ts` (both frozen paths — R3). Community ships the decision-aware contract; Enterprise registers a policy plugin against it.

## Hook catalogue

The `Plugin` factory receives a `PluginInput` and returns a `PluginHooks` object. All hooks are optional.

| Hook | Signature | Semantics |
|---|---|---|
| `agent.beforeStart` | `(ctx) => void \| Promise<void>` | Fire-and-forget — agent init observability |
| `agent.end` | `(ctx) => void \| Promise<void>` | Fire-and-forget — agent teardown, tokens + cost |
| `tool.beforeCall` | `(ctx) => void \| Promise<void> \| ToolCallDecision \| Promise<ToolCallDecision>` | **Decision-aware** (H8). See below. |
| `tool.afterCall` | `(ctx) => void \| Promise<void>` | Fire-and-forget — post-execution audit |
| `message.received` | `(ctx) => void \| Promise<void>` | Fire-and-forget — user/assistant message observed |
| `message.sending` | `(ctx) => void \| Promise<void>` | Fire-and-forget — assistant message about to be sent |
| `session.start` | `(ctx) => void \| Promise<void>` | Fire-and-forget |
| `session.end` | `(ctx) => void \| Promise<void>` | Fire-and-forget |
| `tools()` | `(ctx) => Tool.Info[] \| Promise<Tool.Info[]>` | Register additional tools (filtered by `toolProfile` / permissions) |
| `tool.definition` | `(tool, ctx) => Tool.Definition` | Transform a tool def (description, parameters) before registration |

### Fire-and-forget hooks

Triggered by `src/runtime/plugin/hooks.ts` via the generic `runHooks` engine. Plugins are invoked sequentially in registration order; **errors are caught and logged** (non-fatal — never block the caller). No return value observed.

### `tool.beforeCall` — decision-aware (H8)

Invoked sequentially by `dispatchToolBeforeCall` (see `src/runtime/plugin/dispatcher.ts`) **before** `def.execute()`. Each plugin may return one of:

```typescript
export type ToolCallDecision =
  | { action: "allow" }
  | { action: "deny"; reason: string }
  | { action: "modify-args"; newArgs: unknown }
  | { action: "require-approval"; approvalRequest: ApprovalRequest };

export interface ApprovalRequest {
  kind: string;                            // "slack" | "email" | "webhook" | …
  context: Record<string, unknown>;
  timeoutMs?: number;
}
```

**Backward compatibility (widening)** — a hook that returns `void` is treated as `{ action: "allow" }`; a hook that throws is treated as `{ action: "deny", reason: err.message }`. Existing plugins (`system-tools`, `workspace-knowledge`, any third-party that returns `void`) keep their semantics.

**Chain semantics** — the dispatcher folds decisions in order:

| Return | Behaviour |
|---|---|
| `undefined` / `{ action: "allow" }` | Continue with next plugin |
| `{ action: "deny" }` | Emit `tool.denied`, short-circuit, tool returns a formatted refusal to the LLM |
| `{ action: "modify-args", newArgs }` | Replace args, emit `tool.args_modified`, continue with next plugin (receives mutated args) |
| `{ action: "require-approval" }` | Emit `tool.approval_required`, short-circuit. Community returns a formatted "approval required" string to the LLM (no resolver). Enterprise provides the resolver. |
| `throw err` | Emit `tool.denied` with `err.message`, short-circuit |

### Audit events

Emitted to the H6 audit bus (`emitAudit` → `rt_audit_events`):

| Event | Payload |
|---|---|
| `tool.denied` | `{ agentId, tool, reason, argsHash, userId? }` |
| `tool.approval_required` | `{ agentId, tool, approvalKind, argsHash, userId? }` |
| `tool.args_modified` | `{ agentId, tool, argsHash, userId? }` |

`argsHash` is `hashArgs(args)` (SHA-256 of canonical JSON, see `src/core/audit/canonical.ts`). **No argument values are persisted** — only their hash — keeping the audit log schema-stable and free of PII.

### Caller-side behaviour

`src/runtime/session/tool-set-builder.ts` (`wireBuiltInTools.execute`) calls `dispatchToolBeforeCall` and inspects the decision:

- `allow` → `def.execute(effectiveArgs, callCtx)` runs as usual.
- `deny` → returns `Tool call "<name>" denied by policy: <reason>` as the tool output (the LLM observes the refusal).
- `require-approval` → returns `Tool call "<name>" requires approval (kind="…"). Community build does not resolve approvals.`.
- `modify-args` is transparent — the mutated args flow into `def.execute`, `tool.afterCall`, `handleWriteInvalidation`, and the `rt_parts` metadata.

The session is never crashed by a denial; the model sees the tool result and adapts.

## Enterprise example (stub)

```typescript
// enterprise/src/plugins/policy.ts
import type { Plugin, ToolCallDecision } from "claw-runtime/plugin";
import { evaluatePolicy, requiresApproval } from "./policy-engine.js";
import { scanForPii } from "./dlp.js";

const enterprisePolicyPlugin: Plugin = (input) => ({
  "tool.beforeCall": async (ctx): Promise<ToolCallDecision> => {
    // 1. Policy-as-code (OPA)
    const verdict = await evaluatePolicy({
      agentId: input.agentId,
      tool: ctx.toolName,
      args: ctx.args,
    });
    if (verdict.deny) return { action: "deny", reason: verdict.reason };

    // 2. DLP — rewrite PII before execution
    const scrubbed = scanForPii(ctx.args);
    if (scrubbed.modified) return { action: "modify-args", newArgs: scrubbed.value };

    // 3. Out-of-band approval for sensitive tools
    if (requiresApproval(ctx.toolName, ctx.args)) {
      return {
        action: "require-approval",
        approvalRequest: {
          kind: "slack",
          context: { channel: "#ops-approvals", policyId: verdict.policyId },
          timeoutMs: 300_000,
        },
      };
    }

    return { action: "allow" };
  },
});

export default enterprisePolicyPlugin;
```

Registered at Enterprise bootstrap:

```typescript
// enterprise/src/index.ts
import { registerPlugin } from "claw-runtime/plugin";
import enterprisePolicyPlugin from "./plugins/policy.js";

registerPlugin("enterprise-policy", enterprisePolicyPlugin);
```

## Discipline

- **R1** — no `isEnterprise` flag. Community registers no plugin that returns a non-allow decision.
- **R2** — no new DB tables; audit events go to `rt_audit_events` (H6).
- **R3** — `src/runtime/plugin/` and `src/runtime/session/tool-set-builder.ts` are frozen paths; H8 commits carry the `Extension-Point: plugin-api-hardening` trailer.
- **R4** — hook shipped in Community before any Enterprise consumer; Enterprise registers via `registerPlugin(…)` with zero core modification.
- **R5** — unaffected; plugins do not read secrets directly.

## Hors scope (explicit — future PRs on real need)

- Hardening `tool.afterCall` / `message.received` / `session.*` with decision returns.
- Concrete OPA/Cedar integration, Slack/email/webhook approval resolver, DLP scanner — Enterprise only.
- Policy DSL / UI to manage approvals — Enterprise.
