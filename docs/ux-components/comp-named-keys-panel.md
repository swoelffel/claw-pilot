# Component — Named Keys Panel (`cp-named-keys-panel`)

> **Source**: `ui/src/components/named-keys-panel.ts`
> **Styles**: `ui/src/styles/named-keys-panel.styles.ts`
> **Used in**: Dashboard settings / admin area

Admin panel for managing AES-256-GCM encrypted named API keys. Supports CRUD operations with provider/model selection, inline editing, and delete confirmation.

## Mockup

```
┌─ Header ────────────────────────────────────────────────────────┐
│  API Keys                                          [+ New Key]  │
└─────────────────────────────────────────────────────────────────┘

  ⚠ Encryption is not available. Restart the dashboard...  (if no crypto)

┌─ Keys (3) ──────────────────────────────────────────────────────┐
│  NAME           PROVIDER    DEFAULT MODEL    API KEY     CREATED │
│  Production     anthropic   claude-sonnet... sk-...abc   Apr 01  │
│                                                    [Edit] [Del] │
│  Dev OpenAI     openai      gpt-4.1         sk-...xyz   Mar 20  │
│                                                    [Edit] [Del] │
│  Ollama Local   ollama      llama-4         (none)      Mar 15  │
│                                                    [Edit] [Del] │
└─────────────────────────────────────────────────────────────────┘
```

## Create Form

Shown when "+ New Key" is clicked. Inline form above the keys table.

| Field | Type | Description |
|---|---|---|
| **Name** | Text input | Human-readable key name (e.g., "Production Anthropic") |
| **Provider** | `<select>` dropdown | Populated from `GET /api/providers`. Shows provider labels. |
| **API Key** | Password input | The actual secret key (`sk-...`) |
| **Default Model** | `<select>` dropdown | Populated from selected provider's model list. |
| **Base URL** | Text input (optional) | Custom endpoint (e.g., Ollama, proxies). Field hint shown below. |

Actions: `[Cancel]` (ghost) + `[Create Key]` (primary, disabled until all required fields filled).

## Keys Table

| Column | Style | Description |
|---|---|---|
| **Name** | Bold | Human-readable name |
| **Provider** | Default | Provider ID (e.g., `anthropic`, `openai`) |
| **Default Model** | Mono | Model ID |
| **API Key** | Mono | Masked key (e.g., `sk-...abc`) |
| **Created** | Default | Locale-formatted date |
| **Actions** | Right-aligned | `[Edit]` + `[Delete]` buttons |

## Edit Mode

Clicking Edit replaces the row with an inline form spanning all 6 columns.

| Field | Type | Notes |
|---|---|---|
| **Name** | Text input | Editable |
| **Provider** | Disabled input | Cannot change provider after creation |
| **Default Model** | `<select>` | Populated from provider's model list |
| **Base URL** | Text input | Optional |
| **New API Key** | Password input (full width) | "Leave blank to keep current" |

Actions: `[Cancel]` (ghost) + `[Save]` (primary, disabled while saving or if name/model empty).

## Delete Confirmation

Modal overlay with backdrop (`rgba(0,0,0,0.6)`).

```
┌─ Delete named key ──────────────────────────────────────────┐
│  Are you sure you want to delete **Production**?             │
│  This action cannot be undone. If the key is assigned to     │
│  any instance, deletion will fail.                           │
│                                     [Cancel]  [Delete]       │
└──────────────────────────────────────────────────────────────┘
```

Delete button: `--state-error` background.

## Crypto Warning

If `cryptoAvailable === false`, shows a warning banner:
> Encryption is not available. Restart the dashboard to auto-generate the MASTER_ENCRYPTION_KEY, or set it manually in ~/.claw-pilot/.env.

## Toast Notifications

Success/error toasts appear for 4 seconds after create, update, or delete operations.

## Data Fetching

| Endpoint | Description |
|---|---|
| `GET /api/named-keys` | List all named keys (masked) + crypto availability |
| `POST /api/named-keys` | Create a new named key |
| `PUT /api/named-keys/:id` | Update name, model, baseUrl, optionally rotate API key |
| `DELETE /api/named-keys/:id` | Delete (fails if assigned to an instance) |
| `GET /api/providers` | List providers with model lists |

## Props

| Property | Type | Description |
|---|---|---|
| — | — | No props — standalone admin panel, fetches its own data. |

## States

| State | Display |
|---|---|
| **Loading** | Spinner + "Loading named keys..." |
| **Error** | Red error banner |
| **Empty** | "No named API keys configured yet." |
| **Loaded** | Header + optional create form + keys table |
