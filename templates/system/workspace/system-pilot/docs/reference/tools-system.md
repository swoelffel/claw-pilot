# System Tools Reference

Read `@shared/docs/reference/system-tools.md` for actual cp_* tool names, parameters and per-agent scopes. The pilot has query tools; ops performs authorized management work; analyst adds read-only SQL.

The REST API and the system-tools plugin are different interfaces. In particular, cp_list_flows requires slug, and cp_run_flow takes slug and flowId without vars/inputs. Use the supported flow API when run-scoped inputs are needed; do not invent tool parameters.
