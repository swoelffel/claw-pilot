# 05. UI Types + api.ts Update

meta:
  id: multi-provider-05
  feature: multi-provider
  priority: P1
  depends_on: [multi-provider-01]
  tags: [implementation]

---

## Objective

Add the `ProviderInfo` interface to `ui/src/types.ts`, replace `anthropicApiKey` with
`provider` + `apiKey` in `CreateInstanceRequest`, and add `fetchProviders()` to `ui/src/api.ts`.

---

## Files to modify

| File | Action |
|------|--------|
| `ui/src/types.ts` | Add `ProviderInfo`, update `CreateInstanceRequest` |
| `ui/src/api.ts` | Add `fetchProviders()`, update `createInstance()` import |

---

## Exact changes

### `ui/src/types.ts`

#### Add `ProviderInfo` interface (after `AgentDefinition`)

```ts
export interface ProviderInfo {
  id: string;
  label: string;
  requiresKey: boolean;
  isDefault?: boolean;
}

export interface ProvidersResponse {
  canReuseCredentials: boolean;
  sourceInstance: string | null;
  providers: ProviderInfo[];
  models: string[];
}
```

#### Update `CreateInstanceRequest`

Old:
```ts
export interface CreateInstanceRequest {
  slug: string;
  displayName: string;
  port: number;
  defaultModel: string;
  anthropicApiKey: string;
  agents: AgentDefinition[];
}
```

New:
```ts
export interface CreateInstanceRequest {
  slug: string;
  displayName: string;
  port: number;
  defaultModel: string;
  provider: string;
  apiKey: string;
  agents: AgentDefinition[];
}
```

### `ui/src/api.ts`

#### Update import line

Old:
```ts
import type { InstanceInfo, AgentInfo, CreateInstanceRequest } from "./types.js";
```

New:
```ts
import type { InstanceInfo, AgentInfo, CreateInstanceRequest, ProvidersResponse } from "./types.js";
```

#### Add `fetchProviders()` function (after `fetchNextPort`)

```ts
export async function fetchProviders(): Promise<ProvidersResponse> {
  return apiFetch<ProvidersResponse>("/providers");
}
```

No changes needed to `createInstance()` itself — it already serializes the full request object
via `JSON.stringify(data)`. The shape change in `CreateInstanceRequest` is sufficient.

---

## Deliverables

- `ProviderInfo` and `ProvidersResponse` exported from `ui/src/types.ts`
- `CreateInstanceRequest` has `provider: string` + `apiKey: string` (no `anthropicApiKey`)
- `fetchProviders()` exported from `ui/src/api.ts`
- No other UI files broken by the type change (task 06 will update `create-dialog.ts`)

---

## Acceptance criteria

- [ ] `ProviderInfo` is importable from `ui/src/types.ts`
- [ ] `ProvidersResponse` is importable from `ui/src/types.ts`
- [ ] `CreateInstanceRequest` no longer has `anthropicApiKey` field
- [ ] `CreateInstanceRequest` has `provider: string` and `apiKey: string`
- [ ] `fetchProviders()` is exported from `ui/src/api.ts` and returns `Promise<ProvidersResponse>`
- [ ] `pnpm typecheck` exits 0 (note: `create-dialog.ts` will have type errors until task 06 is done — acceptable during this task)

---

## Validation

```bash
cd src/claw-pilot
# Typecheck UI only (ignoring create-dialog errors until task 06):
pnpm exec tsc --noEmit --project ui/tsconfig.json 2>&1 | grep -v "create-dialog"
# Should show 0 errors outside of create-dialog.ts
```

---

## Notes

- `ProvidersResponse` mirrors the server-side response shape defined in task 03. Keep them
  in sync manually — there is no shared type package between backend and frontend in this project.
- The `apiFetch` helper in `api.ts` already handles auth headers and error throwing.
  `fetchProviders()` needs no special handling beyond calling `apiFetch`.
- `createInstance()` does not need to be modified — the generic `JSON.stringify(data)` call
  will automatically serialize the new `provider` + `apiKey` fields.
