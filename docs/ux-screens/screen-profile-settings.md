# Screen — Profile Settings (`cp-profile-settings`)

> **Source**: `ui/src/components/profile-settings.ts`
> **Styles**: `ui/src/styles/profile-settings.styles.ts`
> **Route**: `#/profile`
> **Entry point**: 👤 button in header (top-right, before WS indicator)

User profile management page. Single source of truth for user preferences, LLM providers, model aliases, and custom instructions. Shares the same two-column sidebar + content layout as `cp-instance-settings`.

## Mockup

```
┌─ Header bar ──────────────────────────────────────────────────┐
│  ← Back   👤 Profile                        [Cancel]  [Save]  │
└───────────────────────────────────────────────────────────────┘
┌─ Layout ──────────────────────────────────────────────────────┐
│  ┌─ Sidebar ──┐  ┌─ Content (active section) ─────────────┐  │
│  │  General   │  │  ┌─ GENERAL ──────────────────────────┐ │  │
│  │  Providers │  │  │  Display name     Language          │ │  │
│  │  Models    │  │  │  Timezone          Comm. style      │ │  │
│  │  Instructions│ │  │  Avatar URL  [preview]             │ │  │
│  │  Import    │  │  │  Default model                      │ │  │
│  └────────────┘  │  └────────────────────────────────────┘ │  │
│                  └─────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

## Header Bar

Always visible. Background `--bg-surface`, bottom border.

| Element | Description |
|---|---|
| **← Back** | Gray outline, accent hover. Emit `navigate { view: "cluster" }` → return to Instances view. |
| **Title** | "👤 Profile" (`font-size: 16px`, `font-weight: 700`). |
| **[Cancel]** | Visible if `_hasChanges` (General or Instructions dirty). Resets dirty state. |
| **[Save]** | Visible if `_hasChanges`. Disabled if `_saving`. Calls `PATCH /api/profile`. |

## Sidebar

Navigation through 5 sections. Active item: `--accent-subtle` background, `--accent` color, `font-weight: 600`. Click → `_activeSection = section` (immediate content swap).

**Numeric badges** on sidebar items:

| Item | Badge | Condition |
|---|---|---|
| **Providers** | Accent numeric | `_providers.length > 0` |
| **Models** | Accent numeric | `_models.length > 0` |

## Section: General

2-column grid (`field-grid`).

| Field | Type | Dirty key | Notes |
|---|---|---|---|
| Display name | `<input type="text">` | `displayName` | Nullable |
| Language | `<select>` | `language` | Options: en, fr, de, es, it, pt |
| Timezone | `<input type="text">` | `timezone` | Freeform (e.g. "Europe/Paris") |
| Communication style | `<select>` | `communicationStyle` | Options: concise, detailed, technical |
| Avatar URL | `<input type="text">` + 32px circle preview | `avatarUrl` | Fallback: 👤 emoji |
| Default model | `<input type="text">` (mono) | `defaultModel` | Format: "provider/model" |

All changes tracked via `_dirty` map. Saved in batch via `PATCH /api/profile`.

## Section: Providers

List of provider cards + "Add provider" button. Each provider is managed individually (no batch save).

### Provider Card

```
┌─────────────────────────────────────────────────┐
│  anthropic   ANTHROPIC_API_KEY     [Change key] [Remove] │
│  ✓  ••••••••••3f9a                                       │
└─────────────────────────────────────────────────┘
```

| Element | Description |
|---|---|
| **Provider name** | `font-weight: 600`, `--text-primary` |
| **Env var** | Mono font, `--text-muted` |
| **Key status** | Green ✓ badge if `hasApiKey`, amber "Not set" if not |
| **Masked key** | Mono font, `--text-secondary` (e.g. `••••••••3f9a`) |
| **[Change key]** | Accent outline button. Opens inline password input + Save/Cancel. |
| **[Remove]** | Red outline button. Calls `DELETE /api/profile/providers/:id`. |

### Add Provider Form

Expanded below cards when "+" clicked. Accent-bordered container.

| Field | Type | Notes |
|---|---|---|
| Provider ID | `<select>` | Known providers dropdown (anthropic, openai, google, etc.) |
| Env variable | `<input>` (mono) | Auto-filled from known provider selection |
| API key | `<input type="password">` (mono) | Optional — can be set later |
| Base URL | `<input>` (mono) | Optional — required for Ollama |

**Actions**: Per-action calls (`PUT /api/profile/providers/:id` then `PATCH .../key` if key provided).

## Section: Models

Table of model aliases + "Add alias" button.

```
┌─────────────────────────────────────────────────┐
│  ALIAS     PROVIDER     MODEL            │
│  fast      anthropic    claude-haiku-3-5  [Remove] │
│  smart     anthropic    claude-sonnet-4-5 [Remove] │
└─────────────────────────────────────────────────┘
```

| Column | Font | Notes |
|---|---|---|
| Alias | Mono | Unique per user |
| Provider | Mono | e.g. "anthropic", "openai" |
| Model | Mono | e.g. "claude-haiku-3-5" |
| Remove | Red outline button | Removes alias, saves immediately |

**Add alias form**: same accent-bordered inline form as providers.

**Save semantics**: `PUT /api/profile/models` replaces ALL aliases. Add/remove operations rebuild the full list and send it.

## Section: Instructions

Full-width textarea for custom markdown instructions injected into every agent's system prompt.

| Element | Description |
|---|---|
| **Hint text** | "Markdown supported. Max 10,000 characters." (`--text-muted`, 11px) |
| **Textarea** | `min-height: 240px`, mono font, `--bg-base` background |
| **Character counter** | "N / 10 000 characters" — amber color when > 9000 |

Saved in batch with General section via `PATCH /api/profile`.

## Section: Import

Import providers, model aliases, and API keys from an existing instance.

```
┌─────────────────────────────────────────────────┐
│  Import providers, model aliases, and API keys   │
│  from an existing instance.                      │
│                                                  │
│  [ Select instance... ▾ ]  [Import]              │
│                                                  │
│  ✓ Import successful — 2 providers, 1 alias, 2 keys │
└─────────────────────────────────────────────────┘
```

| Element | Description |
|---|---|
| **Instance dropdown** | `<select>` populated from `GET /api/instances` |
| **[Import]** | Primary button. Disabled if no instance selected or importing. |
| **Result banner** | Green success banner with counts. Shown after successful import. |

**Action**: `POST /api/profile/import-providers/:slug`. After success, reloads providers, models, and profile.

## API Endpoints

| Method | Endpoint | Used by |
|---|---|---|
| `GET` | `/api/profile` | Load profile on mount |
| `PATCH` | `/api/profile` | Save General + Instructions |
| `GET` | `/api/profile/providers` | Load providers on mount |
| `PUT` | `/api/profile/providers/:id` | Add/update provider |
| `DELETE` | `/api/profile/providers/:id` | Remove provider |
| `PATCH` | `/api/profile/providers/:id/key` | Write API key |
| `GET` | `/api/profile/models` | Load model aliases on mount |
| `PUT` | `/api/profile/models` | Replace all aliases |
| `POST` | `/api/profile/import-providers/:slug` | Import from instance |

## i18n

All strings use `msg("...", { id: "profile-*" })` prefix. 47 keys across 6 locales.

## States

| State | Display |
|---|---|
| **Loading** | Centered spinner + "Loading profile..." |
| **Error** | Red `error-banner` with message |
| **Empty profile** | Fields show empty/default values. Profile auto-created on first save. |
| **Dirty** | Save/Cancel buttons appear in header. Changed fields get accent border. |
| **Saving** | Save button disabled, text changes to "Saving..." |
| **Toast** | Fixed bottom-right notification (success/warning/error), auto-hide 4s |
