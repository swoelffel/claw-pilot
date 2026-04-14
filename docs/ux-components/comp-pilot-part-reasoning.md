# Component — Pilot Part: Reasoning (`cp-pilot-part-reasoning`)

> **Source**: `ui/src/components/pilot/parts/part-reasoning.ts`
> **Used in**: Runtime Pilot (`cp-runtime-pilot`), Home Chat (`cp-home-chat`)

Collapsible thinking trace card. Shows live reasoning token preview while streaming, then collapses to a toggle bar when finalized.

## Mockup

```
┌─ Reasoning (collapsed) ──────────────────────────────┐
│  ▸ Thinking...  (142 tokens)                         │
└──────────────────────────────────────────────────────┘

┌─ Reasoning (expanded) ───────────────────────────────┐
│  ▾ Thinking  (142 tokens)                            │
│                                                       │
│  Let me analyze the user's request. They want to     │
│  create a new agent with specific capabilities for   │
│  data processing. I should check if there's an       │
│  existing blueprint that matches...                   │
└──────────────────────────────────────────────────────┘

┌─ Reasoning (streaming) ──────────────────────────────┐
│  ● Thinking...                                        │
│  ...check if there's an existing blueprint tha▌      │
└──────────────────────────────────────────────────────┘
```

## Props

| Property | Type | Description |
|---|---|---|
| `text` | `string` | Full reasoning text |
| `streaming` | `boolean` | Whether reasoning is actively streaming |
| `tokenCount` | `number` | Token count (displayed in header) |

## Behavior

| State | Display |
|---|---|
| **Streaming** | Auto-expanded, pulsing dot, live token preview (last line, truncated 80 chars), auto-scroll |
| **Finalized, collapsed** | Toggle bar: `▸ Thinking... (N tokens)` |
| **Finalized, expanded** | Full reasoning text with monospace font |

## Styling

- Left border: 2px solid `--bg-border`
- Toggle: 11px `--text-muted`, hover `--text-secondary`
- Content: 12px mono, `--text-secondary`, padding 8px 10px
- Streaming dot: pulsing animation

## Filter interaction

The `thinking` filter controls visibility. While streaming (`state === "running"`), the filter is temporarily overridden to always show the card. Once finalized, the filter is respected.

---

*Since v0.71.0*
