# 12. Gate d'authentification dans app.ts

## Contexte

`ui/src/app.ts` est le composant racine `<cp-app>`. Actuellement, il charge directement
le layout principal. Cette tâche ajoute une gate d'authentification : au boot, le composant
vérifie si une session valide existe via `GET /api/auth/me`. Si non, il affiche
`<cp-login-view>`. Si oui, il affiche le layout existant.

Le token récupéré via `/api/auth/me` est stocké en mémoire (`window.__CP_TOKEN__`) pour
être utilisé par `api.ts` (Bearer token pour les appels API et WebSocket).

## Fichiers concernés

- `ui/src/app.ts` — modifier

## Implémentation détaillée

### 1. Nouveaux imports

```typescript
import "./components/login-view.js";
```

### 2. Nouveaux states

Ajouter dans la classe `CpApp` :

```typescript
@state() private _authenticated = false;
@state() private _authChecking = true;
```

### 3. Boot sequence dans `connectedCallback()`

Ajouter (ou modifier si `connectedCallback` existe déjà) :

```typescript
override async connectedCallback() {
  super.connectedCallback();
  await localeReady;
  await this._checkAuth();
  // ... reste de l'initialisation existante (WebSocket, etc.)
  // Note : ne démarrer le WebSocket QUE si _authenticated = true
}

private async _checkAuth(): Promise<void> {
  this._authChecking = true;
  try {
    const res = await fetch("/api/auth/me");
    if (res.ok) {
      const data = await res.json() as { authenticated: boolean; token: string };
      if (data.authenticated && data.token) {
        window.__CP_TOKEN__ = data.token;
        this._authenticated = true;
      }
    }
  } catch {
    // Network error — not authenticated
  }
  this._authChecking = false;
}
```

### 4. Handler d'authentification réussie

```typescript
private _onAuthenticated(e: CustomEvent<{ token: string }>) {
  window.__CP_TOKEN__ = e.detail.token;
  this._authenticated = true;
  // Démarrer le WebSocket maintenant
  this._initWebSocket();
}
```

### 5. Listener session-expired

Dans `connectedCallback()` :

```typescript
window.addEventListener("cp:session-expired", () => {
  this._authenticated = false;
  window.__CP_TOKEN__ = undefined;
  // Fermer le WebSocket si ouvert
  this._closeWebSocket();
});
```

### 6. Bouton logout dans le header

Dans le template du header existant, ajouter un bouton logout à droite :

```typescript
// Dans render(), dans le header
html`
  <button class="btn-logout" @click=${this._logout}>
    ${msg("Sign out", { id: "app-btn-logout" })}
  </button>
`
```

```typescript
private async _logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  this._authenticated = false;
  window.__CP_TOKEN__ = undefined;
  this._closeWebSocket();
}
```

Style du bouton logout : discret, dans le header à droite, cohérent avec le design existant.

### 7. Mise à jour de `render()`

```typescript
override render() {
  if (this._authChecking) {
    return html`
      <div class="auth-checking">
        <!-- Spinner ou écran vide pendant le check -->
      </div>
    `;
  }

  if (!this._authenticated) {
    return html`
      <cp-login-view @authenticated=${this._onAuthenticated}></cp-login-view>
    `;
  }

  // Layout existant (inchangé)
  return html`...`;
}
```

**Note** : l'écran de check (`_authChecking = true`) doit être bref et discret — fond
sombre, pas de spinner animé agressif. Un simple fond `var(--bg-base)` suffit.

### 8. Initialisation WebSocket conditionnelle

Le WebSocket ne doit être initialisé QUE si `_authenticated = true`. Vérifier le code
existant de connexion WebSocket dans `app.ts` et le conditionner à `_authenticated`.

## Critères de validation

- [ ] `pnpm build:ui` passe sans erreur TypeScript
- [ ] Au boot sans session → `<cp-login-view>` affiché
- [ ] Au boot avec session valide → layout principal affiché directement
- [ ] Login réussi → layout principal affiché, WebSocket démarré
- [ ] Bouton logout → retour à la page de login
- [ ] Event `cp:session-expired` → retour à la page de login
- [ ] `window.__CP_TOKEN__` est défini après login/boot avec session

## Dépendances

- Tâche 11 doit être complétée avant (composant `<cp-login-view>`)
