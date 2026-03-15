/**
 * runtime/__tests__/tool-normalize.test.ts
 *
 * Unit tests for normalizeForProvider() — schema normalization for LLM providers.
 *
 * Objective: verify that normalizeForProvider() returns schemas unchanged for
 * non-Gemini providers, and correctly flattens Zod wrappers (ZodOptional,
 * ZodUnion, ZodArray, ZodNullable, ZodDefault, ZodObject) for the "google"
 * provider so that the resulting JSON Schema contains no anyOf/oneOf.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zodSchema } from "ai";
import { normalizeForProvider } from "../tool/normalize.js";

// ---------------------------------------------------------------------------
// Helper: extract JSON Schema from a Zod type via zodSchema()
// ---------------------------------------------------------------------------

function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  // zodSchema() returns an object with a jsonSchema property
  const wrapped = zodSchema(schema);
  return (wrapped as unknown as { jsonSchema: Record<string, unknown> }).jsonSchema;
}

// ---------------------------------------------------------------------------
// Non-Gemini providers — schema must be returned unchanged (identity)
// ---------------------------------------------------------------------------

describe("normalizeForProvider() — non-Gemini providers", () => {
  /**
   * Objective: for providers other than "google", the schema must be returned
   * as-is (same reference), regardless of its complexity.
   * Positive test: anthropic + ZodUnion → same object reference returned.
   */
  it("[positive] returns the same schema reference for 'anthropic'", () => {
    // Arrange
    const schema = z.union([z.string(), z.number()]);

    // Act
    const result = normalizeForProvider(schema, "anthropic");

    // Assert: exact same reference — no transformation applied
    expect(result).toBe(schema);
  });

  /**
   * Objective: openai provider must also be left untouched.
   * Positive test: openai + ZodOptional → same object reference returned.
   */
  it("[positive] returns the same schema reference for 'openai'", () => {
    // Arrange
    const schema = z.string().optional();

    // Act
    const result = normalizeForProvider(schema, "openai");

    // Assert
    expect(result).toBe(schema);
  });

  /**
   * Objective: unknown/arbitrary provider IDs must not trigger normalization.
   * Negative test: "ollama" provider + ZodUnion → schema unchanged (still a ZodUnion).
   */
  it("[negative] does NOT flatten ZodUnion for 'ollama' provider", () => {
    // Arrange
    const schema = z.union([z.string(), z.number()]);

    // Act
    const result = normalizeForProvider(schema, "ollama");

    // Assert: still a ZodUnion (not replaced by z.string())
    expect(result).toBeInstanceOf(z.ZodUnion);
  });
});

// ---------------------------------------------------------------------------
// Primitives — returned unchanged even for google
// ---------------------------------------------------------------------------

describe("normalizeForProvider() — primitives for google", () => {
  /**
   * Objective: primitive schemas (string, number, boolean) have no wrappers to
   * flatten and must be returned as-is.
   * Positive test: z.string() → same reference.
   */
  it("[positive] z.string() is returned unchanged", () => {
    const schema = z.string();
    expect(normalizeForProvider(schema, "google")).toBe(schema);
  });

  it("[positive] z.number() is returned unchanged", () => {
    const schema = z.number();
    expect(normalizeForProvider(schema, "google")).toBe(schema);
  });

  it("[positive] z.boolean() is returned unchanged", () => {
    const schema = z.boolean();
    expect(normalizeForProvider(schema, "google")).toBe(schema);
  });
});

// ---------------------------------------------------------------------------
// ZodOptional — unwrap + re-optional
// ---------------------------------------------------------------------------

describe("normalizeForProvider() — ZodOptional for google", () => {
  /**
   * Objective: ZodOptional wrapping a ZodUnion must be flattened so the inner
   * ZodUnion is replaced by z.string(), and the optional wrapper is preserved.
   * Positive test: z.union([z.string(), z.number()]).optional() →
   *   result is ZodOptional wrapping ZodString (no anyOf in JSON Schema).
   */
  it("[positive] ZodOptional(ZodUnion) → ZodOptional(ZodString), no anyOf", () => {
    // Arrange
    const schema = z.union([z.string(), z.number()]).optional();

    // Act
    const result = normalizeForProvider(schema, "google");
    const json = toJsonSchema(result);

    // Assert: result is optional (ZodOptional) and inner is string
    expect(result).toBeInstanceOf(z.ZodOptional);
    // JSON Schema must not contain anyOf
    expect(JSON.stringify(json)).not.toContain("anyOf");
  });

  /**
   * Objective: ZodOptional wrapping a primitive must keep the optional wrapper
   * and the inner type unchanged.
   * Positive test: z.string().optional() → still ZodOptional(ZodString).
   */
  it("[positive] ZodOptional(ZodString) → still ZodOptional, inner is ZodString", () => {
    // Arrange
    const schema = z.string().optional();

    // Act
    const result = normalizeForProvider(schema, "google");

    // Assert
    expect(result).toBeInstanceOf(z.ZodOptional);
    const inner = (result as z.ZodOptional<z.ZodType>).unwrap();
    expect(inner).toBeInstanceOf(z.ZodString);
  });

  /**
   * Objective: ZodOptional must NOT be stripped — the field must remain optional.
   * Negative test: result must still be ZodOptional (not ZodString directly).
   */
  it("[negative] ZodOptional is NOT stripped — result remains optional", () => {
    // Arrange
    const schema = z.string().optional();

    // Act
    const result = normalizeForProvider(schema, "google");

    // Assert: still optional, not a bare ZodString
    expect(result).toBeInstanceOf(z.ZodOptional);
    expect(result).not.toBeInstanceOf(z.ZodString);
  });
});

