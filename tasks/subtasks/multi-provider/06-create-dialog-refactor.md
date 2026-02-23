# 06. create-dialog.ts Refactor

meta:
  id: multi-provider-06
  feature: multi-provider
  priority: P1
  depends_on: [multi-provider-03, multi-provider-05]
  tags: [implementation, ui]

---

## Objective

Replace the hardcoded "Anthropic API Key" section in `create-dialog.ts` with a dynamic
provider selector that fetches available providers from `GET /api/providers`, conditionally
shows an API key input, and submits `provider` + `apiKey` instead of `anthropicApiKey`.

---

## Files to modify

| File | Action |
|------|--------|
| `ui/src/components/create-dialog.ts` | Full refactor of provider/API key section |

---

## Exact changes

### 1. Update imports

Old:
```ts
import type { AgentDefinition, CreateInstanceRequest } from "../types.js";
import { fetchNextPort, createInstance } from "../api.js";
```

New:
```ts
import type { AgentDefinition, CreateInstanceRequest, ProviderInfo, ProvidersResponse } from "../types.js";
import { fetchNextPort, createInstance, fetchProviders } from "../api.js";
```

### 2. Remove hardcoded `MODELS` constant

Old (lines 6–10):
```ts
const MODELS = [
  { value: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6 (recommended)" },
  { value: "anthropic/claude-opus-4-6", label: "Claude Opus 4.6" },
  { value: "anthropic/claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
];
```

Remove entirely. Models will come from the API response.

### 3. Replace provider/API key state fields

Old state fields:
```ts
@state() private _model = "anthropic/claude-sonnet-4-6";
@state() private _apiKeyMode: "reuse" | "new" = "reuse";
@state() private _apiKey = "";
```

New state fields:
```ts
@state() private _model = "";
@state() private _providers: ProviderInfo[] = [];
@state() private _models: string[] = [];
@state() private _canReuseCredentials = false;
@state() private _providersLoading = true;
@state() private _providersError = "";
@state() private _selectedProvider: ProviderInfo | null = null;
@state() private _apiKey = "";
```

### 4. Load providers on mount

Update `connectedCallback()`:
```ts
override connectedCallback(): void {
  super.connectedCallback();
  this._loadNextPort();
  this._loadProviders();
}
```

Add `_loadProviders()` method:
```ts
private async _loadProviders(): Promise<void> {
  this._providersLoading = true;
  this._providersError = "";
  try {
    const data: ProvidersResponse = await fetchProviders();
    this._providers = data.providers;
    this._models = data.models;
    this._canReuseCredentials = data.canReuseCredentials;

    // Pre-select the default provider (first with isDefault, or first in list)
    const defaultProvider = data.providers.find((p) => p.isDefault) ?? data.providers[0] ?? null;
    this._selectedProvider = defaultProvider;

    // Pre-select the first model
    if (data.models.length > 0) {
      this._model = data.models[0]!;
    }
  } catch (err) {
    this._providersError = err instanceof Error ? err.message : "Could not load providers";
    // Fallback: show a minimal default so the form is not completely broken
    this._providers = [
      { id: "anthropic", label: "Anthropic", requiresKey: true },
    ];
    this._models = ["anthropic/claude-sonnet-4-6"];
    this._model = "anthropic/claude-sonnet-4-6";
    this._selectedProvider = this._providers[0]!;
  } finally {
    this._providersLoading = false;
  }
}
```

### 5. Update `_isFormValid()`

Old check:
```ts
if (this._apiKeyMode === "new" && !this._apiKey.trim()) return false;
```

New check:
```ts
if (!this._selectedProvider) return false;
if (this._selectedProvider.requiresKey && !this._apiKey.trim()) return false;
```

### 6. Update `_submit()`

Old:
```ts
const request: CreateInstanceRequest = {
  // ...
  anthropicApiKey: this._apiKeyMode === "reuse" ? "reuse" : this._apiKey.trim(),
  // ...
};
```

New:
```ts
const request: CreateInstanceRequest = {
  slug: this._slug,
  displayName: this._displayName || this._slug.charAt(0).toUpperCase() + this._slug.slice(1),
  port: this._port,
  defaultModel: this._model,
  provider: this._selectedProvider?.id ?? "anthropic",
  apiKey: this._selectedProvider?.requiresKey
    ? this._apiKey.trim()
    : "",
  agents: this._buildAgents(),
};
```

### 7. Replace the "Anthropic API Key" section in `_renderForm()`

Old section (lines 522–559):
```html
<!-- API Key -->
<div class="section">
  <div class="section-label">Anthropic API Key</div>
  <div class="radio-group">
    <label class="radio-option">
      <input type="radio" name="apikey" value="reuse" ... />
      Reuse from existing instance
    </label>
    <label class="radio-option">
      <input type="radio" name="apikey" value="new" ... />
      Enter new key
    </label>
  </div>
  ${this._apiKeyMode === "new" ? html`...` : html`...`}
</div>
```

