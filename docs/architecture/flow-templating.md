# Flow Templating

Flow templating lets a flow definition reference run-scoped variables and
upstream step outputs inside step prompts (and `briefing.extraContext`).
Placeholders use the `{{ ... }}` syntax and are resolved at briefing time,
just before the agent is dispatched.

## Sources

A step briefing's templating context is the union of three layers:

| Layer                | Key shape                              | Origin                                     |
| -------------------- | -------------------------------------- | ------------------------------------------ |
| Provider context     | `{{trigger.event}}`, `{{trigger.…}}`   | `flow-context-providers` extension point   |
| Run input vars       | `{{ticket_id}}` and `{{vars.ticket_id}}` | `POST /flows/:id/run` body `{ vars: {…} }` |
| Dep step outputs     | `{{<stepId>.summary}}` and `{{steps.<stepId>.summary}}` | SITREP of every `dependsOn` step that completed |

Top-level spread enables the documented short form (`{{ticket_id}}`,
`{{step-investigate.summary}}`). Namespaced forms (`{{vars.x}}`,
`{{steps.id.summary}}`) are always available and win in case of collision —
prefer them in flow templates that read flow-author-supplied keys.

## API

### `POST /api/instances/:slug/flows/:id/run`

Body (optional):

```json
{
  "vars": {
    "ticket_id": "T-42",
    "channel": "#ops"
  }
}
```

The route validates `vars` with Zod (`Record<string, unknown>` — JSON
values only) and forwards it through the internal runtime endpoint. The
serialized payload is persisted on `rt_flow_runs.input_vars_json` (migration
v43) and parsed back when each step builds its briefing.

A request without a body, or with an empty body, behaves exactly as before
the feature shipped — the new column is `NULL` and templating placeholders
resolve from provider context + dep step SITREPs only.

## Example

Flow with two steps:

```yaml
steps:
  - id: investigate
    agentId: triage-bot
    prompt: |
      Investigate ticket {{ticket_id}}. Pull stack traces from Sentry,
      cross-reference with recent deploys, summarize root cause.
  - id: notify
    agentId: notifier
    dependsOn: [investigate]
    prompt: |
      Post to {{channel}}: ticket {{ticket_id}} root cause is
      "{{investigate.summary}}". Key findings:
      {{investigate.keyFindings}}.
```

Triggered via:

```bash
curl -X POST /api/instances/ops/flows/7/run \
  -H 'Authorization: Bearer …' \
  -H 'Content-Type: application/json' \
  -d '{"vars": {"ticket_id": "T-42", "channel": "#ops"}}'
```

The first step's briefing receives the resolved `ticket_id`; the second
step also receives `investigate.summary` and `investigate.keyFindings`
extracted from the dep SITREP.

## Resolution rules

- Pattern: `{{ <segment>(.<segment>)* }}` — segments allow letters,
  digits, `_`, and `-` (kebab-case step ids).
- Whitespace inside braces is tolerated.
- Unknown paths are **preserved verbatim** in the rendered string — easier
  to debug than a silent empty rewrite. A future opt-in strict mode may
  raise an error instead.
- Arrays render comma-joined; primitives via `String(v)`. Objects render
  as `[object Object]` — expose primitive leaves in providers, or
  reference a specific field with a longer path.
- `null` / `undefined` leaves are treated as missing (placeholder kept).

## Scope (V1)

- Interpolation runs on `step.prompt` and `briefing.extraContext` only.
- Tool-call argument templating is **not** in scope. Schedule it as a V2
  follow-up.
- No type casts (`{{vars.x|int}}`), no conditionals, no per-flow vars
  schema validation. The Zod schema accepts any `JsonValue` for now —
  validate downstream in step prompts.

## Security

The route is admin-only (`flow.run` permission). Vars flow straight into
agent prompts — treat them as trusted operator input. Do **not** expose
the route to untrusted clients without an upstream sanitization layer.
