# 01. Migration DB v6 — tables users et sessions

## Contexte

Le schéma SQLite de claw-pilot est versionné dans `src/db/schema.ts`. Les migrations sont
appliquées automatiquement à l'ouverture de la DB via `initDatabase()`. La version actuelle
est v5. Cette tâche ajoute la migration v6 qui crée les tables `users` et `sessions`,
nécessaires à toute la feature d'authentification.

Convention critique : ne jamais faire de DROP ou ALTER TABLE — uniquement des opérations
additives (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN` nullable).

## Fichiers concernés

- `src/db/schema.ts` — modifier (ajouter migration v6 dans le tableau `MIGRATIONS`)

## Implémentation détaillée

Localiser le tableau `MIGRATIONS` dans `src/db/schema.ts` et ajouter l'entrée suivante
**après** la dernière migration existante (v5) :

```typescript
{
  version: 6,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('admin', 'operator', 'viewer')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
        ip_address TEXT,
        user_agent TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
    `);
  },
},
```

**Choix de design à respecter :**
- `role` avec CHECK constraint — prépare le multi-utilisateur sans l'implémenter
- `password_hash` stocke le format `scrypt:<salt_hex>:<hash_hex>` (défini en tâche 02)
- `sessions.id` est un nanoid (non prédictible) — pas un auto-increment
- `expires_at` permet le nettoyage périodique des sessions expirées
- `last_seen_at` permet le sliding window (prolonger les sessions actives)
- `ip_address` et `user_agent` sont optionnels (NULL autorisé) — pour l'audit
- FK `user_id` avec `ON DELETE CASCADE` — supprimer un user invalide ses sessions

## Critères de validation

- [ ] `pnpm typecheck` passe sans erreur
- [ ] La migration s'exécute sans erreur sur une DB fraîche (`claw-pilot init` ou test)
- [ ] Les tables `users` et `sessions` existent après migration
- [ ] Les index `idx_sessions_user_id` et `idx_sessions_expires_at` existent
- [ ] La migration est idempotente (`CREATE TABLE IF NOT EXISTS`)

## Dépendances

Aucune — cette tâche est le point de départ de toute la feature.
