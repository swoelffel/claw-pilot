# 16. Commande CLI claw-pilot auth

## Contexte

Cette tâche crée `src/commands/auth.ts`, la commande CLI `claw-pilot auth` avec trois
sous-commandes : `setup`, `reset`, et `check`. Elle suit le pattern `withContext()` du
projet pour l'accès à la DB. La commande est enregistrée dans `src/index.ts`.

`setup` et `reset` sont fonctionnellement identiques (régénérer le mot de passe, invalider
les sessions). `check` est silencieux et retourne exit 0/1 — utilisé par `install.sh`.

## Fichiers concernés

- `src/commands/auth.ts` — créer (nouveau fichier)
- `src/index.ts` — modifier (enregistrer la commande)

## Implémentation détaillée

### `src/commands/auth.ts`

```typescript
import { Command } from "commander";
import { withContext } from "./_context.js";
import { hashPassword, generatePassword } from "../core/auth.js";
import { SessionStore } from "../dashboard/session-store.js";
import { constants } from "../lib/constants.js";
import { logger } from "../lib/logger.js";
```

### Commande principale

```typescript
export function authCommand(): Command {
  const cmd = new Command("auth")
    .description("Manage dashboard authentication");

  cmd.addCommand(setupCommand());
  cmd.addCommand(resetCommand());
  cmd.addCommand(checkCommand());

  return cmd;
}
```

### Sous-commande `setup` (et `reset` comme alias)

```typescript
function setupCommand(): Command {
  return new Command("setup")
    .description("Create or reset the admin account")
    .action(async () => {
      await withContext(async ({ db }) => {
        const password = generatePassword();
        const hash = await hashPassword(password);

        // UPSERT admin user
        db.prepare(`
          INSERT INTO users (username, password_hash, role)
          VALUES (?, ?, 'admin')
          ON CONFLICT(username) DO UPDATE SET
            password_hash = excluded.password_hash,
            updated_at = datetime('now')
        `).run(constants.ADMIN_USERNAME, hash);

        // Get user ID for session cleanup
        const user = db.prepare(
          "SELECT id FROM users WHERE username = ?"
        ).get(constants.ADMIN_USERNAME) as { id: number };

        // Invalidate all existing sessions
        const sessionStore = new SessionStore(db);
        sessionStore.deleteAllForUser(user.id);

        // Log audit event
        db.prepare(`
          INSERT INTO events (instance_id, type, data, created_at)
          VALUES (NULL, 'auth_setup', '{}', datetime('now'))
        `).run();

        // Display password in a box
        displayPasswordBox(password);
      });
    });
}

function resetCommand(): Command {
  return new Command("reset")
    .description("Reset the admin password (alias for setup)")
    .action(async () => {
      // Réutiliser la même logique que setup
      await setupCommand().parseAsync(["setup"], { from: "user" });
    });
}
```

**Note** : pour `reset`, il est plus simple de dupliquer la logique de `setup` ou
d'extraire la logique dans une fonction partagée `runSetup(db)`.

### Affichage du mot de passe

```typescript
function displayPasswordBox(password: string): void {
  const border = "─".repeat(51);
  console.log(`┌${border}┐`);
  console.log(`│  Admin account ready                              │`);
  console.log(`│                                                   │`);
  console.log(`│  Username : admin                                 │`);
  console.log(`│  Password : ${password.padEnd(38)}│`);
  console.log(`│                                                   │`);
  console.log(`│  Save this password — it won't be shown again.   │`);
  console.log(`│  Reset anytime: claw-pilot auth reset             │`);
  console.log(`└${border}┘`);
}
```

### Sous-commande `check`

```typescript
function checkCommand(): Command {
  return new Command("check")
    .description("Exit 0 if admin exists, 1 otherwise (silent)")
    .action(async () => {
      await withContext(async ({ db }) => {
        const exists = db.prepare(
          "SELECT 1 FROM users WHERE username = ? LIMIT 1"
        ).get(constants.ADMIN_USERNAME);

        if (!exists) {
          process.exit(1);
        }
        // exit 0 implicite
      });
    });
}
```

**Important** : `check` est silencieux (pas de console.log). Utilisé dans `install.sh`
pour détecter si un admin existe déjà.

### Enregistrement dans `src/index.ts`

Ajouter l'import et l'enregistrement :

```typescript
import { authCommand } from "./commands/auth.js";
// ...
program.addCommand(authCommand());
```

Placer l'import avec les autres imports de commandes (ordre alphabétique ou logique).
Placer `program.addCommand(authCommand())` après `dashboardCommand()`.

## Critères de validation

- [ ] `pnpm typecheck` passe sans erreur
- [ ] `claw-pilot auth setup` génère un mot de passe et l'affiche dans un encadré
- [ ] `claw-pilot auth setup` crée le user admin en DB (ou met à jour si existant)
- [ ] `claw-pilot auth setup` invalide toutes les sessions existantes
- [ ] `claw-pilot auth reset` a le même comportement que `setup`
- [ ] `claw-pilot auth check` retourne exit 0 si admin existe, exit 1 sinon
- [ ] `claw-pilot auth check` ne produit aucune sortie stdout
- [ ] `claw-pilot auth --help` affiche les sous-commandes disponibles

## Dépendances

- Tâche 02 doit être complétée avant (hashPassword, generatePassword)
- Tâche 03 doit être complétée avant (SessionStore.deleteAllForUser)
