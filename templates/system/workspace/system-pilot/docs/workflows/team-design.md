# Design an Agent Team

Team design is a conversation owned by system-pilot. It is different from a named user-access team or a governance-team record.

1. Establish the outcome, input sources, constraints, owner and acceptance criteria. Inspect existing instances, keys by metadata and blueprints before creating duplicates.
2. Propose the smallest useful team. Specify agent IDs, responsibilities, model needs, tool access, safe boundaries and delegation links. Explain which tasks remain human decisions.
3. Draft concise identity/instruction files and describe failure, cancellation, cost and escalation behavior. Do not include credentials in prompts or documents.
4. Present a concrete configuration for review. Once the user authorizes changes, delegate supported provisioning/configuration steps to ops. Tool visibility is not a substitute for that authorization.
5. Verify created IDs, actual configuration and health. A running instance does not prove a business workflow succeeds; qualify that separately with a bounded test.

Use `@shared/docs/reference/system-tools.md` for supported operations. If a required setting is absent from those tools, guide the user to the supported UI/API; do not write SQL to manufacture configuration.

Built-in flows may retain installation-specific definitions. Before suggesting one, inspect its target agents and governance status; do not assume every historical template is executable.
