/**
 * runtime/tool/normalize.ts
 *
 * Schema normalization for LLM providers that don't support all JSON Schema features.
 * Currently handles Gemini (google) which doesn't support anyOf/oneOf.
 */

import { z } from "zod";

/**
 * Normalize a Zod schema for a specific provider.
 * For Gemini (google): replaces ZodOptional and ZodUnion with permissive equivalents
 * to avoid anyOf/oneOf in the generated JSON Schema.
 */
export function normalizeForProvider(schema: z.ZodType, providerId: string): z.ZodType {
  if (providerId !== "google") return schema;
  return flattenForGemini(schema);
}

function flattenForGemini(schema: z.ZodType): z.ZodType {
  // ZodObject: recurse into shape
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodType>;
    const newShape: Record<string, z.ZodType> = {};
    for (const [key, value] of Object.entries(shape)) {
      newShape[key] = flattenForGemini(value);
    }
    return z.object(newShape);
  }

  // ZodOptional: unwrap and flatten inner, keep optional wrapper
  if (schema instanceof z.ZodOptional) {
    const inner = flattenForGemini(schema.unwrap() as z.ZodType);
    return inner.optional();
  }

  // ZodUnion / ZodDiscriminatedUnion: replace with z.string() (most permissive safe fallback)
  if (schema instanceof z.ZodUnion || schema instanceof z.ZodDiscriminatedUnion) {
    return z.string().optional();
  }

  // ZodArray: recurse into element type
  if (schema instanceof z.ZodArray) {
    return z.array(flattenForGemini(schema.element as z.ZodType));
  }

  // ZodNullable: unwrap and make optional
  if (schema instanceof z.ZodNullable) {
    return flattenForGemini(schema.unwrap() as z.ZodType).optional();
  }

  // ZodDefault: unwrap
  if (schema instanceof z.ZodDefault) {
    return flattenForGemini(schema.removeDefault() as z.ZodType);
  }

  // Primitives and others: return as-is
  return schema;
}
