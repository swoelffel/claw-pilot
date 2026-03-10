# 06. Ajouter SessionStore dans RouteDeps

## Contexte

`src/dashboard/route-deps.ts` définit l'interface `RouteDeps` qui est passée à tous les
modules de routes (`registerInstanceRoutes`, `registerBlueprintRoutes`, etc.). Pour que
les routes auth (tâche 07) puissent accéder au `SessionStore`, il faut l'ajouter à cette
interface. C'est une modification mineure mais nécessaire avant de créer les routes.

## Fichiers concernés

- `src/dashboard/route-deps.ts` — modifier (ajouter `sessionStore` dans l'interface)

## Implémentation détaillée

### Ajout de l'import

Ajouter l'import du type `SessionStore` en tête de fichier :

```typescript
import type { SessionStore } from "./session-store.js";
```

### Modification de l'interface `RouteDeps`

Ajouter le champ `sessionStore` dans l'interface :

```typescript
export interface RouteDeps {
  registry: Registry;
  conn: ServerConnection;
  health: HealthChecker;
  lifecycle: Lifecycle;
  updateChecker: UpdateChecker;
  updater: Updater;
  selfUpdateChecker: SelfUpdateChecker;
  selfUpdater: SelfUpdater;
  tokenCache: TokenCache;
  xdgRuntimeDir: string;
  sessionStore: SessionStore;  // <-- ajouter
}
```

**Note** : `sessionStore` est ajouté comme champ obligatoire (pas optionnel). Cela
signifie que `server.ts` (tâche 08) devra fournir cette valeur lors de la construction
de l'objet `deps`. C'est intentionnel — le `SessionStore` est toujours requis.

## Critères de validation

- [ ] `pnpm typecheck` passe sans erreur
- [ ] L'interface `RouteDeps` contient le champ `sessionStore: SessionStore`
- [ ] Aucune régression sur les routes existantes (elles n'utilisent pas `sessionStore`
  mais TypeScript vérifie que l'objet `deps` dans `server.ts` est complet)

## Dépendances

- Tâche 03 doit être complétée avant (classe `SessionStore` doit exister pour le type)
