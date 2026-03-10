# 09. Commande dashboard — SessionStore + vérification admin

## Contexte

`src/commands/dashboard.ts` est le point d'entrée de la commande `claw-pilot dashboard`.
Il initialise la DB, crée le registry, lit le token, puis appelle `startDashboard()`.
Cette tâche ajoute deux comportements :
1. Instancier `SessionStore` et le passer à `startDashboard()`
2. Vérifier qu'un compte admin existe en DB avant de démarrer ; si non, afficher un
   message d'erreur clair et quitter avec exit code 1

## Fichiers concernés

- `src/commands/dashboard.ts` — modifier

## Implémentation détaillée

### 1. Nouveaux imports

```typescript
import { SessionStore } from "../dashboard/session-store.js";
import { constants } from "../lib/constants.js";
```

### 2. Instanciation du SessionStore

Après `const registry = new Registry(db);`, ajouter :

```typescript
const sessionStore = new SessionStore(db, constants.SESSION_TTL_MS);
```

### 3. Vérification de l'admin avant démarrage

Après la lecture/génération du token, ajouter :

```typescript
// Verify admin account exists before starting
const adminExists = db.prepare(
  "SELECT 1 FROM users WHERE username = ? LIMIT 1"
).get(constants.ADMIN_USERNAME);

if (!adminExists) {
  logger.error("No admin account found.");
  logger.info(`Run: claw-pilot auth setup`);
  process.exit(1);
}
```

**Comportement attendu** :
- Première installation sans `auth setup` → message clair, exit 1
- Après `claw-pilot auth setup` → démarrage normal

### 4. Passage du SessionStore à startDashboard

Modifier l'appel à `startDashboard` :

```typescript
// AVANT
await startDashboard({ port, token, registry, conn });

// APRÈS
await startDashboard({ port, token, registry, conn, sessionStore });
```

### 5. Mise à jour du log de démarrage

Le log existant `logger.dim(`Token: ${token.slice(0, 16)}...`)` peut être conservé
(le token Bearer reste fonctionnel pour l'accès programmatique). Optionnel : ajouter
un log indiquant que l'auth par session est active.

## Critères de validation

- [ ] `pnpm typecheck` passe sans erreur
- [ ] `claw-pilot dashboard` sans admin en DB → message d'erreur + exit 1
- [ ] `claw-pilot dashboard` avec admin en DB → démarrage normal
- [ ] `SessionStore` est bien passé à `startDashboard()`

## Dépendances

- Tâche 03 doit être complétée avant (SessionStore)
- Tâche 08 doit être complétée avant (DashboardOptions avec sessionStore)
