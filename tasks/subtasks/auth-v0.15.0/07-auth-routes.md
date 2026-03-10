# 07. Routes auth — POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me

## Contexte

Cette tâche crée le module de routes d'authentification `src/dashboard/routes/auth.ts`,
suivant le pattern des routes existantes (`routes/instances.ts`, `routes/system.ts`, etc.).
Les routes sont enregistrées via une fonction `registerAuthRoutes(app, deps)` appelée
dans `server.ts` (tâche 08) **avant** le middleware d'auth (pour que `/api/auth/login`
soit accessible sans session).

## Fichiers concernés

- `src/dashboard/routes/auth.ts` — créer (nouveau fichier)

## Implémentation détaillée

### Imports

```typescript
import type { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { verifyPassword } from "../../core/auth.js";
import { constants } from "../../lib/constants.js";
import { apiError } from "../route-deps.js";
import type { RouteDeps } from "../route-deps.js";
import { createRateLimiter } from "../rate-limit.js";
```

### Signature de la fonction

```typescript
export function registerAuthRoutes(app: Hono, deps: RouteDeps, token: string): void
```

Le paramètre `token` est le dashboard token Bearer (pour le retourner dans `/me` et
`/login`). Il est passé depuis `server.ts`.

### `POST /api/auth/login`

**Body attendu** : `{ "username": "admin", "password": "..." }`

**Logique** :
1. Appliquer un rate limiter strict : `createRateLimiter({ maxRequests: constants.AUTH_RATE_LIMIT_MAX, windowMs: constants.AUTH_RATE_LIMIT_WINDOW_MS })`
   — ce rate limiter est appliqué uniquement sur cette route, pas sur `/api/*` global
2. Parser le body JSON
3. Lookup user par username dans la table `users` :
   ```sql
   SELECT * FROM users WHERE username = ?
   ```
4. Si user non trouvé OU `verifyPassword(password, user.password_hash)` retourne `false` :
   - Logger un event `auth_login_failed` dans la table `events` (instance_id = null)
   - Retourner `apiError(c, 401, "INVALID_CREDENTIALS", "Invalid credentials")`
5. Si OK :
   - Créer une session : `deps.sessionStore.create(user.id, ip, ua)`
     - `ip` : `c.req.header("X-Forwarded-For") ?? c.req.header("X-Real-IP") ?? "unknown"`
     - `ua` : `c.req.header("User-Agent") ?? null`
   - Poser le cookie :
     ```typescript
     setCookie(c, constants.SESSION_COOKIE_NAME, sessionId, {
       httpOnly: true,
       secure: c.req.header("X-Forwarded-Proto") === "https",
       sameSite: "Strict",
       path: "/",
       maxAge: constants.SESSION_TTL_MS / 1000,
     });
     ```
   - Logger un event `auth_login_success`
   - Retourner `{ ok: true, token }` (le token Bearer pour le WebSocket)

**Note sur `secure`** : détecter HTTPS via `X-Forwarded-Proto` (Nginx fait le TLS
termination). En dev local (HTTP), le flag `Secure` est omis automatiquement.

### `POST /api/auth/logout`

**Logique** :
1. Lire le cookie `__cp_sid` via `getCookie(c, constants.SESSION_COOKIE_NAME)`
2. Si présent : `deps.sessionStore.delete(sessionId)`
3. Supprimer le cookie : `deleteCookie(c, constants.SESSION_COOKIE_NAME, { path: "/" })`
4. Retourner `{ ok: true }`

### `GET /api/auth/me`

**Logique** :
1. Essayer le cookie de session en premier :
   - `getCookie(c, constants.SESSION_COOKIE_NAME)` → `deps.sessionStore.validate(sid)`
2. Si pas de session valide, essayer le Bearer token :
   - `c.req.header("Authorization")` → comparer avec `Bearer ${token}`
3. Si aucun mécanisme ne valide → `apiError(c, 401, "UNAUTHORIZED", "Unauthorized")`
4. Si session valide : lookup user en DB pour obtenir `username` et `role`
5. Retourner :
   ```json
   { "authenticated": true, "username": "admin", "role": "admin", "token": "<dashboard_token>" }
   ```

Cet endpoint est appelé par le SPA au boot pour vérifier la session et récupérer le token
Bearer (nécessaire pour le WebSocket).

### Enregistrement des events

Utiliser la table `events` existante pour les logs d'audit. Vérifier la signature de
l'insert dans les routes existantes pour respecter le même pattern.

## Critères de validation

- [ ] `pnpm typecheck` passe sans erreur
- [ ] `POST /api/auth/login` avec bonnes credentials → 200, cookie posé, token dans body
- [ ] `POST /api/auth/login` avec mauvaises credentials → 401 `INVALID_CREDENTIALS`
- [ ] `POST /api/auth/login` après 5 tentatives en 1 min → 429
- [ ] `POST /api/auth/logout` → cookie supprimé, 200
- [ ] `GET /api/auth/me` avec cookie valide → 200 avec `authenticated: true`
- [ ] `GET /api/auth/me` sans session → 401

## Dépendances

- Tâche 02 doit être complétée avant (verifyPassword)
- Tâche 03 doit être complétée avant (SessionStore)
- Tâche 05 doit être complétée avant (constantes)
- Tâche 06 doit être complétée avant (RouteDeps avec sessionStore)
