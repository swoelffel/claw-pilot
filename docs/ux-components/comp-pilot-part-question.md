# Question Part (`cp-pilot-part-question`)

> **Source**: `ui/src/components/pilot/parts/part-question.ts`

Interactive question card rendered when the LLM uses the `question` tool. Shows the question text with clickable option buttons or a free-text input field. Once answered, displays a "answered" badge.

## Mockup

```
┌─ question card ──────────────────────────────────────┐
│  ❓ Which database should we use?                    │
│                                                      │
│  [ PostgreSQL ]  [ SQLite ]  [ MongoDB ]             │
│                                                      │
│  — or type a custom answer: —                        │
│  ┌──────────────────────────────┐  [ Submit ]        │
│  │                              │                    │
│  └──────────────────────────────┘                    │
└──────────────────────────────────────────────────────┘

After answering:
┌─ question card ──────────────────────────────────────┐
│  ❓ Which database should we use?      ✓ Answered    │
│                                                      │
│  → SQLite                                            │
└──────────────────────────────────────────────────────┘
```

## Properties

| Property | Type | Description |
|---|---|---|
| `call` | `PilotPart` | The `tool_call` part (metadata: `{ toolCallId, toolName: "question", args: { question, options? } }`) |
| `result` | `PilotPart \| undefined` | The `tool_result` part (set when answered) |
| `slug` | `string` | Instance slug (for API call) |

## Interaction

1. User clicks an option button or submits free text
2. Component calls `answerQuestion(slug, questionId, answer)` → `POST /api/instances/:slug/runtime/questions/:id/answer`
3. The pending question in the runtime resolves, allowing the prompt loop to continue

## Telegram delivery

On Telegram, questions with options are sent as **inline keyboard buttons** (one per row). The callback format is `q:<questionId>:<encodedAnswer>`. Questions without options are sent as plain text (user replies via text message).