// ---------------------------------------------------------------------------
// ZodUnion — replaced by z.string().optional()
// ---------------------------------------------------------------------------

describe("normalizeForProvider() — ZodUnion for google", () => {
  /**
   * Objective: ZodUnion generates anyOf in JSON Schema which Gemini rejects.
   * normalizeForProvider() must replace it with z.string().optional().
   * Positive test: z.union([z.string(), z.number()]) → result is ZodOptional(ZodString).
   */
  it("[positive] ZodUnion is replaced by ZodOptional(ZodString)", () => {
    // Arrange
    const schema = z.union([z.string(), z.number()]);

    // Act
    const result = normalizeForProvider(schema, "google");

    // Assert: replaced by optional string
    expect(result).toBeInstanceOf(z.ZodOptional);
    const inner = (result as z.ZodOptional<z.ZodType>).unwrap();
    expect(inner).toBeInstanceOf(z.ZodString);
  });

  /**
   * Objective: the JSON Schema produced from the normalized ZodUnion must not
   * contain anyOf (which Gemini cannot handle).
   * Negative test: JSON Schema of normalized ZodUnion must have no anyOf key.
   */
  it("[negative] normalized ZodUnion produces no anyOf in JSON Schema", () => {
    // Arrange
    const schema = z.union([z.string(), z.number(), z.boolean()]);

    // Act
    const result = normalizeForProvider(schema, "google");
    const json = toJsonSchema(result);

    // Assert: no anyOf anywhere in the schema
    expect(JSON.stringify(json)).not.toContain("anyOf");
  });
});

// ---------------------------------------------------------------------------
// ZodArray — recurse into element type
// ---------------------------------------------------------------------------

describe("normalizeForProvider() — ZodArray for google", () => {
  /**
   * Objective: ZodArray wrapping a ZodUnion element must recursively flatten
   * the element type so the array items have no anyOf.
   * Positive test: z.array(z.union([z.string(), z.number()])) →
   *   result is ZodArray with ZodOptional(ZodString) element.
   */
  it("[positive] ZodArray(ZodUnion) → ZodArray with flattened element", () => {
    // Arrange
    const schema = z.array(z.union([z.string(), z.number()]));

    // Act
    const result = normalizeForProvider(schema, "google");
    const json = toJsonSchema(result);

    // Assert: still an array, no anyOf in items
    expect(result).toBeInstanceOf(z.ZodArray);
    expect(JSON.stringify(json)).not.toContain("anyOf");
  });

  /**
   * Objective: ZodArray with a primitive element must be preserved as-is.
   * Positive test: z.array(z.string()) → ZodArray(ZodString), unchanged.
   */
  it("[positive] ZodArray(ZodString) element type is preserved", () => {
    // Arrange
    const schema = z.array(z.string());

    // Act
    const result = normalizeForProvider(schema, "google");

    // Assert: still ZodArray, element is ZodString
    expect(result).toBeInstanceOf(z.ZodArray);
    const element = (result as z.ZodArray<z.ZodType>).element;
    expect(element).toBeInstanceOf(z.ZodString);
  });

  /**
   * Objective: ZodArray must NOT be replaced by a non-array type.
   * Negative test: result must still be ZodArray (not ZodString or ZodOptional).
   */
  it("[negative] ZodArray is NOT replaced by a scalar type", () => {
    // Arrange
    const schema = z.array(z.union([z.string(), z.number()]));

    // Act
    const result = normalizeForProvider(schema, "google");

    // Assert: still an array
    expect(result).toBeInstanceOf(z.ZodArray);
    expect(result).not.toBeInstanceOf(z.ZodString);
    expect(result).not.toBeInstanceOf(z.ZodOptional);
  });
});

// ---------------------------------------------------------------------------
// ZodNullable — unwrap + make optional
// ---------------------------------------------------------------------------

