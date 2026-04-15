// src/lib/workspace-path.ts
//
// Validation for relative paths inside an agent's workspace directory.
// Used by API routes (PUT/DELETE workspace files) and the recursive sync walker
// to reject path traversal and keep workspaces sandboxed to a safe extension set.

/** Extensions allowed for workspace files — text/config only, never executable. */
export const ALLOWED_WORKSPACE_EXTENSIONS = [
  ".md",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".csv",
  ".log",
] as const;

/** Directory names reserved — never traversed nor written to. */
const RESERVED_SEGMENT_NAMES = new Set([
  ".git",
  "node_modules",
  ".claude",
  ".DS_Store",
  ".svn",
  ".hg",
]);

/** Maximum total length of a workspace-relative path. */
const MAX_PATH_LENGTH = 255;

/** Maximum length of a single path segment (filename or directory name). */
const MAX_SEGMENT_LENGTH = 100;

/** Valid segment characters — letters, digits, dot, dash, underscore. */
const VALID_SEGMENT = /^[A-Za-z0-9._-]+$/;

export class InvalidWorkspacePathError extends Error {
  override readonly name = "InvalidWorkspacePathError";
  constructor(
    public readonly input: string,
    public readonly reason: string,
  ) {
    super(`Invalid workspace path "${input}": ${reason}`);
  }
}

/**
 * Validate and normalize a workspace-relative path.
 *
 * Accepted: `SOUL.md`, `memory/facts.md`, `notes/2026-01.md`
 * Rejected: absolute paths, `..` traversal, null bytes, reserved segments,
 *           non-whitelisted extensions, segment or total length overflow.
 *
 * Returns the normalized path (forward slashes, no leading slash, no trailing slash).
 *
 * @throws {InvalidWorkspacePathError}
 */
export function validateWorkspaceRelativePath(input: string): string {
  if (typeof input !== "string") {
    throw new InvalidWorkspacePathError(String(input), "not a string");
  }
  if (input.length === 0) {
    throw new InvalidWorkspacePathError(input, "empty path");
  }
  if (input.length > MAX_PATH_LENGTH) {
    throw new InvalidWorkspacePathError(input, `path exceeds ${MAX_PATH_LENGTH} characters`);
  }
  if (input.includes("\0")) {
    throw new InvalidWorkspacePathError(input, "contains null byte");
  }
  if (input.includes("\\")) {
    throw new InvalidWorkspacePathError(input, "backslash not allowed — use forward slash");
  }

  // Normalize slashes and strip leading/trailing slashes.
  const normalized = input
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  if (normalized.length === 0) {
    throw new InvalidWorkspacePathError(input, "path resolves to empty after normalization");
  }

  // Absolute paths (Unix or Windows drive) are forbidden.
  if (input.startsWith("/") || /^[A-Za-z]:/.test(input)) {
    throw new InvalidWorkspacePathError(input, "absolute path not allowed");
  }

  const segments = normalized.split("/");
  for (const segment of segments) {
    if (segment.length === 0) {
      throw new InvalidWorkspacePathError(input, "empty path segment");
    }
    if (segment.length > MAX_SEGMENT_LENGTH) {
      throw new InvalidWorkspacePathError(
        input,
        `segment "${segment}" exceeds ${MAX_SEGMENT_LENGTH} characters`,
      );
    }
    if (segment === "." || segment === "..") {
      throw new InvalidWorkspacePathError(input, "relative traversal not allowed");
    }
    if (RESERVED_SEGMENT_NAMES.has(segment)) {
      throw new InvalidWorkspacePathError(input, `reserved segment "${segment}"`);
    }
    if (!VALID_SEGMENT.test(segment)) {
      throw new InvalidWorkspacePathError(
        input,
        `segment "${segment}" contains invalid characters`,
      );
    }
  }

  // The last segment must have an allowed extension.
  const lastSegment = segments[segments.length - 1]!;
  const dotIdx = lastSegment.lastIndexOf(".");
  if (dotIdx <= 0) {
    throw new InvalidWorkspacePathError(input, "file must have an extension");
  }
  const ext = lastSegment.slice(dotIdx).toLowerCase();
  if (!(ALLOWED_WORKSPACE_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new InvalidWorkspacePathError(
      input,
      `extension "${ext}" not allowed (allowed: ${ALLOWED_WORKSPACE_EXTENSIONS.join(", ")})`,
    );
  }

  return normalized;
}

/**
 * Check whether a directory/file name should be ignored during recursive workspace scan.
 * Used by the sync walker to skip reserved dirs and hidden/OS cruft.
 */
export function isIgnoredWorkspaceSegment(name: string): boolean {
  if (RESERVED_SEGMENT_NAMES.has(name)) return true;
  // Ignore dotfiles other than known workspace files (which start with uppercase letters).
  if (name.startsWith(".")) return true;
  return false;
}

/**
 * Check whether a filename has an allowed text/config extension.
 * Used by the recursive walker to skip binaries without throwing.
 */
export function hasAllowedWorkspaceExtension(filename: string): boolean {
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx <= 0) return false;
  const ext = filename.slice(dotIdx).toLowerCase();
  return (ALLOWED_WORKSPACE_EXTENSIONS as readonly string[]).includes(ext);
}
