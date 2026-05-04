# Design Rules

## 1. Fundamental rules — Never an "AI-generated look"

> **These prohibitions are absolute and non-negotiable.**

**FORBIDDEN:**
- Generic blue-purple gradients
- Cards with excessive `border-radius`
- Overly pronounced shadows
- Centered layouts without visual hierarchy
- The **Inter + Lucide** combo — instant markers of AI-generated UI

**REQUIRED:**
- Propose alternative fonts from Google Fonts:
  `Instrument Sans`, `Satoshi`, `General Sans`, `Plus Jakarta Sans`, `Manrope`, `Geist`
- Use distinctive icon libraries: **Phosphor Icons**, **Heroicons**, **Radix Icons** — not Lucide by default

---

## 2. Design System first

> **Before writing a single line of UI code, define and follow the DESIGN_SYSTEM.**

The design system covers: `colors`, `typography`, `spacing`, `radius`, `shadows`.

If a mood board, screenshot, or palette is provided:
- Extract dominant colors
- Adapt the design system accordingly

---

## 3. Mandatory visual hierarchy

For each page or component, systematically apply:

| Principle | Rule |
|---|---|
| **Typography contrast** | Minimum 3 different text sizes visible (heading, subheading, body) |
| **Intentional spacing** | More space = more importance. Primary sections > subsections |
| **Focal points** | Each section has ONE element that catches the eye first (CTA, heading, image) |
| **Vertical rhythm** | Alternate dense sections and airy sections |

---

## 4. Anti-patterns — What we NEVER do

- Buttons all the same size/color on the same page
- Centered text everywhere — **centering is reserved for hero sections and CTAs**
- Identical cards in a grid without size or prominence variation
- White text on light background, or light gray text on white background
- Sections without sufficient spacing between them
- **Gratuitous animations** (without UX intention)

---

## 5. Work process

| Context | Expected behavior |
|---|---|
| **Screenshot / wireframe** | Reproduce the layout faithfully before adding anything. Don't reinterpret. |
| **Mood board / reference** | Extract dominant palette, identify typography style, note contrast level. |
| **No reference** | Ask for an example or propose 2-3 different visual approaches. **Never code a "default" UI.** |

---

## 6. Technical stack — claw-pilot UI

| Area | Technology |
|---|---|
| Framework | **Lit** (web components) + TypeScript |
| Styling | **CSS custom properties** (design tokens in `ui/src/styles/tokens.ts`) |
| Components | Lit `LitElement` — no external component library |
| Animations | CSS transitions only (no external lib) |
| Icons | Emoji or inline SVG — no external icon library |
| Fonts | `Geist, -apple-system, BlinkMacSystemFont, sans-serif` (primary) · `Geist Mono, monospace` (code) |
| Theme | **Dark theme only** (`--bg-base: #0f1117`, `--bg-surface: #1a1d27`) |
| i18n | `@lit/localize` — 6 languages (fr, en, de, es, it, pt) |

---

## 7. UI code patterns — Lit

Always type properties with Lit decorators:

```typescript
@customElement("cp-my-component")
export class MyComponent extends LitElement {
  @property({ type: String }) variant: "primary" | "secondary" | "ghost" = "primary";
  @property({ type: String }) size: "sm" | "md" | "lg" = "md";
  @state() private _loading = false;

  static styles = [tokenStyles, css`
    :host { display: block; }
  `];

  override render() {
    return html`<button class="btn btn-${this.variant}">${msg("Label", { id: "my-label" })}</button>`;
  }
}
```

Use CSS design tokens (never hardcoded values):

```css
/* Correct */
color: var(--text-primary);
background: var(--bg-surface);
border: 1px solid var(--bg-border);

/* Forbidden */
color: #1a202c;
background: #ffffff;
```

---

## 8. Responsive Design & Accessibility

- **Mobile-first** — no horizontal scroll
- Touch targets: minimum **44×44 px**
- **WCAG AA** contrast
- `aria-label` on interactive elements
- `focus visible` on all focusable elements
- `alt` on all images

