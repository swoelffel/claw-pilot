// src/runtime/plugin/workspace-knowledge/_protected-paths.ts
//
// Hardcoded core protected paths that no agent may overwrite or delete via
// `ws_write_file` / `ws_delete_file`, regardless of scope or admin overrides.
//
// These are the identity files that govern an agent's behavior; allowing the
// agent to mutate them would let it self-modify its own prompt, defeating the
// purpose of the workspace-write scope. The list is intentionally small and
// is re-exported by FS-WRITE-001 so the same guarantees apply to absolute
// path writes.
//
// Custom protected paths (per-agent admin-managed globs) are stored in
// `agents.protected_paths_json` and layered on top of this list — they extend,
// they do not replace.

/** Workspace-relative globs that are ALWAYS refused, even with scope `system`. */
export const CORE_PROTECTED_GLOBS: readonly string[] = [
  "SOUL.md",
  "IDENTITY.md",
  "AGENTS.md",
] as const;
