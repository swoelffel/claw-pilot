# Agent Workspaces and Shared Knowledge

Reviewed against Community 0.84.13. An instance uses workspaces/<agentId> for each agent and workspaces/shared for shared files. Identity/prompt inputs and curated documents serve different purposes.

SOUL.md, AGENTS.md, USER.md and conditional BOOTSTRAP.md supply prompt context according to prompt mode. HEARTBEAT.md supplies heartbeat instructions, not its schedule. BOOTSTRAP.md consumption depends on successful processing; do not infer it from an empty message counter alone. History and compaction summaries are separate from those files.

## Discover knowledge

ws_list_files lists the current agent's documents and instance-shared documents. ws_search_files searches those scopes using FTS5 with short excerpts. Identity files and memory files are excluded from these knowledge listings; documents are not all injected automatically into every prompt.

Use dir @shared/docs/reference for the shared operational map. Other agents' private docs are not automatically visible. The pilot's [Flow triggers](../flows/triggers.md) guide is an actual example of curated knowledge.

## Write boundaries

Actual workspace tools are ws_write_file and ws_delete_file, with shared write/delete tools when allowed. Scope none gives read-only discovery; own permits own workspace writes, own_shared adds shared writes, and system remains a reserved wider scope rather than a promise of unrestricted filesystem editing. Protected paths, allowed-path rules and quota still apply. Do not invent append/move tools.

Use the supported Memory/Files UI or authorized workspace tools so disk and registry contents agree. A direct filesystem edit can drift from DB-backed search and managed templates. Never store API keys or tokens as curated documentation.

## Managed template updates

cp-system synchronizes managed documents and its agent instructions when the template hash changes. It can overwrite a managed path. User-created files at a newly introduced path can collide; publication/activation preflight must compare proposed paths and previous template hashes with disk and DB. Preserve or resolve local edits explicitly before sync. This is an operator control, not an automatic conflict-resolution guarantee.

USER.md, memory files and non-managed user knowledge must be preserved. Do not move/delete them to make an upgrade pass. See `@shared/docs/reference/data-sources.md` for the distinction between workspace inputs and runtime evidence.