---

## 9. Delivery checklist

- [ ] Design system is respected
- [ ] Visual hierarchy is clear
- [ ] Responsive works on mobile
- [ ] Accessibility is ensured (contrast, aria, focus)
- [ ] Result **does not look like a generic template**
- [ ] All CSS values reference tokens declared in `ui/src/styles/tokens.ts` — no invented tokens
- [ ] New "create" flows reuse a primitive + pattern from sections 10 and 11 below
- [ ] i18n IDs follow the `<screen-or-component>-<role>` convention (section 12)

---

## 10. UI primitives

> **Source of truth for visual elements.** Every new component MUST cite a primitive
> by name (e.g. "primitive: cp-button.primary", "primitive: status-badge.running")
> rather than redefining its visuals. Tokens live in `ui/src/styles/tokens.ts`;
> shared primitive CSS lives in `ui/src/styles/shared.ts`.

### 10.1 Design tokens — closed set

The full token list is declared in `ui/src/styles/tokens.ts` (lines 7–68) and
must NOT be extended ad-hoc. Tokens currently available:

| Group | Tokens |
|---|---|
| Background | `--bg-base`, `--bg-surface`, `--bg-hover`, `--bg-border` |
| Accent | `--accent`, `--accent-hover`, `--accent-subtle`, `--accent-border` |
| Text | `--text-primary`, `--text-secondary`, `--text-muted` |
| State | `--state-running`, `--state-stopped`, `--state-error`, `--state-warning`, `--state-info` |
| Archetype | `--archetype-{planner,generator,evaluator,orchestrator,analyst,communicator}` |
| Type | `--font-ui`, `--font-mono` |
| Radius | `--radius-sm` (4), `--radius-md` (8), `--radius-lg` (12) |
| Spacing | `--space-1..8` (4, 8, 12, 16, 24, 32) |
| A11y | `--focus-ring` |

**Forbidden — does not exist anywhere in `tokens.ts`** (any match below is a bug):
`--surface`, `--surface-alt`, `--border`, `--state-success`, `--state-warn`,
`--accent-contrast`. Use the canonical equivalents:
`--bg-surface`, `--bg-hover`, `--bg-border`, `--state-running`, `--state-warning`, `#fff`.

### 10.2 Button

Reference: `ui/src/styles/shared.ts` lines 51–115 (`buttonStyles` shared block).
Reference usage: `ui/src/components/blueprints-view.ts` line 167
(`class="btn btn-primary"`).

| Variant | Class | Usage |
|---|---|---|
| Primary | `.btn.btn-primary` | One per row/header — main CTA |
| Ghost | `.btn.btn-ghost` | Cancel, secondary action |
| Danger | `.btn.btn-danger` | Destructive (delete confirm) |
| Start | `.btn.btn-start` | Lifecycle "start" only |
| Stop | `.btn.btn-stop` | Lifecycle "stop" only |

States — all variants:
- `:hover:not(:disabled)` raises contrast (`--accent-hover` for primary, border-color shift for ghost)
- `:disabled` → `opacity: 0.5; cursor: not-allowed;`
- `:focus-visible` → uses `--focus-ring` from `:host *:focus-visible` in tokens

A11y: `aria-label` required on icon-only variants; keyboard `Enter`/`Space` trigger
via native `<button>` element. Always `type="button"` unless inside a `<form>`.

**Forbidden**: `class="btn primary"` (space-separated modifier — does not match
`.btn-primary`). The hyphenated BEM form is mandatory.

**Outline variant** (used by `flow-list.ts` lines 322–334 as `.btn-new`): primary
foreground/border with transparent fill, hover swaps to `--accent-subtle`.
Acceptable as a per-screen variant when the header CTA must read "additive"
rather than "destructive-or-confirming"; use plain `.btn-primary` by default.

### 10.3 Text input / select / textarea