describe("normalizeForProvider() — ZodNullable for google", () => {
  /**
   * Objective: ZodNullable generates anyOf with null in JSON Schema.
   * normalizeForProvider() must convert it to optional (no null type).
   * Positive test: z.string().nullable() → ZodOptional(ZodString).
   */
  it("[positive] ZodNullable(ZodString) → ZodOptional(ZodString)", () => {
    // Arrange
    const schema = z.string().nullable();

    // Act
    const result = normalizeForProvider(schema, "google");

    // Assert: optional, not nullable
    expect(result).toBeInstanceOf(z.ZodOptional);
    const inner = (result as z.ZodOptional<z.ZodType>).unwrap();
    expect(inner).toBeInstanceOf(z.ZodString);
  });

  /**
   * Objective: the JSON Schema of a normalized ZodNullable must not contain
   * null type references (which Gemini rejects).
   * Negative test: JSON Schema must not contain "null" type.
   */
  it("[negative] normalized ZodNullable produces no null type in JSON Schema", () => {
    // Arrange
    const schema = z.number().nullable();

    // Act
    const result = normalizeForProvider(schema, "google");
    const json = toJsonSchema(result);

    // Assert: no null type in schema
    expect(JSON.stringify(json)).not.toContain('"null"');
    expect(JSON.stringify(json)).not.toContain("anyOf");
  });
});

// ---------------------------------------------------------------------------
// ZodDefault — unwrap
// ---------------------------------------------------------------------------

describe("normalizeForProvider() — ZodDefault for google", () => {
  /**
   * Objective: ZodDefault wraps the inner type and can cause schema issues.
   * normalizeForProvider() must unwrap it to expose the inner type directly.
   * Positive test: z.string().default("hello") → ZodString (no ZodDefault wrapper).
   */
  it("[positive] ZodDefault(ZodString) → ZodString (default wrapper removed)", () => {
    // Arrange
    const schema = z.string().default("hello");

    // Act
    const result = normalizeForProvider(schema, "google");

    // Assert: ZodDefault is stripped, inner ZodString exposed
    expect(result).not.toBeInstanceOf(z.ZodDefault);
    expect(result).toBeInstanceOf(z.ZodString);
  });

  /**
   * Objective: ZodDefault must NOT be preserved after normalization for google.
   * Negative test: result must not be a ZodDefault instance.
   */
  it("[negative] ZodDefault is NOT preserved after normalization", () => {
    // Arrange
    const schema = z.number().default(42);

    // Act
    const result = normalizeForProvider(schema, "google");

    // Assert: no ZodDefault wrapper
    expect(result).not.toBeInstanceOf(z.ZodDefault);
  });
});

// ---------------------------------------------------------------------------
// ZodObject — recursive shape normalization
// ---------------------------------------------------------------------------

describe("normalizeForProvider() — ZodObject for google", () => {
  /**
   * Objective: ZodObject shape fields must be recursively normalized.
   * A field containing ZodUnion must be replaced by ZodOptional(ZodString).
   * Positive test: z.object({ name: z.string(), value: z.union([...]) }) →
   *   result is ZodObject with "value" field normalized.
   */
  it("[positive] ZodObject shape fields are recursively normalized", () => {
    // Arrange
    const schema = z.object({
      name: z.string(),
      value: z.union([z.string(), z.number()]),
    });

    // Act
    const result = normalizeForProvider(schema, "google");
    const json = toJsonSchema(result);

    // Assert: still an object, no anyOf in the schema
    expect(result).toBeInstanceOf(z.ZodObject);
    expect(JSON.stringify(json)).not.toContain("anyOf");
  });

  /**
   * Objective: ZodObject with nested ZodObject must be recursively normalized
   * at all levels.
   * Positive test: nested object with ZodUnion at depth 2 → no anyOf.
   */
  it("[positive] nested ZodObject is recursively normalized", () => {
    // Arrange
    const schema = z.object({
      outer: z.object({
        inner: z.union([z.string(), z.boolean()]),
      }),
    });

    // Act
    const result = normalizeForProvider(schema, "google");
    const json = toJsonSchema(result);

    // Assert: no anyOf at any depth
    expect(JSON.stringify(json)).not.toContain("anyOf");
  });

  /**
   * Objective: ZodObject fields without problematic wrappers must be preserved.
   * Negative test: a ZodObject with only primitives must still be a ZodObject
   * with the same field types after normalization.
   */
  it("[negative] ZodObject with only primitives is preserved as ZodObject", () => {
    // Arrange
    const schema = z.object({ x: z.string(), y: z.number() });

    // Act
    const result = normalizeForProvider(schema, "google");

    // Assert: still a ZodObject (not replaced by something else)
    expect(result).toBeInstanceOf(z.ZodObject);
    const shape = (result as z.ZodObject<Record<string, z.ZodType>>).shape;
    expect(shape["x"]).toBeInstanceOf(z.ZodString);
    expect(shape["y"]).toBeInstanceOf(z.ZodNumber);
  });
});
