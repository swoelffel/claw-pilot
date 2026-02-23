// src/lib/shell.ts

/**
 * Escape a string for safe use as a single shell argument.
 * Wraps the value in single quotes and escapes any embedded single quotes.
 */
export function shellEscape(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}
