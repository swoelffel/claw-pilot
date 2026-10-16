# Structured Skills

Reviewed against Community 0.84.13. A skill is an instance-scoped instruction bundle with a SKILL.md manifest and optional referenced files. It supplies knowledge/context; it does not itself grant access or act as an independent executable tool.

Use Instance Settings → Skills to create/import and assign a skill. Supported ingestion paths include a blank skill, ZIP and GitHub source. Review imported instructions and included files before assignment; do not include credentials. The manifest identifies the skill and describes when to use it.

The catalog uses skills, skill_files and agent_skills. Assigning a skill to an agent makes it eligible for runtime loading; SkillLoader and relevance ranking progressively expose applicable material. Assignment is not proof the model invoked it or followed it correctly. Content/assignment changes invalidate runtime caches through skill events.

Legacy filesystem skill handling remains a compatibility path, not the primary catalog workflow. Avoid direct edits to old .opencode directories or agents.skills JSON to simulate a current catalog assignment. Check the actual bindings in the supported settings/API.

After an approved change, verify assignment and a bounded intended use. Qualify a real provider conversation separately from a catalog/loader check. An assigned skill cannot override runtime tool permissions, secret controls or workflow governance.
