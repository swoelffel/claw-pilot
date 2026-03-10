# 10. Tests routes auth

## Contexte

Cette tâche crée les tests d'intégration pour les routes auth créées en tâche 07.
Les tests utilisent Vitest et testent les routes Hono directement (sans serveur HTTP
réel) en utilisant `app.request()` — pattern déjà utilisé dans le projet si disponible,
sinon via `fetch` sur un serveur de test.

## Fichiers concernés

- `src/dashboard/__tests__/auth-routes.test.ts` — créer (nouveau fichier)

## Implémentation détaillée

### Setup

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { Hono } from "hono";
import { initDatabase } from "../../db/schema.js";
import { SessionStore } from "../session-store.js";
import { hashPassword } from "../../core/auth.js";
import { registerAuthRoutes } from "../routes/auth.js";
import { constants } from "../../lib/constants.js";
```

**Setup par test** :
1. DB en mémoire avec `initDatabase(":memory:")`
2. Insérer un user admin avec un mot de passe connu :
   ```typescript
   const password = "TestPassword123";
   const hash = await hashPassword(password);
   db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)")
     .run(constants.ADMIN_USERNAME, hash);
   ```
3. Créer un `SessionStore` et une app Hono de test
4. Appeler `registerAuthRoutes(app, deps, "test-token-64chars")`

### Tests à implémenter

**1. Login success**
- `POST /api/auth/login` avec `{ username: "admin", password: "TestPassword123" }`
- Réponse : status 200
- Body : `{ ok: true, token: "test-token-64chars" }`
- Header `Set-Cookie` contient `__cp_sid=`

**2. Login fail — mauvais mot de passe**
- `POST /api/auth/login` avec `{ username: "admin", password: "wrong" }`
- Réponse : status 401
- Body : `{ code: "INVALID_CREDENTIALS" }`
- Pas de cookie posé

**3. Login fail — user inexistant**
- `POST /api/auth/login` avec `{ username: "unknown", password: "anything" }`
- Réponse : status 401

**4. Logout — cookie supprimé**
- Faire un login pour obtenir un cookie
- `POST /api/auth/logout` avec le cookie
- Réponse : status 200
- Header `Set-Cookie` contient `__cp_sid=; Max-Age=0` (ou équivalent suppression)
- `validate(sessionId)` retourne `null` après logout

**5. GET /api/auth/me — session valide**
- Faire un login pour obtenir un cookie
- `GET /api/auth/me` avec le cookie
- Réponse : status 200
- Body : `{ authenticated: true, username: "admin", role: "admin", token: "..." }`

**6. GET /api/auth/me — sans session**
- `GET /api/auth/me` sans cookie ni Bearer
- Réponse : status 401

**7. GET /api/auth/me — Bearer token fallback**
- `GET /api/auth/me` avec `Authorization: Bearer test-token-64chars`
- Réponse : status 200

**8. Rate limit login**
- Envoyer 6 requêtes `POST /api/auth/login` avec mauvaises credentials en séquence rapide
- La 6e requête doit retourner status 429
- Note : ce test peut être fragile selon l'implémentation du rate limiter en mémoire.
  Si le rate limiter est basé sur l'IP et que les tests n'ont pas d'IP, adapter le test
  ou le marquer comme `it.skip` avec un commentaire explicatif.

## Critères de validation

- [ ] `pnpm test:run` passe sans erreur
- [ ] Les 8 cas de test sont couverts (ou 7 si le rate limit est skipé avec justification)
- [ ] Les tests utilisent une DB en mémoire (pas de DB persistante)
- [ ] Les tests sont isolés (pas d'état partagé)

## Dépendances

- Tâche 07 doit être complétée avant (routes auth)
- Tâche 08 doit être complétée avant (middleware, pour tester l'intégration complète)