Reference: `ui/src/components/create-blueprint-dialog.ts` lines 71–94;
`ui/src/components/flow-editor.ts` lines 153–175.

Canonical rules:
- Background: `var(--bg-base)` (sunk into surface)
- Border: `1px solid var(--bg-border)` → focus → `border-color: var(--accent)`
- Radius: `var(--radius-md)` (8px) — never 4px
- Padding: `8px 12px` (text), `8px` (select)
- Font: `inherit` — never re-declare `font-family`
- Label: ALL CAPS, 12px, `var(--text-secondary)`, letter-spacing 0.05em,
  `margin-bottom: 6px`, **above** the field (never inline)
- Required marker: trailing ` *` in the label text

### 10.4 Checkbox / radio

Reference: `ui/src/components/triggers/cp-cron-picker.ts` lines 567–584
(radio for mode switch — accept as canonical for horizontal mode pickers).
Native inputs styled minimally; label text is the click target via
`<label>` wrap. No custom checkmark glyph at this stage.

### 10.5 Chip / tag (multi-select pill)

Reference: `ui/src/components/triggers/cp-cron-picker.ts` lines 206–226
(canonical implementation — declared the seed pattern for future chip needs).

```
padding: 4px 10px; border-radius: 14px;
background: var(--bg-hover); border: 1px solid var(--bg-border);
.active { background: var(--accent); color: #fff; border-color: var(--accent); }
```

Use case: multi-select where 2..N items are picked from a small bounded set
(weekdays, tags, filters). For status display, use `.badge` (10.10) not `.chip`.

### 10.6 Calendar grid (1..31 day-of-month picker)

Reference: `ui/src/components/triggers/cp-cron-picker.ts` lines 227–250.
Canonical "1..31 multi-select" picker — 7 columns × 5 rows, square cells,
`var(--radius-sm)`, active state mirrors chip active. Cells ≥29 carry a `.flag`
asterisk marker (color `--state-warning`) for "may skip in shorter months".

### 10.7 Step indicator (wizard progress)

Reference: `ui/src/components/triggers/cp-trigger-wizard.ts` lines 88–101.
Canonical convention: **flat bar dots**, `24×4px`, `var(--bg-border)` inactive,
`var(--accent)` active (cumulative — all preceding dots stay active).
Position: top of dialog, below title. No numbers.

Forbidden: numbered chips, progress bars with percentage fill, vertical step lists.

### 10.8 Modal / dialog

Reference: `ui/src/components/create-blueprint-dialog.ts` lines 30–48,
131–135 (action layout).

| Property | Value |
|---|---|
| Overlay | `position: fixed; inset: 0; background: rgba(0,0,0,0.6)` |
| Panel bg | `var(--bg-surface)` — **never** `var(--surface)` |
| Border | `1px solid var(--bg-border)` |
| Radius | `var(--radius-lg)` (12px) |
| Width | `480px` (small form), `640px` (flow editor / wizard step 3) |
| Padding | `28px` (form modal), `20px 24px` header / `24px` body / footer (split layout) |
| Z-index | `100` (form) / `500` (dialog with overlay), see existing usage |
| Backdrop click | Closes dialog if click target is overlay itself |
| Esc | Should close (TODO — not implemented uniformly) |

Action footer layout: `display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px;`
Order: **`[Cancel] [Primary]`** — Cancel left, Primary right (DOM order). For
multi-step wizards see pattern 11.2.

### 10.9 Drawer (right-side detail panel)

Reference: `ui/src/components/triggers/cp-trigger-detail.ts` lines 31–67
(width, header, tabs).

