# Authentification dashboard — claw-pilot v0.15.0

## Objectif

Ajouter un écran de login obligatoire au dashboard claw-pilot. Remplacer le token injecté
dans le HTML par un système de sessions SQLite avec cookie HttpOnly. Fournir une commande
CLI `claw-pilot auth` pour gérer le compte admin.

**Problème résolu** : aujourd'hui, quiconque atteint le port 19000 obtient le token dans
le HTML servi. Cette feature ajoute une vraie barrière d'authentification.

---

## Tâches

| # | Fichier | Titre | Statut | Dépend de |
|---|---------|-------|--------|-----------|
| 01 | `01-db-migration-v6.md` | Migration DB v6 — tables users et sessions | ✅ completed | — |
| 02 | `02-core-auth-module.md` | Module auth — hashPassword, verifyPassword, generatePassword | ✅ completed | 01 |
| 03 | `03-session-store.md` | SessionStore — CRUD sessions SQLite | ✅ completed | 01 |
| 04 | `04-tests-phase1.md` | Tests unitaires — auth + session store | ✅ completed | 02, 03 |
| 05 | `05-constants-updates.md` | Constantes session et auth dans constants.ts | ✅ completed | — |
| 06 | `06-route-deps-update.md` | Ajouter SessionStore dans RouteDeps | ✅ completed | 03 |
| 07 | `07-auth-routes.md` | Routes auth — login, logout, me | ✅ completed | 02, 03, 05, 06 |
| 08 | `08-server-middleware-update.md` | Middleware dual auth + suppression injection token | ✅ completed | 07 |
| 09 | `09-dashboard-command-update.md` | Commande dashboard — SessionStore + vérif admin | ✅ completed | 03, 08 |
| 10 | `10-tests-phase2.md` | Tests routes auth | ✅ completed | 07, 08 |
| 11 | `11-login-view-component.md` | Composant Lit \<cp-login-view\> | ✅ completed | — |
| 12 | `12-app-auth-gate.md` | Gate d'auth dans app.ts | ✅ completed | 11 |
| 13 | `13-api-401-interceptor.md` | Intercepteur 401 dans api.ts | ✅ completed | — |
| 14 | `14-index-html-cleanup.md` | Supprimer script inline hash-token dans index.html | ✅ completed | 08 |
| 15 | `15-i18n-auth-keys.md` | Clés i18n login (6 langues) | ✅ completed | 11 |
| 16 | `16-auth-cli-command.md` | Commande CLI claw-pilot auth | ✅ completed | 02, 03 |
| 17 | `17-install-sh-update.md` | Mise à jour install.sh — étape auth setup | ✅ completed | 16 |

---

## Ordre d'implémentation recommandé

```
Phase 1 — Fondations backend
  01 → 02 → 03 → 04

Phase 2 — Routes et middleware (parallélisable après phase 1)
  05 (indépendant)
  06 → 07 → 08 → 09
  10 (après 07 + 08)

Phase 3 — Interface frontend (parallélisable avec phase 2)
  11 → 12
  13 (indépendant)
  14 (après 08)
  15 (après 11)

Phase 4 — CLI et installation
  16 → 17
```

---

## Critères de succès globaux

- [ ] `pnpm typecheck` passe sans erreur
- [ ] `pnpm build` (CLI + UI) passe sans erreur
- [ ] `pnpm test:run` passe (tous les tests verts)
- [ ] `claw-pilot auth setup` génère un mot de passe et crée le compte admin en DB
- [ ] `claw-pilot dashboard` refuse de démarrer si aucun admin n'existe en DB
- [ ] Le dashboard affiche la page de login si aucun cookie de session valide
- [ ] Login avec le bon mot de passe → accès au dashboard, cookie `__cp_sid` posé
- [ ] Login avec un mauvais mot de passe → 401, message d'erreur affiché
- [ ] Après 5 tentatives en 1 minute → rate limit 429
- [ ] Logout → cookie supprimé, redirect vers login
- [ ] Expiration de session → redirect automatique vers login
- [ ] Accès programmatique via `Authorization: Bearer <token>` toujours fonctionnel
- [ ] `window.__CP_TOKEN__` n'est plus injecté dans le HTML servi

---

## Références

- Plan complet : `docs/_work/claw-pilot/auth-plan.md`
- Conventions de code : `src/claw-pilot/CLAUDE.md`
- Design UI : `docs/design-rules.md`
- i18n : `docs/i18n.md`
