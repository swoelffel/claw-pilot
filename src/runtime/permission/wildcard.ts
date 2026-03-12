/**
 * runtime/permission/wildcard.ts
 *
 * Minimal glob-style wildcard matching for permission patterns.
 * Supports: * (any segment), ** (any path), ? (single char)
 */

/**
 * Match a string against a glob pattern.
 * - `*`  matches any sequence of characters except `/`
 * - `**` matches any sequence of characters including `/`
 * - `?`  matches any single character except `/`
 *
 * Examples:
 *   match("*.ts", "foo.ts")        → true
 *   match("src/**", "src/a/b.ts") → true
 *   match("bash", "bash")          → true
 *   match("*", "anything")         → true
 */
export function wildcardMatch(pattern: string, value: string): boolean {
  // Exact match shortcut
  if (pattern === value) return true;
  // Universal wildcard
  if (pattern === "*" || pattern === "**") return true;

  return matchSegments(pattern, value);
}

function matchSegments(pattern: string, value: string): boolean {
  // Convert glob pattern to regex
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex special chars (not * or ?)
    .replace(/\*\*/g, "§DOUBLESTAR§") // protect **
    .replace(/\*/g, "[^/]*") // * → match non-slash chars
    .replace(/\?/g, "[^/]") // ? → match single non-slash char
    .replace(/§DOUBLESTAR§/g, ".*"); // ** → match anything

  const regex = new RegExp(`^${escaped}$`, "i");
  return regex.test(value);
}