| Property | Value |
|---|---|
| Position | `position: fixed; top: 56px; right: 0; height: calc(100vh - 56px)` — sits **below** the global app navbar (height 56px) so the drawer header is never clipped behind it. Add `border-top: 1px solid var(--bg-border)` to visually separate from the navbar. |
| Width | `min(560px, 100vw)` (full content) — `360px` for embedded inline detail (task-board) |
| Background | `var(--bg-surface)` |
| Left border | `1px solid var(--bg-border)` |
| Z-index | `90` — below the navbar (which is at `100`) since the drawer is offset below it via `top: 56px`. Modals stay above at `≥500`. |
| Header | `padding: 16px; border-bottom: 1px solid var(--bg-border); display: flex; justify-content: space-between; align-items: center;` — title left, close button right |
| Close button | Top-right; `<button class="close-btn" aria-label="Close">✕</button>`. Glyph `✕` (U+2715), 20px font-size, `--state-stopped` color, hover `--text-primary`. Reference: `ui/src/components/create-agent-dialog.ts:609–616`. |
| Scroll | `overflow: auto` on host |

### 10.10 Status badge

Reference: `ui/src/styles/shared.ts` lines 3–48 (`badgeStyles` shared block).
**Canonical class**: `.badge.<state>` where state ∈ `{running, stopped, error, warning, unknown, starting, stopping}`.

```
padding: 3px 10px; border-radius: var(--radius-sm); font-size: 11px;
font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
```

Color matrix is locked to state tokens (`--state-running`, …) at 8% bg / 25%
border alpha. Optional leading `.state-dot` (6×6, currentColor) for active states.

Forbidden alternative: pill-shaped `.enabled-pill` in
`cp-trigger-list.ts` lines 54–66 (uses non-existent `--state-success`,
`--surface-alt`, and a 10px radius). See audit fix below.

### 10.11 Tabs

Reference: `ui/src/styles/agent-detail-panel.styles.ts` lines 155–195
(canonical underline tabs).

```
.tabs { display: flex; border-bottom: 1px solid var(--bg-border); }
.tab  { padding: 8px 14px; font-size: 11px; font-weight: 600;
        color: var(--text-muted); border-bottom: 2px solid transparent; }
.tab:hover  { color: var(--text-secondary); }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }
```

Forbidden: pill tabs, filled tabs, vertical tabs.

### 10.12 List row card

Reference: `ui/src/components/flow-list.ts` lines 357–391.

```
display: flex; align-items: center; gap: 16px; padding: 12px 16px;
background: var(--bg-surface); border: 1px solid var(--bg-border);
border-radius: var(--radius-md);
:hover { border-color: var(--accent-border); }
```

Action menu placement: inline trailing buttons (always visible) — kebab/overflow
menu is reserved for ≥4 actions on mobile. Each action is a `.btn-action`
(`flow-list.ts` lines 513–558) — small (`4px 10px`), state-tinted border
(run = `--state-running`, edit = `--accent`, delete = `--state-error`).

### 10.13 Toggle switch

Reference: `ui/src/components/flow-list.ts` lines 467–505 — `.toggle-switch`,
36×20 with sliding knob. Use this for boolean state on a list row (Enabled/Disabled).
Do NOT use a "ON/OFF pill" with text — that is a label, not a control.

---

## 11. UI patterns

### 11.1 List + Create

When to use: top-level screen showing N entities of one type with a single
"new" affordance.

Layout: `.section-header` flex row (`justify-content: space-between`),
left = count or title (`.section-title` from shared), right = primary CTA
(`.btn.btn-primary` labelled `+ New <Entity>`). Below: grid (cards) or
flat list (rows). Empty state: centred block with emoji icon, headline,
1-line hint, `padding: 60px 20px`, `color: var(--text-muted)`.

Reference: `ui/src/components/blueprints-view.ts` lines 156–198,
`ui/src/components/agent-templates-view.ts` lines 373–396.

Anti-pattern: header `<h1>` instead of `.section-title`; `<p>No items.</p>`
empty state without icon/hint/CTA.

### 11.2 Multi-step wizard (modal)

When to use: creating an entity that requires ≥3 distinct decision groups
(e.g. trigger: kind → flow → schedule).
When NOT to use: ≤2 groups → use a single-form dialog (11.3).

