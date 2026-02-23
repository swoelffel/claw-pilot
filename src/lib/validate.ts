// src/lib/validate.ts

/**
 * Parse a string as a positive integer.
 * Throws a descriptive error if the value is invalid.
 */
export function parsePositiveInt(value: string, name: string): number {
  const n = parseInt(value, 10);
  if (isNaN(n) || n < 1) {
    throw new Error(
      `Invalid value for ${name}: "${value}" (expected a positive integer)`,
    );
  }
  return n;
}
