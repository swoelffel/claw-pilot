# 03. GET /api/providers Endpoint

meta:
  id: multi-provider-03
  feature: multi-provider
  priority: P1
  depends_on: [multi-provider-01]
  tags: [implementation]

---

## Objective

Add a `GET /api/providers` endpoint to `server.ts` that returns the list of supported providers,
whether credentials can be reused from an existing instance, and the models available from that
instance's `openclaw.json`.

---

## Files to modify

| File | Action |
|------|--------|
| `src/dashboard/server.ts` | Add GET /api/providers route |
| `src/core/config-generator.ts` | (already done in task 01) — `PROVIDER_ENV_VARS` exported |

---

## Response shape

```ts
interface ProvidersResponse {
  canReuseCredentials: boolean;
  sourceInstance: string | null;   // slug of the instance used as source, or null
  providers: ProviderInfo[];
  models: string[];                // models from source instance, or DEFAULT_MODELS fallback
}

interface ProviderInfo {
  id: string;
  label: string;
  requiresKey: boolean;
  isDefault?: boolean;
}
```

## Default provider list (constant in server.ts)

```ts
const DEFAULT_PROVIDERS: ProviderInfo[] = [
  { id: "anthropic",   label: "Anthropic",            requiresKey: true  },
  { id: "openai",      label: "OpenAI",                requiresKey: true  },
  { id: "openrouter",  label: "OpenRouter",            requiresKey: true  },
  { id: "gemini",      label: "Google Gemini",         requiresKey: true  },
  { id: "mistral",     label: "Mistral",               requiresKey: true  },
];

const DEFAULT_MODELS: string[] = [
  "anthropic/claude-sonnet-4-6",
  "anthropic/claude-opus-4-6",
  "anthropic/claude-haiku-4-5-20251001",
];
```

---

## Exact changes

### Add the route in `server.ts` (after the `/api/next-port` route, before `/api/instances` POST)

```ts
// GET /api/providers — list available providers + detect reuse capability
app.get("/api/providers", async (c) => {
  const existing = registry.listInstances();
  let canReuseCredentials = false;
  let sourceInstance: string | null = null;
  let models: string[] = [...DEFAULT_MODELS];
  const providers: ProviderInfo[] = [];

  if (existing.length > 0) {
    const source = existing[0]!;
    sourceInstance = source.slug;

    // Try to read openclaw.json from the source instance to extract providers + models
    try {
      const raw = await conn.readFile(source.config_path);
      const cfg = JSON.parse(raw) as {
        models?: { providers?: Record<string, unknown> };
        agents?: { defaults?: { model?: string } };
      };

      // Extract provider IDs from the config
      const cfgProviders = Object.keys(cfg.models?.providers ?? {});
      if (cfgProviders.length > 0) {
        canReuseCredentials = true;

        // Put source-instance providers first (with "reuse" label)
        for (const pid of cfgProviders) {
          providers.push({
            id: pid,
            label: pid === "opencode"
              ? "OpenCode (via existing instance)"
              : `${pid.charAt(0).toUpperCase() + pid.slice(1)} (reuse from ${source.slug})`,
            requiresKey: false,   // reuse = no key entry needed
            isDefault: providers.length === 0,
          });
        }

        // Extract default model from source config
        const srcModel = cfg.agents?.defaults?.model;
        if (srcModel) {
          models = [srcModel, ...DEFAULT_MODELS.filter((m) => m !== srcModel)];
        }
      }
    } catch {
      // Non-fatal: source config unreadable → fall through to defaults
    }
  }

  // Always append the full default provider list (skip duplicates)
  const existingIds = new Set(providers.map((p) => p.id));
  for (const p of DEFAULT_PROVIDERS) {
    if (!existingIds.has(p.id)) {
      providers.push(p);
    }
  }

  return c.json({ canReuseCredentials, sourceInstance, providers, models });
});
```

### Add `ProviderInfo` type locally in `server.ts` (or import from a shared location)

Since `server.ts` is a backend file, define the interface inline at the top of the file
(near the other imports/interfaces):

```ts
interface ProviderInfo {
  id: string;
  label: string;
  requiresKey: boolean;
  isDefault?: boolean;
}
```

---

## Deliverables

- `GET /api/providers` route registered in `server.ts`
- `DEFAULT_PROVIDERS` and `DEFAULT_MODELS` constants defined in `server.ts`
- `ProviderInfo` interface defined in `server.ts`
- Route is protected by the existing auth middleware (`/api/*`)
- Response always includes at least the 5 default providers
- When an existing instance is found: source providers appear first with `requiresKey: false`

---

## Acceptance criteria

- [ ] `GET /api/providers` with valid Bearer token returns HTTP 200
- [ ] Response contains `providers` array with at least 5 entries
- [ ] Response contains `models` array with at least 1 entry
- [ ] When no instances exist: `canReuseCredentials === false`, `sourceInstance === null`
- [ ] When instances exist and `openclaw.json` is readable: `canReuseCredentials === true`, source providers appear first
- [ ] When `openclaw.json` is unreadable: endpoint still returns 200 with default list (no 500)
- [ ] `GET /api/providers` without token returns 401
- [ ] `pnpm typecheck` exits 0

---

## Validation

```bash
cd src/claw-pilot
pnpm typecheck

# Integration smoke test (requires running dashboard):
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:PORT/api/providers | jq .
# Expect: { canReuseCredentials: bool, providers: [...], models: [...] }
```

---

## Notes

- `conn.readFile()` is the SSH-aware reader. In the local (non-SSH) case it reads from the
  local filesystem. This is consistent with how other routes use `conn`.
- The `config_path` field on an instance record points to the `openclaw.json` file.
  Use `source.config_path` directly — do not reconstruct the path.
- The `isDefault: true` flag on the first provider is a UI hint for the create-dialog to
  pre-select that provider. Only the first provider in the list should have `isDefault: true`.
- Duplicate suppression (the `existingIds` Set) prevents showing e.g. "Anthropic (reuse)"
  AND "Anthropic" as two separate entries.