Layout: modal panel (10.8, width 600px), title `<h2>` (18px), step indicator
(10.7), body switches per step. Footer: `display: flex; justify-content: space-between;`
with **Cancel left** and a right-cluster `[Back] [Next | Create]`. Back hidden on
step 1; Next replaced by Create on the last step. Both Next and Create are
`.btn.btn-primary`; Back and Cancel are `.btn.btn-ghost`.

Validation: each step gates `Next` via a `_canAdvance()` predicate; `Create`
button disabled while `_saving || !validForm`. Errors shown in an
`.error-banner` between title and body (never inline next to button).

Reference (current, not yet aligned — see audit): `cp-trigger-wizard.ts`.

### 11.3 Single-form dialog

When to use: 1 form, ≤6 fields. Reference: `create-blueprint-dialog.ts`.
Layout: `.dialog` (10.8), title `<h2 class="dialog-title">`, sequence of
`.form-group` (label + input), `.dialog-actions` footer
(flex-end, `[Cancel] [Create]`).

### 11.4 Detail drawer with tabs

When to use: viewing/editing one entity of a list, without leaving the screen.
Layout: drawer (10.9) → header (title left, Close right) → tabs (10.11) → body.
Tabs only when ≥2 distinct concerns (settings + history + test). For a
flat detail (≤6 fields, one action), skip tabs.

### 11.5 Confirmation dialog

When to use: destructive irreversible action (delete).
Layout: small modal (`width: 400px`), single sentence, footer `[Cancel] [Delete]`
where Delete is `.btn.btn-danger`. **Focus on Cancel**, not Delete (a11y safety).
Currently most code uses `window.confirm()` — acceptable for v1, but new code
should prefer a dedicated component.

### 11.6 Settings panel (sidebar + main)

Reference: `ui/src/styles/instance-settings.styles.ts` (existing layout).
Sidebar list (left, 220px), content (right, fluid). Active row uses
`background: var(--accent-subtle); color: var(--accent)`.

---

## 12. i18n ID convention

Format: `<scope>-<role>` where:
- `<scope>` = component prefix (e.g. `flow-list`, `task-board`, `bp` for blueprints,
  `cbd` for create-blueprint-dialog, `atv` for agent-templates-view, `trigger-page`,
  `trigger-list`, `trigger-wiz`, `trigger-detail`, `cron-picker`)
- `<role>` = short-noun describing what the string is for (`title`, `empty`,
  `btn-create`, `btn-cancel`, `placeholder`, `loading`, `error`)

Examples already in use: `flow-list-empty`, `task-board-new`, `bp-empty-hint`,
`trigger-wiz-create`, `cron-picker-mode-interval`.

Rules:
- Lowercase kebab-case, no spaces.
- Stable across UI refactors — DO NOT rename IDs casually (breaks all
  translations).
- New IDs added MUST appear in the localization extraction (`pnpm extract`
  if applicable).

---

## 13. Audit 2026-05-03 — Triggers vs reference screens

