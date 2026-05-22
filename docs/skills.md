# Skills

> **Status**: SKILLS-002 — schema v44 + v45 (legacy migration).
> **Scope**: Per-instance structured skills, surfaced to agents at prompt time.

A **skill** is a reusable bundle of instructions (and optional referenced files) that an agent can use as
contextual knowledge. Each skill is anchored by a `SKILL.md` file carrying a YAML manifest plus a
free-form body. Skills are now first-class registry rows scoped to one instance, instead of loose files
under `~/.claw-pilot/skills/` or workspace `.opencode/skill/`.

At runtime, `SkillLoader` reads the skills attached to an agent from SQLite, hands them to the existing
TF-IDF ranker (`src/runtime/skill-ranker.ts`), and the top matches are injected into the system prompt
for the current turn. The cache is invalidated by `skill:*` bus events so UI edits propagate without a
restart.

---

## Manifest format

`SKILL.md` is the canonical entry point of a skill. It starts with a YAML frontmatter block, followed
by Markdown body — the body is the prompt-time payload.

```yaml
---
name: code-reviewer
description: Reviews TypeScript pull requests against the project style guide.
version: 1.2.0
tags: [review, typescript]
---

# Code reviewer

When asked to review code, follow these rules:

1. ...
```

| Field | Required | Notes |
|-------|----------|-------|
| `name` | yes | Stable identifier shown in the UI. Must be unique per instance. |
| `description` | no | One-line summary used by the ranker and surfaced in cards. |
| `version` | no | Free-form semver string. Useful when re-importing a skill. |
| `tags` | no | List of strings. Reserved for future filtering. |

Any additional key is preserved verbatim into `skills.config_json` so downstream consumers (custom
loaders, future Enterprise features) can store extra metadata without a schema change.

### Referenced files

A skill can ship more than just `SKILL.md`. Any file alongside it inside the ZIP / GitHub repo is stored
in `skill_files` (keyed by relative `path`) and made available to the loader. Hashes are kept so a
re-import is a no-op when content is byte-identical.

---

## Tutorial — your first skill in 60 seconds

1. Open an instance from the **Instances** screen.
2. Go to the **Settings** view, then click the **Skills** entry in the sidebar.
3. Click **Add Skill** (top-right of the cards grid).
4. The wizard opens on three tabs: **Blank**, **ZIP**, **GitHub**. Stay on **Blank**.
5. Type a name (e.g. `meeting-notes`) and click **Create**.
6. The skill detail page opens. Edit `SKILL.md` — write a manifest plus a short body.
7. Switch to the **Agents** sub-section of the detail page and toggle on the agents that should use
   this skill.
8. Done. On the next agent run, `SkillLoader` picks the skill up, the ranker scores it against the
   incoming user message, and the top-ranked snippet lands in the system prompt.

No restart, no file edits, no daemon kick.

---

## Architecture map

### Storage — `registry.db`

Three additive tables (introduced in schema **v44**, populated by the **v45** legacy migration):

| Table | Role |
|-------|------|
| `skills` | One row per skill (id, instance_slug, name, description, version, source, source_url, config_json, org_id). |
| `skill_files` | Files attached to a skill (path, content, hash). UNIQUE `(skill_id, path)`. |
| `agent_skills` | Many-to-many between agents and skills. Composite PK. |

See [`registry-db.md`](registry-db.md) for the full column listing.

### Ingest

Three sources, one normalized output (`StructuredSkill`):

| Source | Trigger | Notes |
|--------|---------|-------|
| `blank` | Wizard → Blank tab | Seeds a minimal `SKILL.md` with the chosen name. |
| `zip` | Wizard → ZIP tab or `POST /api/instances/:slug/skills/import` | ZIP must contain a `SKILL.md` at the root. |
| `github` | Wizard → GitHub tab | Cloned shallow, then ingested as ZIP. |

Ingest is centralized in `src/core/skills/_skill-ingest.ts` and shares per-file validation (1 MB cap per
file, see Limits below).

### Runtime

