# 11. Composant Lit <cp-login-view>

## Contexte

Cette tâche crée le composant de page de login `ui/src/components/login-view.ts`.
Il suit les conventions Lit du projet (LitElement, CSS custom properties via design tokens,
`@lit/localize` pour l'i18n, pas de bibliothèque externe de composants).

Règles design à respecter (design-rules.md) :
- Fond sombre, design tokens CSS (jamais de valeurs hardcodées)
- Pas de dégradés bleu-violet, pas de border-radius excessif
- Hiérarchie visuelle claire
- Touch targets minimum 44×44px, contraste WCAG AA

## Fichiers concernés

- `ui/src/components/login-view.ts` — créer (nouveau fichier)

## Implémentation détaillée

### Structure du composant

```typescript
import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";

@localized()
@customElement("cp-login-view")
export class CpLoginView extends LitElement {
  static styles = [tokenStyles, css`...`];

  @state() private _loading = false;
  @state() private _error = "";

  // ...
}
```

### Layout visuel

```
┌──────────────────────────────────────────┐
│  (fond : var(--bg-base), plein écran)    │
│                                          │
│         ┌──────────────────────┐         │
│         │  claw-pilot          │         │
│         │  (titre, centré)     │         │
│         │                      │         │
│         │  Username            │         │
│         │  [admin           ]  │         │
│         │                      │         │
│         │  Password            │         │
│         │  [••••••••••••••• ]  │         │
│         │                      │         │
│         │  [ Sign in         ] │         │
│         │                      │         │
│         │  ⚠ Invalid creds    │         │
│         └──────────────────────┘         │
│                                          │
│  v0.15.0  (footer discret)               │
└──────────────────────────────────────────┘
```

### Comportement

**Formulaire** :
- `username` : input text, valeur initiale `"admin"`, `autocomplete="username"`
- `password` : input password, `autocomplete="current-password"`, autofocus
- Enter dans n'importe quel champ → submit
- Bouton "Sign in" : `type="submit"`, désactivé pendant `_loading`

**Submit** :
1. `_loading = true`, `_error = ""`
2. `POST /api/auth/login` avec `{ username, password }` (fetch direct, pas via `apiFetch`
   car le token n'est pas encore disponible)
3. Si 200 : extraire `token` du body, dispatcher :
   ```typescript
   this.dispatchEvent(new CustomEvent("authenticated", {
     detail: { token },
     bubbles: true,
     composed: true,
   }));
   ```
4. Si 401 : `_error = msg("Invalid credentials", { id: "login-error-invalid-creds" })`
5. Si autre erreur : `_error = msg("An error occurred. Please try again.", { id: "login-error-generic" })`
6. `_loading = false`

**Affichage de l'erreur** : zone sous le bouton, visible uniquement si `_error !== ""`

### Styles CSS

Utiliser exclusivement les design tokens :
```css
:host {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: var(--bg-base);
}

.card {
  background: var(--bg-surface);
  border: 1px solid var(--bg-border);
  border-radius: 8px;
  padding: 32px;
  width: 100%;
  max-width: 360px;
}

.title {
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 24px;
  text-align: center;
}

label {
  display: block;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  margin-bottom: 4px;
}

input {
  width: 100%;
  background: var(--bg-input, var(--bg-base));
  border: 1px solid var(--bg-border);
  border-radius: 4px;
  color: var(--text-primary);
  padding: 8px 12px;
  font-size: var(--text-base);
  box-sizing: border-box;
  margin-bottom: 16px;
}

input:focus {
  outline: 2px solid var(--accent-primary, #4f8ef7);
  outline-offset: -1px;
}

.btn-submit {
  width: 100%;
  padding: 10px;
  min-height: 44px;
  background: var(--accent-primary, #4f8ef7);
  color: #fff;
  border: none;
  border-radius: 4px;
  font-size: var(--text-base);
  font-weight: 500;
  cursor: pointer;
}

.btn-submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error {
  color: var(--color-error, #f87171);
  font-size: var(--text-sm);
  margin-top: 12px;
}
```

### i18n

Wrapper toutes les strings UI avec `msg()` :
- Titre : `msg("claw-pilot", { id: "login-title" })`
- Label username : `msg("Username", { id: "login-label-username" })`
- Label password : `msg("Password", { id: "login-label-password" })`
- Bouton : `msg("Sign in", { id: "login-btn-submit" })`
- Erreur credentials : `msg("Invalid credentials", { id: "login-error-invalid-creds" })`
- Erreur générique : `msg("An error occurred. Please try again.", { id: "login-error-generic" })`

Les traductions sont ajoutées en tâche 15.

## Critères de validation

- [ ] `pnpm build:ui` (ou `pnpm build`) passe sans erreur TypeScript
- [ ] Le composant s'affiche correctement (fond sombre, formulaire centré)
- [ ] Submit avec bonnes credentials → event `authenticated` dispatché
- [ ] Submit avec mauvaises credentials → message d'erreur affiché
- [ ] Enter dans le champ password → submit
- [ ] Autofocus sur le champ password au montage
- [ ] Bouton désactivé pendant le chargement

## Dépendances

Aucune dépendance sur les tâches backend — peut être développé en parallèle de la phase 2.
