# Design Rules

## 1. Règles fondamentales — Jamais de look "généré par IA"

> **Ces interdictions sont absolues et non négociables.**

**INTERDIT :**
- Les dégradés génériques bleu-violet
- Les cards avec `border-radius` excessif
- Les ombres trop prononcées
- Les mises en page centrées sans hiérarchie visuelle
- Le combo **Inter + Lucide** — marqueurs instantanés d'une UI générée par IA

**OBLIGATOIRE :**
- Proposer des polices alternatives depuis Google Fonts :
  `Instrument Sans`, `Satoshi`, `General Sans`, `Plus Jakarta Sans`, `Manrope`, `Geist`
- Utiliser des bibliothèques d'icônes distinctives : **Phosphor Icons**, **Heroicons**, **Radix Icons** — pas Lucide par défaut

---

## 2. Design System avant tout

> **Avant d'écrire la moindre ligne de code UI, définir et respecter le DESIGN_SYSTEM.**

Le design system couvre : `colors`, `typography`, `spacing`, `radius`, `shadows`.

Si un mood board, une capture d'écran ou une palette est fourni(e) :
- Extraire les couleurs dominantes
- Adapter le design system en conséquence

---

## 3. Hiérarchie visuelle obligatoire

Pour chaque page ou composant, appliquer systématiquement :

| Principe | Règle |
|---|---|
| **Contraste typographique** | Minimum 3 tailles de texte différentes visibles (titre, sous-titre, corps) |
| **Espacement intentionnel** | Plus d'espace = plus d'importance. Sections principales > sous-sections |
| **Points focaux** | Chaque section a UN élément qui attire l'œil en premier (CTA, titre, image) |
| **Rythme vertical** | Alterner sections denses et sections aérées |

---

## 4. Anti-patterns — Ce qu'on ne fait JAMAIS

- Des boutons tous de la même taille/couleur sur une même page
- Du texte centré partout — **le centrage est réservé aux hero sections et aux CTA**
- Des cards identiques en grille sans variation de taille ou de mise en avant
- Du texte blanc sur fond clair, ou du texte gris clair sur fond blanc
- Des sections sans espacement suffisant entre elles
- Des **animations gratuites** (sans intention UX)

---

## 5. Processus de travail

| Contexte | Comportement attendu |
|---|---|
| **Capture d'écran / wireframe** | Reproduire la mise en page fidèlement avant d'ajouter quoi que ce soit. Ne pas réinterpréter. |
| **Mood board / référence** | Extraire la palette dominante, identifier le style typographique, noter le niveau de contraste. |
| **Sans référence** | Demander un exemple ou proposer 2-3 approches visuelles différentes. **Ne jamais coder une UI "par défaut".** |

---

## 6. Stack technique — claw-pilot UI

| Domaine | Technologie |
|---|---|
| Framework | **Lit** (web components) + TypeScript |
| Styling | **CSS custom properties** (design tokens dans `ui/src/styles/tokens.ts`) |
| Composants | Lit `LitElement` — pas de bibliothèque externe de composants |
| Animations | CSS transitions uniquement (pas de lib externe) |
| Icônes | Emoji ou SVG inline — pas de lib d'icônes |
| Polices | System font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`) |
| i18n | `@lit/localize` — 6 langues (fr, en, de, es, it, pt) |

---

## 7. Patterns de code UI — Lit

Toujours typer les propriétés avec les décorateurs Lit :

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

Utiliser les design tokens CSS (jamais de valeurs hardcodées) :

```css
/* Correct */
color: var(--text-primary);
background: var(--bg-surface);
border: 1px solid var(--bg-border);

/* Interdit */
color: #1a202c;
background: #ffffff;
```

---

## 8. Responsive Design & Accessibilité

- **Mobile-first** — pas de scroll horizontal
- Touch targets : minimum **44×44 px**
- Contraste **WCAG AA**
- `aria-label` sur les éléments interactifs
- `focus visible` sur tous les éléments focusables
- `alt` renseigné sur toutes les images

---

## 9. Checklist avant livraison

- [ ] Le design system est respecté
- [ ] La hiérarchie visuelle est claire
- [ ] Le responsive fonctionne sur mobile
- [ ] L'accessibilité est assurée (contraste, aria, focus)
- [ ] Le résultat **ne ressemble pas à un template générique**

---

*Mis à jour : 2026-03-02 - Correction stack technique (Lit + CSS custom properties, pas React/Tailwind)*
