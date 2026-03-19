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

---

*Updated: 2026-03-18 - Font stack fix (Geist), dark theme addition, icon clarification (emoji/inline SVG)*
