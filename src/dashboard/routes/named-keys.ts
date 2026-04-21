// src/dashboard/routes/named-keys.ts
//
// CRUD routes for named API keys (encrypted at rest via AES-256-GCM).
// All routes require authentication (behind the /api/* auth middleware).

import type { Context, Hono } from "hono";
import { z } from "zod";
import { apiError } from "../route-deps.js";
import type { RouteDeps } from "../route-deps.js";
import { isCryptoAvailable } from "../../lib/crypto.js";
import { logger } from "../../lib/logger.js";
import { PROVIDER_CATALOG } from "../../lib/provider-catalog.js";
import { NamedKeyRepository } from "../../core/repositories/named-key-repository.js";
import { notifySystemStateChanged } from "./_system-state-notify.js";
import { permission } from "../middleware/permission.js";
import { ACTIONS } from "../middleware/permission-actions.js";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

// apiKey accepts empty strings — keyless providers (e.g. OpenCode Zen) have
// requiresKey=false in the catalog. The provider-level check below rejects
// empty apiKey for providers that require one.
const CreateNamedKeySchema = z.object({
  name: z.string().min(1).max(100),
  providerId: z.string().min(1),
  apiKey: z.string(),
  defaultModel: z.string().min(1),
  baseUrl: z.string().url().nullable().optional(),
});

const UpdateNamedKeySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  defaultModel: z.string().min(1).optional(),
  baseUrl: z.string().url().nullable().optional(),
  apiKey: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return true if the provider requires an API key according to the catalog. */
function providerRequiresKey(providerId: string): boolean {
  const entry = PROVIDER_CATALOG.find((p) => p.id === providerId);
  // Unknown providers default to requiring a key — safer fallback.
  return entry?.requiresKey ?? true;
}

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
// Handlers (extracted from registerNamedKeyRoutes to keep it under the 150-line
// function length cap)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleCreate(c: Context<any>, deps: RouteDeps, repo: NamedKeyRepository) {
  if (!isCryptoAvailable()) {
    return apiError(c, 503, "CRYPTO_UNAVAILABLE", "MASTER_ENCRYPTION_KEY is not configured");
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch (err) {
    logger.warn("[route:named-keys] JSON parse failed on create", { error: String(err) });
    return apiError(c, 400, "INVALID_BODY", "Invalid JSON body");
  }

  const parsed = CreateNamedKeySchema.safeParse(body);
  if (!parsed.success) return apiError(c, 400, "VALIDATION_ERROR", parsed.error.message);
  const data = parsed.data;

  if (providerRequiresKey(data.providerId) && data.apiKey.length === 0) {
    return apiError(
      c,
      400,
      "API_KEY_REQUIRED",
      `Provider "${data.providerId}" requires an API key`,
    );
  }

  try {
    const key = repo.create({
      name: data.name,
      providerId: data.providerId,
      apiKey: data.apiKey,
      defaultModel: data.defaultModel,
      baseUrl: data.baseUrl ?? null,
    });
    void deps.modelDiscovery.invalidateProvider(data.providerId);
    notifySystemStateChanged("named-key", "create");
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
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleUpdate(c: Context<any>, deps: RouteDeps, repo: NamedKeyRepository) {
  const idParam = c.req.param("id") ?? "";
  const id = parseInt(idParam, 10);
  if (isNaN(id)) return apiError(c, 400, "INVALID_ID", "Key id must be a number");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch (err) {
    logger.warn("[route:named-keys] JSON parse failed on update", { error: String(err) });
    return apiError(c, 400, "INVALID_BODY", "Invalid JSON body");
  }

  const parsed = UpdateNamedKeySchema.safeParse(body);
  if (!parsed.success) return apiError(c, 400, "VALIDATION_ERROR", parsed.error.message);

  const existing = repo.getById(id);
  if (!existing) return apiError(c, 404, "NOT_FOUND", `Named key ${id} not found`);

  const updateData = parsed.data;

  if (
    updateData.apiKey !== undefined &&
    updateData.apiKey.length === 0 &&
    providerRequiresKey(existing.providerId)
  ) {
    return apiError(
      c,
      400,
      "API_KEY_REQUIRED",
      `Provider "${existing.providerId}" requires an API key`,
    );
  }

  try {
    const key = repo.update(id, {
      ...(updateData.name !== undefined ? { name: updateData.name } : {}),
      ...(updateData.defaultModel !== undefined ? { defaultModel: updateData.defaultModel } : {}),
      ...(updateData.baseUrl !== undefined ? { baseUrl: updateData.baseUrl } : {}),
      ...(updateData.apiKey !== undefined ? { apiKey: updateData.apiKey } : {}),
    });
    if (updateData.apiKey !== undefined) {
      void deps.modelDiscovery.invalidateProvider(existing.providerId);
    }
    notifySystemStateChanged("named-key", "update");
    return c.json({ ok: true, key });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return apiError(c, 409, "DUPLICATE_NAME", `A named key with that name already exists`);
    }
    throw err;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleDelete(c: Context<any>, deps: RouteDeps, repo: NamedKeyRepository) {
  const idParam = c.req.param("id") ?? "";
  const id = parseInt(idParam, 10);
  if (isNaN(id)) return apiError(c, 400, "INVALID_ID", "Key id must be a number");

  const existing = repo.getById(id);
  if (!existing) return apiError(c, 404, "NOT_FOUND", `Named key ${id} not found`);

  try {
    repo.delete(id);
    void deps.modelDiscovery.invalidateProvider(existing.providerId);
    notifySystemStateChanged("named-key", "delete");
    return c.json({ ok: true });
  } catch (err) {
    if (isForeignKeyError(err)) {
      return apiError(c, 409, "KEY_IN_USE", "Named key is still assigned to one or more instances");
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerNamedKeyRoutes(app: Hono, deps: RouteDeps): void {
  const namedKeyRepo = new NamedKeyRepository(deps.db);

  // -------------------------------------------------------------------------
  // GET /api/named-keys — list all keys (masked)
  // -------------------------------------------------------------------------
  app.get(
    "/api/named-keys",
    permission({ action: ACTIONS.NAMED_KEY_READ, resource: { kind: "named-key" } }),
    (c) => {
      if (!isCryptoAvailable()) {
        return c.json({ keys: [], cryptoAvailable: false });
      }

      const keys = namedKeyRepo.listAll();
      return c.json({ keys, cryptoAvailable: true });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/named-keys — create a named key
  // -------------------------------------------------------------------------
  app.post(
    "/api/named-keys",
    permission({ action: ACTIONS.NAMED_KEY_CREATE, resource: { kind: "named-key" } }),
    (c) => handleCreate(c, deps, namedKeyRepo),
  );

  // -------------------------------------------------------------------------
  // PUT /api/named-keys/:id — update name, defaultModel, baseUrl, apiKey
  // -------------------------------------------------------------------------
  app.put(
    "/api/named-keys/:id",
    permission({
      action: ACTIONS.NAMED_KEY_UPDATE,
      resource: { kind: "named-key", id: (c) => c.req.param("id") },
    }),
    (c) => handleUpdate(c, deps, namedKeyRepo),
  );

  // -------------------------------------------------------------------------
  // DELETE /api/named-keys/:id — delete. 409 if still assigned to instances.
  // -------------------------------------------------------------------------
  app.delete(
    "/api/named-keys/:id",
    permission({
      action: ACTIONS.NAMED_KEY_DELETE,
      resource: { kind: "named-key", id: (c) => c.req.param("id") },
    }),
    (c) => handleDelete(c, deps, namedKeyRepo),
  );
}
