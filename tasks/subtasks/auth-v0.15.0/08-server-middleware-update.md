# 08. Middleware dual auth + suppression injection token dans server.ts

## Contexte

`src/dashboard/server.ts` contient le middleware d'authentification actuel (Bearer token
uniquement) et la fonction `serveIndex()` qui injecte `window.__CP_TOKEN__` dans le HTML.
Cette tâche modifie ces deux éléments :
1. Remplacer le middleware Bearer-only par un dual auth (cookie session EN PREMIER, Bearer
   en fallback)
2. Supprimer l'injection du token dans le HTML
3. Enregistrer les routes auth AVANT le middleware (pour que `/api/auth/login` soit public)
4. Instancier le `SessionStore` et démarrer le cleanup périodique

## Fichiers concernés

- `src/dashboard/server.ts` — modifier

## Implémentation détaillée

### 1. Nouveaux imports

```typescript
import { getCookie } from "hono/cookie";
import { SessionStore } from "./session-store.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { constants } from "../lib/constants.js";
```

### 2. Mise à jour de `DashboardOptions`

```typescript
export interface DashboardOptions {
  port: number;
  token: string;
  registry: Registry;
  conn: ServerConnection;
  sessionStore: SessionStore;  // <-- ajouter
}
```

### 3. Instanciation dans `startDashboard()`

```typescript
const { port, token, registry, conn, sessionStore } = options;
```

### 4. Démarrage du cleanup périodique

Après la création des instances (health, lifecycle, etc.), ajouter :

```typescript
// Periodic session cleanup (every 60s)
const cleanupInterval = setInterval(() => {
  const deleted = sessionStore.cleanup();
  if (deleted > 0) {
    // Optionnel : logger en debug
  }
}, constants.SESSION_CLEANUP_INTERVAL_MS);
// Note: l'interval n'est pas clearé car le process tourne indéfiniment
```

### 5. Enregistrement des routes auth AVANT le middleware

Ajouter AVANT le middleware auth existant (ligne ~102) :

```typescript
// Auth routes — public (no auth required)
registerAuthRoutes(app, deps, token);
```

**Important** : cet appel doit être AVANT `app.use("/api/*", async (c, next) => { ... auth ... })`.

### 6. Remplacement du middleware auth

Remplacer le bloc actuel :

```typescript
// AVANT (supprimer)
const expectedBearer = `Bearer ${token}`;
app.use("/api/*", async (c, next) => {
  const auth = c.req.header("Authorization") ?? "";
  if (!safeTokenCompare(auth, expectedBearer)) {
    return apiError(c, 401, "UNAUTHORIZED", "Unauthorized");
  }
  await next();
});
```

Par :

```typescript
// APRÈS
const expectedBearer = `Bearer ${token}`;
const PUBLIC_ROUTES = ["/api/auth/login"];

app.use("/api/*", async (c, next) => {
  // Skip auth for public routes
  if (PUBLIC_ROUTES.some((r) => c.req.path === r)) {
    return next();
  }

  // 1. Try session cookie (priority)
  const sid = getCookie(c, constants.SESSION_COOKIE_NAME);
  if (sid) {
    const session = sessionStore.validate(sid);
    if (session) {
      c.set("userId", session.userId);
      c.set("sessionId", session.id);
      return next();
    }
  }

  // 2. Fallback: Bearer token (backward compat + programmatic access)
  const auth = c.req.header("Authorization") ?? "";
  if (safeTokenCompare(auth, expectedBearer)) {
    return next();
  }

  return apiError(c, 401, "UNAUTHORIZED", "Unauthorized");
});
```

### 7. Suppression de l'injection token dans `serveIndex()`

Remplacer la fonction `serveIndex` :

```typescript
// AVANT (supprimer)
const serveIndex = async () => {
  const indexPath = path.join(UI_DIST, "index.html");
  let html = await fs.readFile(indexPath, "utf-8");
  const injection = `<script>window.__CP_TOKEN__=${JSON.stringify(token)};</script>`;
  html = html.replace("</head>", `${injection}\n</head>`);
  return html;
};

// APRÈS
const serveIndex = async () => {
  const indexPath = path.join(UI_DIST, "index.html");
  return fs.readFile(indexPath, "utf-8");
};
```

### 8. Mise à jour de l'objet `deps`

```typescript
const deps: RouteDeps = {
  registry, conn, health, lifecycle, updateChecker, updater,
  selfUpdateChecker, selfUpdater, tokenCache, xdgRuntimeDir,
  sessionStore,  // <-- ajouter
};
```

**Note** : `registerAuthRoutes` est appelé AVANT la construction de `deps` (car il a
besoin de `sessionStore` directement, pas via `deps`). Ajuster l'ordre si nécessaire,
ou passer `sessionStore` directement à `registerAuthRoutes`.

## Critères de validation

- [ ] `pnpm typecheck` passe sans erreur
- [ ] `POST /api/auth/login` est accessible sans token (route publique)
- [ ] `GET /api/instances` avec cookie valide → 200 (auth via cookie)
- [ ] `GET /api/instances` avec Bearer token → 200 (auth via Bearer, fallback)
- [ ] `GET /api/instances` sans auth → 401
- [ ] Le HTML servi ne contient plus `window.__CP_TOKEN__`
- [ ] Le cleanup périodique démarre au lancement du dashboard

## Dépendances

- Tâche 07 doit être complétée avant (registerAuthRoutes)