Doc-only audit comparing `ui/src/components/triggers/*` (shipped in PRs #172,
#174, #178) against the conventions documented above. The next PR
`feature/triggers-wizard-align` will work this matrix into code.

### Severity legend
- **B** = breaking (visual regression — CSS references undefined tokens, rule
  silently no-ops, fallback to UA defaults).
- **A** = alignment (works, but drifts from canonical primitive/pattern).
- **i18n** = ID convention drift.

### Drift matrix

| # | Dimension | Reference (do this) | Triggers (does this) | Fix | Sev |
|---|---|---|---|---|---|
| 1 | Design tokens | `--bg-surface`, `--bg-border`, `--bg-hover`, `--state-running` | `--surface`, `--border`, `--surface-alt`, `--state-success`, `--accent-contrast` (none defined) | Replace token names in `cp-triggers-view.ts`, `cp-trigger-list.ts`, `cp-trigger-wizard.ts`, `cp-trigger-detail.ts`, `cp-cron-picker.ts`, `cp-input-mapping-editor.ts` | **B** |
| 2 | "New X" button | `class="btn btn-primary"` (`blueprints-view.ts:167`) | `class="btn primary"` (`cp-triggers-view.ts:90`) — modifier doesn't match `buttonStyles` | Use `btn btn-primary` (hyphen) | **B** |
| 3 | Wizard buttons | Same — `btn btn-primary` / `btn btn-ghost` | `class="btn primary"` / `class="btn"` (`cp-trigger-wizard.ts:462,467,472,481`) | Use `btn-primary` / `btn-ghost` | **B** |
| 4 | List buttons | Same | `class="btn"` x4 actions in `cp-trigger-list.ts:122–139` — no styled class matches | Apply `.btn-action` pattern from `flow-list.ts:513–558`, with run=accent, fire=running, delete=danger | **B** |
| 5 | Header padding | `padding: var(--space-6)` (24px) on flow-list | `padding: 16px` on `cp-triggers-view.ts:28` | Switch to `var(--space-6)` for top-level screen | A |
| 6 | Header title | 20px, `<div class="title">` | 22px, `<h1>` (`cp-triggers-view.ts:37–40,89`) | Use `.section-title` + count pattern (11.1) — keep `<h1>` for a11y but style as 20px | A |
| 7 | Empty state | Block with icon, headline, hint (60px padding) | `<p>No triggers yet.</p>` (`cp-trigger-list.ts:100`) | Add `.empty` div, emoji icon, hint, optional CTA | A |
| 8 | List row | Card surface (`--bg-surface` + border + radius, hover border-accent) | Bare grid row, only `border-bottom`, hover `background: var(--surface-alt)` (broken token) | Adopt `.flow-row` style from `flow-list.ts:357–391` | **B** + A |
| 9 | Enabled affordance | `.toggle-switch` slider (canonical) | `.enabled-pill` text label "ON/OFF" (read-only-looking) + separate Disable/Enable button | Replace with toggle-switch primitive (10.13); drop the redundant action button | A |
| 10 | Action menu | Inline tinted state buttons — Logs/Run/Edit/Delete | 4 identical bare `.btn` buttons — Disable/Fire/Detail/Delete (no danger color, no kebab on mobile) | Apply `.btn-action` matrix (10.12); Delete = `--state-error` border | A |
| 11 | Step indicator | (canonical defined here, 10.7) | OK — already 24×4 dots, accept as seed | — | ✓ |
| 12 | Tabs (detail) | Underline, 8×14, 11px, accent border-bottom | `padding: 8px 12px; font-size: 13px;` — close but font-size too large | Match agent-detail-panel tab style (10.11) | A |
| 13 | Drawer header | Title left, ghost Close right, 16px padding | OK in `cp-trigger-detail.ts:45–51` | — | ✓ |
| 14 | Drawer width | 560px or 360px embedded | 560px in trigger-detail | — | ✓ |
| 15 | Modal panel bg | `var(--bg-surface)` | `var(--surface)` (`cp-trigger-wizard.ts:49`) — undefined | Change token | **B** |
| 16 | Form input | `padding: 8px 12px`, radius `var(--radius-md)` (8px) | `padding: 6px 8px`, radius 4px (`cp-trigger-wizard.ts:71–81`) | Align to 10.3 | A |
| 17 | Form label | UPPERCASE 12px, 0.05em letter-spacing | normal-case 13px (`cp-trigger-wizard.ts:62–67`) | Align to 10.3 | A |
| 18 | Wizard footer | Cancel left, [Back][Next/Create] right | OK in `cp-trigger-wizard.ts:461–488` | — | ✓ |
| 19 | Confirm delete | `window.confirm()` accepted (flow-list:126) | No confirmation in `cp-trigger-list._onDelete` (`:93`) | Add confirm before `deleteTrigger` (functional bug — flag, do NOT fix in this PR) | A (code) |
| 20 | Status badge (runs table) | `.badge.<state>` from shared.ts | Local `.badge.succeeded` (`cp-trigger-detail.ts:90–98`) — `succeeded` not in canonical state set | Map `succeeded → running` colours OR extend `badgeStyles` with a `success` alias documented in 10.10 | A |
| 21 | Chip primitive | (defined here, 10.5 — seed) | OK in cron-picker | — | ✓ |
| 22 | Calendar grid | (defined here, 10.6 — seed) | OK in cron-picker | — | ✓ |
| 23 | Mode switch (radio) | (canonical 10.4) | OK in cron-picker | — | ✓ |
| 24 | Empty-flows hint | `<a>` styled as link inside dashed surface — no btn | `<a href="#/...">Open flows</a>` as plain underline (`cp-trigger-wizard.ts:329`) | Acceptable; consider styling as ghost button for affordance | A |
| 25 | i18n IDs | `<scope>-<role>` | `trigger-wiz-*`, `trigger-page-*`, `cron-picker-*` — within convention | — | ✓ |
| 26 | Section header h1 | `.section-title` + count | bare `<h1>` (`cp-triggers-view.ts:37`) | See #6 | A |
| 27 | Reveal/Rotate buttons | Should be `btn-ghost` then `btn-danger` | Bare `.btn` (`cp-trigger-detail.ts:293–297`) | Apply variants | A |
| 28 | Inline `style=` attr | Avoid — use class | `style="margin-top: 12px;"` on `.checkbox-row` (`cp-trigger-wizard.ts:420`) | Move to class | A |

### Drift summary

- **Total dimensions audited**: 28
- **OK / canonical**: 7 (#11, 13, 14, 18, 21, 22, 23, 25)
- **Drift (A)**: 13
- **Breaking (B, undefined tokens / wrong class form)**: 6 (#1, 2, 3, 4, 8, 15) — all caused by either undefined CSS custom properties or incorrect button-class form. **#1 and #15 mean the wizard panel and list rows currently render with UA fallback colours, not the documented dark theme.**

### Top 3 most actionable fixes (for `feature/triggers-wizard-align`)

1. **Token migration** (#1, #15): global find-and-replace inside
   `ui/src/components/triggers/*.ts` — `--surface` → `--bg-surface`,
   `--border` → `--bg-border`, `--surface-alt` → `--bg-hover`,
   `--state-success` → `--state-running`, `--accent-contrast` → `#fff`.
   Single largest visual fix.
2. **Button class form** (#2, #3, #4, #27): rename `class="btn primary"` →
   `class="btn btn-primary"`; replace bare `.btn` action buttons in
   `cp-trigger-list.ts` with the `.btn-action` colour matrix from
   `flow-list.ts:513–558`.
3. **List row + empty state** (#7, #8, #9, #10): rebuild `cp-trigger-list.ts`
   on the `flow-list` row template (surface card, hover border, toggle-switch
   primitive, tinted action buttons, empty state with icon+hint).

### Code-level bugs flagged but NOT fixed in this doc-only PR

- **CB-1 (`cp-trigger-list.ts:93`)** — `_onDelete` calls `deleteTrigger`
  without confirmation. Flow-list and the rest of the codebase use
  `window.confirm()` before destructive action. Recommended fix: add a
  confirm() in the same PR that re-styles the row.
- **CB-2 (`cp-trigger-detail.ts:90`)** — badge uses class `succeeded` which is
  not in the shared `badgeStyles` state set. The element will render the base
  `.badge` block (grey) regardless of run status. Map runs to canonical state
  classes (`running` → running, `succeeded`/`completed` → running-green,
  `failed` → error).
- **CB-3 (`cp-trigger-wizard.ts:420`)** — inline `style="margin-top: 12px;"`
  on `.checkbox-row` — replace with a class rule.

---

*Updated: 2026-05-03 — added sections 10 (UI primitives), 11 (UI patterns),
12 (i18n IDs), and 13 (Triggers audit). Sections 1–9 unchanged.*
*Updated: 2026-03-18 - Font stack fix (Geist), dark theme addition, icon clarification (emoji/inline SVG)*