New section:
```ts
private _renderProviderSection() {
  if (this._providersLoading) {
    return html`
      <div class="section">
        <div class="section-label">Provider</div>
        <span class="field-hint">Loading providers...</span>
      </div>
    `;
  }

  const selected = this._selectedProvider;

  return html`
    <div class="section">
      <div class="section-label">Provider</div>

      ${this._providersError
        ? html`<span class="field-error">${this._providersError}</span>`
        : ""}

      <div class="field">
        <label for="provider">AI Provider *</label>
        <select
          id="provider"
          @change=${(e: Event) => {
            const id = (e.target as HTMLSelectElement).value;
            this._selectedProvider = this._providers.find((p) => p.id === id) ?? null;
            this._apiKey = "";  // reset key when provider changes
          }}
        >
          ${this._providers.map((p) => html`
            <option value=${p.id} ?selected=${selected?.id === p.id}>${p.label}</option>
          `)}
        </select>
      </div>

      ${selected?.requiresKey
        ? html`
            <div class="field">
              <label for="api-key">API Key *</label>
              <input
                id="api-key"
                type="password"
                placeholder=${this._getApiKeyPlaceholder(selected.id)}
                .value=${this._apiKey}
                @input=${(e: Event) => { this._apiKey = (e.target as HTMLInputElement).value; }}
              />
              <span class="field-hint">Your ${selected.label} API key</span>
            </div>
          `
        : html`
            <span class="field-hint">
              ${selected?.id === "opencode"
                ? "Uses the OpenCode runtime — no API key required"
                : "Credentials will be reused from the existing instance"}
            </span>
          `}
    </div>
  `;
}

private _getApiKeyPlaceholder(providerId: string): string {
  const placeholders: Record<string, string> = {
    anthropic:  "sk-ant-...",
    openai:     "sk-...",
    openrouter: "sk-or-...",
    gemini:     "AIza...",
    mistral:    "...",
  };
  return placeholders[providerId] ?? "API key";
}
```

In `_renderForm()`, replace the old API Key section with:
```ts
${this._renderProviderSection()}
```

### 8. Update model selector

The model `<select>` currently uses the hardcoded `MODELS` array. Replace with dynamic list:

Old:
```ts
${MODELS.map((m) => html`
  <option value=${m.value} ?selected=${this._model === m.value}>${m.label}</option>
`)}
```

New:
```ts
${this._models.map((m) => html`
  <option value=${m} ?selected=${this._model === m}>${m}</option>
`)}
```

---

## Deliverables

- `create-dialog.ts` no longer references `anthropicApiKey`, `_apiKeyMode`, or the hardcoded `MODELS` array
- Provider dropdown populated from `GET /api/providers`
- API key input shown only when `selectedProvider.requiresKey === true`
- Model list populated from API response
- `_submit()` sends `{ provider, apiKey }` in the request
- Graceful fallback if `fetchProviders()` fails (hardcoded Anthropic entry)

---

## Acceptance criteria

- [ ] On dialog open: provider dropdown is populated (not empty)
- [ ] Default provider is pre-selected (the one with `isDefault: true` from API, or first)
- [ ] When provider with `requiresKey: true` is selected: API key input is visible
- [ ] When provider with `requiresKey: false` is selected: API key input is hidden
- [ ] Submitting with `requiresKey: true` provider and empty API key: form is invalid (Create button disabled)
- [ ] Submitting with `requiresKey: false` provider: form is valid without API key
- [ ] Model dropdown is populated from API response
- [ ] Submitted request body contains `provider` and `apiKey` (not `anthropicApiKey`)
- [ ] If `fetchProviders()` fails: dialog still renders with Anthropic fallback (no blank screen)
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm build:ui` exits 0

---

## Validation

```bash
cd src/claw-pilot
pnpm typecheck
pnpm build:ui

# Manual browser test:
# 1. Open dashboard → click "New Instance"
# 2. Verify provider dropdown appears
# 3. Select a provider with requiresKey=true → API key field appears
# 4. Select a provider with requiresKey=false → API key field disappears
# 5. Fill form and submit → check network tab for correct request body
```

---

## Notes

- The `_canReuseCredentials` state field is loaded but not directly used in the render logic —
  the "reuse" behavior is now encoded in the provider entries themselves (`requiresKey: false`
  on source-instance providers). Keep the field for potential future use (e.g. a tooltip).
- Provider entries from the source instance have `requiresKey: false` because the provisioner
  will handle the "reuse" logic server-side when `apiKey === ""`. The UI does not need to send
  `"reuse"` as a magic string anymore — an empty `apiKey` with a `requiresKey: false` provider
  is the new signal.
- The `_getApiKeyPlaceholder()` helper is a private method, not a state field. It does not
  need `@state()`.
- Lit's `?selected` binding on `<option>` elements requires the initial `.value` binding on
  `<select>` to also be set. Ensure the `<select>` has `.value=${this._selectedProvider?.id ?? ""}`
  or use the `?selected` approach consistently (the latter is already used in the existing code).
