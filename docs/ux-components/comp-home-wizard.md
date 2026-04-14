# Component — Home Wizard (`cp-home-wizard`)

> **Source**: `ui/src/components/home-wizard.ts`
> **Used in**: Home Screen (`cp-home-screen`) — wizard state

First-run setup form. Collects AI provider, API key, model selection, and user profile (name, language, timezone). Replaced the chat-based wizard in v0.72.3.

## Mockup

```
┌─ Setup Form ──────────────────────────────────────────┐
│                                                        │
│  Welcome to ClawPilot                                  │
│                                                        │
│  AI Provider     [Anthropic          ▾]                │
│  API Key         [sk-ant-...                ]          │
│  Model           [claude-sonnet-4-5  ▾]                │
│                                                        │
│  ── Your Profile ──────────────────────                │
│  Display Name    [Stephane                  ]          │
│  Language        [Francais           ▾]                │
│  Timezone        [Europe/Paris       ▾]                │
│                                                        │
│                              [Get Started]             │
└───────────────────────────────────────────────────────┘
```

## Form Fields

| Field | Type | Notes |
|---|---|---|
| **Provider** | `<select>` | Populated from `GET /api/providers`. Shows provider name. |
| **API Key** | Text input | Required. Masked display. |
| **Model** | `<select>` | Populated after provider selection (static catalog + discovered models). |
| **Display Name** | Text input | Optional. |
| **Language** | `<select>` | 6 options (en, fr, de, es, it, pt). Auto-detected from `navigator.language`. |
| **Timezone** | `<select>` | 24 common timezones. Auto-detected from `Intl.DateTimeFormat`. |

## Submit Flow

1. Create named API key (`POST /api/named-keys`)
2. Patch user profile with name/language/timezone (`PATCH /api/profile`)
3. Auto-provision system instance (`POST /api/system-instance/provision`)
4. Emit `wizard-complete` event to parent

## Events

| Event | Direction | Description |
|---|---|---|
| `wizard-complete` | wizard → home-screen | Setup finished, keys exist |

## States

| State | Display |
|---|---|
| **Loading** | Spinner while fetching providers |
| **Form** | Main form with all fields |
| **Submitting** | Disabled form + spinner on button |
| **Error** | Error message below form |

## i18n

All strings use `msg("...", { id: "wizard.*" })` prefix. Localized in 6 languages.

---

*Since v0.70.0, form-based since v0.72.3*
