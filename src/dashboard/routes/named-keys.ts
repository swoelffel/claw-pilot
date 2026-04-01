// src/dashboard/routes/named-keys.ts
//
// CRUD routes for named API keys (encrypted at rest via AES-256-GCM).
// All routes require authentication (behind the /api/* auth middleware).

import type { Hono } from "hono";
import { z } from "zod";
import { apiError } from "../route-deps.js";
import type { RouteDeps } from "../route-deps.js";
import { isCryptoAvailable } from "../../lib/crypto.js";
import { NamedKeyRepository } from "../../core/repositories/named-key-repository.js";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const CreateNamedKeySchema = z.object({
  name: z.string().min(1).max(100),
  providerId: z.string().min(1),
  apiKey: z.string().min(1),
  defaultModel: z.string().min(1),
  baseUrl: z.string().url().nullable().optional(),
});

const UpdateNamedKeySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  defaultModel: z.string().min(1).optional(),
  baseUrl: z.string().url().nullable().optional(),
  apiKey: z.string().min(1).optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return true if the SQLite error is a UNIQUE constraint violation. */
function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Error && err.message.toLowerCase().includes("unique constraint failed");
}

/** Return true if the SQLite error is a FK RESTRICT violation. */
function isForeignKeyError(err: unknown): boolean {
  return (
    err instanceof Error && err.message.toLowerCase().includes("foreign key constraint failed")
  );
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerNamedKeyRoutes(app: Hono, deps: RouteDeps): void {
  const namedKeyRepo = new NamedKeyRepository(deps.db);

  // -------------------------------------------------------------------------
  // GET /api/named-keys — list all keys (masked)
  // -------------------------------------------------------------------------
  app.get("/api/named-keys", (c) => {
    if (!isCryptoAvailable()) {
      return c.json({ keys: [], cryptoAvailable: false });
    }

    const keys = namedKeyRepo.listAll();
    return c.json({ keys, cryptoAvailable: true });
  });

  // -------------------------------------------------------------------------
  // POST /api/named-keys — create a named key
  // -------------------------------------------------------------------------
  app.post("/api/named-keys", async (c) => {
    if (!isCryptoAvailable()) {
      return apiError(c, 503, "CRYPTO_UNAVAILABLE", "MASTER_ENCRYPTION_KEY is not configured");
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return apiError(c, 400, "INVALID_BODY", "Invalid JSON body");
    }

    const parsed = CreateNamedKeySchema.safeParse(body);
    if (!parsed.success) {
      return apiError(c, 400, "VALIDATION_ERROR", parsed.error.message);
    }

    const data = parsed.data;

    try {
      const key = namedKeyRepo.create({
        name: data.name,
        providerId: data.providerId,
        apiKey: data.apiKey,
        defaultModel: data.defaultModel,
        baseUrl: data.baseUrl ?? null,
      });
      return c.json({ ok: true, key });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return apiError(
          c,
          409,
          "DUPLICATE_NAME",
          `A named key with name "${data.name}" already exists`,
        );
      }
      throw err;
    }
  });

  // -------------------------------------------------------------------------
  // PUT /api/named-keys/:id — update name, defaultModel, baseUrl, apiKey
  // -------------------------------------------------------------------------
  app.put("/api/named-keys/:id", async (c) => {
    const idParam = c.req.param("id");
    const id = parseInt(idParam, 10);
    if (isNaN(id)) {
      return apiError(c, 400, "INVALID_ID", "Key id must be a number");
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return apiError(c, 400, "INVALID_BODY", "Invalid JSON body");
    }

    const parsed = UpdateNamedKeySchema.safeParse(body);
    if (!parsed.success) {
      return apiError(c, 400, "VALIDATION_ERROR", parsed.error.message);
    }

    // Verify key exists before attempting update
    const existing = namedKeyRepo.getById(id);
    if (!existing) {
      return apiError(c, 404, "NOT_FOUND", `Named key ${id} not found`);
    }

    const updateData = parsed.data;

    try {
      const key = namedKeyRepo.update(id, {
        ...(updateData.name !== undefined ? { name: updateData.name } : {}),
        ...(updateData.defaultModel !== undefined ? { defaultModel: updateData.defaultModel } : {}),
        ...(updateData.baseUrl !== undefined ? { baseUrl: updateData.baseUrl } : {}),
        ...(updateData.apiKey !== undefined ? { apiKey: updateData.apiKey } : {}),
      });
      return c.json({ ok: true, key });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return apiError(c, 409, "DUPLICATE_NAME", `A named key with that name already exists`);
      }
      throw err;
    }
  });

  // -------------------------------------------------------------------------
  // DELETE /api/named-keys/:id — delete. 409 if still assigned to instances.
  // -------------------------------------------------------------------------
  app.delete("/api/named-keys/:id", (c) => {
    const idParam = c.req.param("id");
    const id = parseInt(idParam, 10);
    if (isNaN(id)) {
      return apiError(c, 400, "INVALID_ID", "Key id must be a number");
    }

    const existing = namedKeyRepo.getById(id);
    if (!existing) {
      return apiError(c, 404, "NOT_FOUND", `Named key ${id} not found`);
    }

    try {
      namedKeyRepo.delete(id);
      return c.json({ ok: true });
    } catch (err) {
      if (isForeignKeyError(err)) {
        return apiError(
          c,
          409,
          "KEY_IN_USE",
          "Named key is still assigned to one or more instances",
        );
      }
      throw err;
    }
  });
}
