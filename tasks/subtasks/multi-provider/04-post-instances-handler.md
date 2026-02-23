# 04. POST /api/instances Handler Update

meta:
  id: multi-provider-04
  feature: multi-provider
  priority: P1
  depends_on: [multi-provider-01, multi-provider-02]
  tags: [implementation]

---

## Objective

Update the `POST /api/instances` handler in `server.ts` to accept `provider` + `apiKey` instead
of `anthropicApiKey`, build the updated `WizardAnswers`, and return 400 (not 500) for
credential-related errors.

---

## Files to modify

| File | Action |
|------|--------|
| `src/dashboard/server.ts` | Update POST /api/instances body validation + WizardAnswers construction + error handling |

---

## Exact changes

### 1. Replace body validation

Old:
```ts
const anthropicApiKey = body["anthropicApiKey"];
// ...
if (typeof anthropicApiKey !== "string" || !anthropicApiKey) {
  return c.json({ error: "anthropicApiKey is required (or 'reuse')" }, 400);
}
```

New:
```ts
const provider = body["provider"];
const apiKey   = body["apiKey"];

if (typeof provider !== "string" || !provider) {
  return c.json({ error: "provider is required" }, 400);
}
// apiKey may be empty string for opencode; just ensure it's a string
if (typeof apiKey !== "string") {
  return c.json({ error: "apiKey must be a string (use '' for providers that need no key)" }, 400);
}
```

### 2. Update `WizardAnswers` construction

Old:
```ts
const answers: WizardAnswers = {
  // ...
  anthropicApiKey,
  // ...
};
```

New:
```ts
const answers: WizardAnswers = {
  slug,
  displayName: typeof body["displayName"] === "string" && body["displayName"]
    ? body["displayName"]
    : slug.charAt(0).toUpperCase() + slug.slice(1),
  port,
  agents,
  defaultModel,
  provider,
  apiKey,
  telegram: { enabled: false },
  nginx:    { enabled: false },
  mem0:     { enabled: false },
};
```

### 3. Return 400 for credential errors (not 500)

The provisioner throws `ClawPilotError` with codes `NO_EXISTING_INSTANCE`, `ENV_READ_FAILED`,
and `API_KEY_READ_FAILED` for credential problems. These are client-fixable errors → 400.

Old catch block:
```ts
} catch (err) {
  const msg = err instanceof Error ? err.message : "Provisioning failed";
  return c.json({ error: msg }, 500);
}
```

New catch block:
```ts
} catch (err) {
  const msg = err instanceof Error ? err.message : "Provisioning failed";
  // Credential errors are client-fixable → 400
  if (err instanceof ClawPilotError && (
    err.code === "NO_EXISTING_INSTANCE" ||
    err.code === "ENV_READ_FAILED" ||
    err.code === "API_KEY_READ_FAILED"
  )) {
    return c.json({ error: msg }, 400);
  }
  return c.json({ error: msg }, 500);
}
```

Add `ClawPilotError` to the import from `../lib/errors.js`:
```ts
import { InstanceAlreadyExistsError, ClawPilotError } from "../lib/errors.js";
```
(Check if `ClawPilotError` is already imported — if not, add it.)

---

## Deliverables

- `POST /api/instances` no longer reads or validates `anthropicApiKey`
- `POST /api/instances` validates `provider` (required string) and `apiKey` (required string, may be empty)
- `WizardAnswers` is constructed with `provider` + `apiKey`
- Credential errors return HTTP 400
- All other provisioning errors still return HTTP 500

---

## Acceptance criteria

- [ ] `POST /api/instances` with `{ ..., provider: "anthropic", apiKey: "sk-ant-x" }` returns 201
- [ ] `POST /api/instances` with `{ ..., provider: "opencode", apiKey: "" }` returns 201
- [ ] `POST /api/instances` with `{ ..., provider: "anthropic", apiKey: "reuse" }` and no existing instances returns 400 (not 500)
- [ ] `POST /api/instances` with `{ ..., anthropicApiKey: "sk-ant-x" }` (old shape) returns 400 with "provider is required"
- [ ] `POST /api/instances` without `provider` field returns 400
- [ ] `pnpm typecheck` exits 0

---

## Validation

```bash
cd src/claw-pilot
pnpm typecheck

# Smoke test — missing provider:
curl -s -X POST http://localhost:PORT/api/instances \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"slug":"test","port":18800,"defaultModel":"anthropic/claude-sonnet-4-6","apiKey":"sk-x"}' \
  | jq .
# Expect: { "error": "provider is required" }

# Smoke test — old field name:
curl -s -X POST http://localhost:PORT/api/instances \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"slug":"test","port":18800,"defaultModel":"anthropic/claude-sonnet-4-6","anthropicApiKey":"sk-x"}' \
  | jq .
# Expect: { "error": "provider is required" }
```

---

## Notes

- `ClawPilotError` has a `code` property. Check `src/lib/errors.ts` to confirm the property
  name is `code` (not `errorCode` or similar) before writing the catch block.
- The `InstanceAlreadyExistsError` is a subclass of `ClawPilotError` with code
  `INSTANCE_ALREADY_EXISTS` — it should remain a 500 (or could be 409; out of scope here).
- Do not add Telegram/Nginx/mem0 fields to the POST body at this stage — they remain disabled
  by default in the web UI path.
