# 05. Constantes session et auth dans constants.ts

## Contexte

`src/lib/constants.ts` est la source de vérité pour toutes les valeurs de configuration
du projet (ports, timeouts, noms de fichiers). Cette tâche ajoute les constantes liées
à l'authentification et aux sessions, qui seront référencées par `session-store.ts`,
`routes/auth.ts`, et `server.ts`. Centraliser ces valeurs évite les magic numbers dispersés.

Le fichier exporte un objet `constants` avec `as const`. Les nouvelles constantes s'ajoutent
à cet objet.

## Fichiers concernés

- `src/lib/constants.ts` — modifier (ajouter constantes dans l'objet `constants`)

## Implémentation détaillée

Ajouter les entrées suivantes dans l'objet `constants`, dans une section commentée
`// Auth & sessions` :

```typescript
// Auth & sessions
SESSION_COOKIE_NAME: "__cp_sid",
SESSION_TTL_MS: 24 * 60 * 60 * 1000,        // 24h
SESSION_CLEANUP_INTERVAL_MS: 60 * 1000,      // 1 min
AUTH_RATE_LIMIT_MAX: 5,                       // 5 tentatives
AUTH_RATE_LIMIT_WINDOW_MS: 60 * 1000,         // par minute
ADMIN_USERNAME: "admin",
```

**Emplacement** : ajouter après la section `// Self-update (claw-pilot)` existante,
avant la fermeture `} as const`.

**Valeurs et justifications :**
- `SESSION_COOKIE_NAME` : `__cp_sid` — préfixe `__` pour indiquer un cookie interne,
  cohérent avec `__CP_TOKEN__` existant
- `SESSION_TTL_MS` : 24h — balance entre sécurité et confort utilisateur
- `SESSION_CLEANUP_INTERVAL_MS` : 60s — même fréquence que le rate limiter existant
- `AUTH_RATE_LIMIT_MAX` : 5 — protection brute-force, valeur OWASP recommandée
- `AUTH_RATE_LIMIT_WINDOW_MS` : 60s — fenêtre glissante d'une minute
- `ADMIN_USERNAME` : `"admin"` — V1 mono-utilisateur, centralisé pour éviter les typos

## Critères de validation

- [ ] `pnpm typecheck` passe sans erreur
- [ ] Les 6 constantes sont accessibles via `constants.SESSION_COOKIE_NAME`, etc.
- [ ] L'objet `constants` conserve `as const` (pas de régression TypeScript)

## Dépendances

Aucune — cette tâche est indépendante et peut être faite en parallèle de la phase 1.
