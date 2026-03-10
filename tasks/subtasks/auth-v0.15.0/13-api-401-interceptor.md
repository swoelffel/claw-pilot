# 13. Intercepteur 401 global dans api.ts

## Contexte

`ui/src/api.ts` contient la fonction `apiFetch()` utilisée par tous les composants pour
appeler l'API. Actuellement, les erreurs 401 sont traitées comme n'importe quelle erreur
API (throw `ApiError`). Cette tâche ajoute un comportement spécial pour les 401 : dispatcher
un event global `cp:session-expired` qui sera écouté par `app.ts` (tâche 12) pour forcer
le re-login.

Les routes `/auth/login` et `/auth/me` sont exclues de cet intercepteur (elles gèrent
elles-mêmes les 401).

## Fichiers concernés

- `ui/src/api.ts` — modifier (modifier la fonction `apiFetch`)

## Implémentation détaillée

### Modification de `apiFetch()`

Localiser le bloc `if (!res.ok)` dans `apiFetch()` et ajouter la détection 401 AVANT
le throw existant :

```typescript
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    // Session expirée — forcer re-login (sauf sur les routes auth elles-mêmes)
    if (
      res.status === 401 &&
      path !== "/auth/login" &&
      path !== "/auth/me"
    ) {
      window.dispatchEvent(new CustomEvent("cp:session-expired"));
      throw new ApiError(401, "SESSION_EXPIRED", "Session expired");
    }

    // Reste inchangé
    let code = "INTERNAL_ERROR";
    let message = res.statusText;
    try {
      const body = await res.json() as { code?: string; error?: string };
      code = body.code ?? "INTERNAL_ERROR";
      message = body.error ?? res.statusText;
    } catch {
      // Body is not JSON — keep defaults
    }
    throw new ApiError(res.status, code, message);
  }

  return res.json() as Promise<T>;
}
```

**Comportement** :
- 401 sur `/api/instances` → event `cp:session-expired` + throw `ApiError(401, "SESSION_EXPIRED")`
- 401 sur `/api/auth/login` → throw `ApiError(401, "INVALID_CREDENTIALS", ...)` (géré par login-view)
- 401 sur `/api/auth/me` → throw normal (géré par `_checkAuth` dans app.ts)
- Autres erreurs → comportement inchangé

**Note** : l'event `cp:session-expired` est dispatché sur `window` pour être accessible
depuis n'importe quel composant. `app.ts` l'écoute et bascule `_authenticated = false`.

## Critères de validation

- [ ] `pnpm build:ui` passe sans erreur TypeScript
- [ ] Un 401 sur `/api/instances` dispatche `cp:session-expired`
- [ ] Un 401 sur `/api/auth/login` ne dispatche PAS `cp:session-expired`
- [ ] Un 401 sur `/api/auth/me` ne dispatche PAS `cp:session-expired`
- [ ] Les autres codes d'erreur (400, 404, 500) ne sont pas affectés

## Dépendances

Aucune — cette tâche est indépendante et peut être faite en parallèle des autres.
