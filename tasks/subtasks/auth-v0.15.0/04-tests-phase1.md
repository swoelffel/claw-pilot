# 04. Tests unitaires — auth + session store

## Contexte

Le projet utilise Vitest. Les tests existants sont dans `src/core/__tests__/` et
`src/db/__tests__/`. Cette tâche crée les tests unitaires pour les deux modules créés
en phase 1 : `src/core/auth.ts` (tâche 02) et `src/dashboard/session-store.ts` (tâche 03).

Pattern de test : Arrange–Act–Assert. Les tests de session store utilisent une DB SQLite
en mémoire (`:memory:`) pour l'isolation.

## Fichiers concernés

- `src/core/__tests__/auth.test.ts` — créer (nouveau fichier)
- `src/dashboard/__tests__/session-store.test.ts` — créer (nouveau fichier)

## Implémentation détaillée

### `src/core/__tests__/auth.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, generatePassword } from "../auth.js";
```

**Tests à implémenter :**

1. **Hash/verify round-trip**
   - `hashPassword("mypassword")` retourne une string non vide
   - Le format est `scrypt:<32hex>:<128hex>` (regex : `/^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/`)
   - `verifyPassword("mypassword", hash)` retourne `true`
   - `verifyPassword("wrongpassword", hash)` retourne `false`

2. **Deux hashes du même mot de passe sont différents** (salt aléatoire)
   - `hashPassword("same")` appelé deux fois → deux strings différentes
   - Les deux vérifient correctement avec `verifyPassword("same", hash)`

3. **Gestion des formats invalides**
   - `verifyPassword("x", "not-a-valid-hash")` → `false` (pas de throw)
   - `verifyPassword("x", "scrypt:badhex:badhex")` → `false` (pas de throw)
   - `verifyPassword("x", "")` → `false`

4. **generatePassword — entropie et alphabet**
   - Retourne une string de longueur 16
   - Ne contient aucun des caractères `0`, `O`, `1`, `l`, `I`
   - Appelé 100 fois → tous les résultats sont différents (probabilité quasi-nulle de collision)

### `src/dashboard/__tests__/session-store.test.ts`

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initDatabase } from "../../db/schema.js";
import { SessionStore } from "../session-store.js";
```

**Setup** : créer une DB en mémoire avec `initDatabase(":memory:")` avant chaque test.
Insérer un user de test dans la table `users` pour avoir un `userId` valide.

**Tests à implémenter :**

1. **create()**
   - Retourne un ID non vide (string)
   - La session est présente en DB après création
   - `ip` et `ua` sont stockés si fournis, `null` sinon

2. **validate() — session valide**
   - Retourne l'objet `Session` avec les bons champs
   - `userId` correspond au user inséré
   - Met à jour `last_seen_at` à chaque appel

3. **validate() — session expirée**
   - Créer un `SessionStore` avec `ttlMs = 1` (1ms)
   - Attendre 10ms
   - `validate(id)` retourne `null`

4. **validate() — sliding window**
   - Créer un `SessionStore` avec `ttlMs = 1000` (1s)
   - Créer une session, attendre 600ms (dans la 2e moitié de vie)
   - `validate(id)` → `expiresAt` est prolongé (> `now + 500ms`)

5. **validate() — ID inexistant**
   - `validate("nonexistent-id")` retourne `null`

6. **delete()**
   - Après `delete(id)`, `validate(id)` retourne `null`
   - Supprimer un ID inexistant ne throw pas

7. **deleteAllForUser()**
   - Créer 3 sessions pour le même user
   - `deleteAllForUser(userId)` → les 3 sessions sont supprimées
   - `validate()` retourne `null` pour chacune

8. **cleanup()**
   - Créer 2 sessions expirées (ttlMs = 1) et 1 session valide
   - `cleanup()` retourne 2
   - La session valide est toujours accessible

## Critères de validation

- [ ] `pnpm test:run` passe sans erreur
- [ ] Tous les cas de test listés ci-dessus sont couverts
- [ ] Aucun test ne dépend d'une DB persistante (utiliser `:memory:`)
- [ ] Les tests sont isolés (pas d'état partagé entre tests)

## Dépendances

- Tâche 02 doit être complétée avant (module auth)
- Tâche 03 doit être complétée avant (session store)