`SkillLoader` (`src/runtime/session/skill-loader.ts`) is instantiated once per
`ClawRuntime` in `engine.ts:start()` and disposed in `stop()`. It subscribes
to the instance bus and maintains an in-memory cache of `agent_skills`
assignments, invalidating per-agent on assignment events
(`agent_skill.assigned`/`agent_skill.unassigned`) or globally on skill
content events (`skill.*`, `skill.file.*`).

The loader is plumbed through every runtime entry point that builds an LLM
turn:

- `ChannelRouter` (`src/runtime/channel/router.ts`)
- `runPromptLoop` (`src/runtime/session/prompt-loop.ts`)
- `buildSystemPromptWithCache` (`src/runtime/session/_prompt-loop-handlers.ts`)
- `buildSkillsBlock` (`src/runtime/session/system-prompt.ts`)
- `Tool.Context.skillLoader` (`src/runtime/tool/tool.ts`)

At each turn, `buildSkillsBlock` calls `mergeSkillSources({ fromFilesystem,
fromDb })` (`src/runtime/session/skill-ranker.ts`) to combine:

- **Filesystem skills** discovered by `listAvailableSkills(workDir,
  agentConfig)` — honours the legacy `agentConfig.skills` whitelist.
- **DB skills** for the active agent via
  `skillLoader.getEntriesForAgent(agentId)` — inclusion governed by the
  `agent_skills` table.

DB skills win on name collisions. The merged list is rendered into the
`<available_skills>` XML block (name + description only). **Content is not
auto-injected** — the agent calls `skill(name)` (tool) when it decides to
use one. This keeps token cost predictable; agents see the catalog, load
on demand.

The `skill(name)` tool (`src/runtime/tool/built-in/skill.ts`) resolves DB
skills first via `ctx.skillLoader`. If the name matches a skill assigned
to the agent, the tool returns the `SKILL.md` content plus a
`<skill_files>` block listing other files in the skill. Otherwise the tool
falls back to the 4-level filesystem hierarchy.

### UI

| Component | Purpose |
|-----------|---------|
| `cp-skills-tab` | Skills section inside `cp-instance-settings` — cards grid + embedded detail panel + badge counter. |
| `cp-skill-wizard` | 3-tab modal (Blank / ZIP / GitHub) to create a skill. |
| `cp-skill-detail` | File tree + Markdown/YAML editor, agent toggles, Export ZIP, Delete. Rendered intra-tab when a card is clicked. |

---

## ZIP round-trip

Every skill has an **Export ZIP** button on its detail page. The archive contains `SKILL.md` plus all
referenced files at their original `path`, with hashes preserved. Re-importing the ZIP in another
instance produces a byte-identical skill (Task 11 E2E covers this round-trip).

This makes skills trivially shareable across machines and across CE/EE instances.

---

## Limits

| Constraint | Value | Source |
|------------|-------|--------|
| Max size per file inside a skill | 1 MB | `src/core/skills/_skill-ingest.ts` |
| Max ZIP upload size | 25 MB | `src/dashboard/routes/instances/skills.ts` |

Both limits are enforced at ingest time and surface as 4xx errors in the wizard.

---

## Legacy migration

Pre-SKILLS-002 deployments stored skills as loose files under:

- `~/.claw-pilot/skills/<name>/SKILL.md` — global, server-installed
- `<workspace>/.opencode/skill/<name>/...` — workspace-scoped, per-agent

Migration **v45** (`src/core/skills/_skill-migration.ts`) lifts these into the new tables on the first
boot of v0.85.0+. It is:

- **One-shot** — guarded by the schema_version row, runs once.
- **Idempotent** — re-running is a no-op (UNIQUE constraint on `(instance_slug, name)` + content hashes).
- **Non-destructive** — the legacy `agent_files` rows under `.opencode/skill/%` are left in place for
  rollback safety. A future cleanup task may purge them.

No operator action is needed — just upgrade.

---

## Related

- [Registry DB schema](registry-db.md) — `skills`, `skill_files`, `agent_skills` reference.
- [Instance settings screen](ux-screens/screen-instance-settings.md) — Skills tab UX.
- `src/runtime/skill-ranker.ts` — TF-IDF ranker (unchanged from legacy implementation).
