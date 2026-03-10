# 03. SessionStore — CRUD sessions SQLite

## Contexte

La table `sessions` créée en tâche 01 nécessite une couche d'accès dédiée. Cette tâche
crée `src/dashboard/session-store.ts`, une classe qui encapsule toutes les opérations
sur les sessions : création, validation (avec sliding window), suppression, et nettoyage
périodique. Elle sera instanciée dans `src/commands/dashboard.ts` (tâche 09) et passée
au serveur Hono via `RouteDeps` (tâche 06).

Le projet utilise `better-sqlite3` (synchrone) — toutes les méthodes sont synchrones sauf
indication contraire.

## Fichiers concernés

- `src/dashboard/session-store.ts` — créer (nouveau fichier)

## Implémentation détaillée

### Interface `Session`

```typescript
export interface Session {
  id: string;
  userId: number;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}
```

### Classe `SessionStore`

```typescript
import { nanoid } from "nanoid";
import type Database from "better-sqlite3";

export class SessionStore {
  constructor(
    private db: Database.Database,
    private ttlMs: number = 24 * 60 * 60 * 1000
  ) {}
  // ...
}
```

**Note** : `nanoid` est déjà utilisé dans le projet — vérifier l'import existant.
Si non disponible, utiliser `crypto.randomUUID()` ou `randomBytes(21).toString("base64url")`.

### `create(userId: number, ip?: string, ua?: string): string`

1. Générer un ID unique via `nanoid()` (ou équivalent)
2. Calculer `expiresAt = new Date(Date.now() + this.ttlMs).toISOString()`
3. Insérer en DB :
   ```sql
   INSERT INTO sessions (id, user_id, expires_at, ip_address, user_agent)
   VALUES (?, ?, ?, ?, ?)
   ```
4. Retourner l'ID de session

### `validate(sessionId: string): Session | null`

1. Requête :
   ```sql
   SELECT * FROM sessions
   WHERE id = ? AND expires_at > datetime('now')
   ```
2. Si pas de résultat → retourner `null`
3. **Sliding window** : si `lastSeenAt` est dans la 2e moitié de vie de la session
   (c'est-à-dire `now > createdAt + ttl/2`), prolonger `expires_at` de `ttlMs` :
   ```sql
   UPDATE sessions
   SET last_seen_at = datetime('now'),
       expires_at = datetime('now', '+N seconds')
   WHERE id = ?
   ```
   Sinon, mettre à jour uniquement `last_seen_at`.
4. Retourner l'objet `Session` (avec les champs en camelCase)

**Mapping colonnes → camelCase** :
- `user_id` → `userId`
- `created_at` → `createdAt`
- `expires_at` → `expiresAt`
- `last_seen_at` → `lastSeenAt`
- `ip_address` → `ipAddress`
- `user_agent` → `userAgent`

### `delete(sessionId: string): void`

```sql
DELETE FROM sessions WHERE id = ?
```

### `deleteAllForUser(userId: number): void`

```sql
DELETE FROM sessions WHERE user_id = ?
```

Utilisé lors d'un `auth reset` pour forcer le re-login de toutes les sessions actives.

### `cleanup(): number`

```sql
DELETE FROM sessions WHERE expires_at < datetime('now')
```

Retourner le nombre de sessions supprimées (`stmt.run().changes`).
Appelé périodiquement toutes les 60 secondes (timer géré dans `server.ts`, tâche 08).

## Critères de validation

- [ ] `pnpm typecheck` passe sans erreur
- [ ] `create()` retourne un ID non vide et insère en DB
- [ ] `validate()` retourne la session si valide, `null` si expirée ou inexistante
- [ ] `validate()` met à jour `last_seen_at` à chaque appel
- [ ] `validate()` prolonge `expires_at` si la session est dans sa 2e moitié de vie
- [ ] `delete()` supprime la session ciblée uniquement
- [ ] `deleteAllForUser()` supprime toutes les sessions d'un user
- [ ] `cleanup()` supprime les sessions expirées et retourne le count

## Dépendances

- Tâche 01 doit être complétée avant (tables `users` et `sessions` en DB)
