# 14. Supprimer le script inline hash-token dans index.html

## Contexte

`ui/index.html` contient un script inline qui lit le token depuis le hash fragment de
l'URL (`#token=xxx`) et le stocke dans `window.__CP_TOKEN__`. Ce mécanisme était utilisé
pour le login zero-friction via `claw-pilot token <slug> --open`. Avec la nouvelle
authentification par session, le token est obtenu via `GET /api/auth/me` au boot du SPA.
Le script inline n'est plus nécessaire et doit être supprimé.

**Impact sur `claw-pilot token --open`** : la commande `claw-pilot token <slug> --open`
ouvre le Control UI OpenClaw (gateway token), pas le dashboard claw-pilot. Elle n'est
pas affectée par cette suppression.

La suppression du script inline permet également de renforcer la CSP (plus besoin de
`'unsafe-inline'` pour ce script).

## Fichiers concernés

- `ui/index.html` — modifier (supprimer le bloc `<script>` inline)

## Implémentation détaillée

### Supprimer le bloc script inline

Retirer les lignes 7 à 19 du fichier actuel :

```html
<!-- SUPPRIMER ce bloc entier -->
<script>
  // Read token from URL hash: #token=xxx, then clean it from the URL
  (function () {
    var hash = window.location.hash.slice(1);
    var params = new URLSearchParams(hash);
    var token = params.get("token");
    if (token) {
      window.__CP_TOKEN__ = token;
      // Remove token from URL bar to prevent leaking via Referer or browser history
      history.replaceState(null, "", window.location.pathname);
    }
  })();
</script>
```

### Résultat attendu

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Claw Pilot Dashboard</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
    <script type="module" src="/src/app.ts"></script>
  </head>
  <body style="margin:0;background:#0f1117;">
    <cp-app></cp-app>
  </body>
</html>
```

### Optionnel — renforcement CSP

Après suppression du script inline, la CSP dans `server.ts` peut être renforcée en
retirant `'unsafe-inline'` de `script-src`. Vérifier si d'autres scripts inline existent
avant de faire ce changement. Si oui, noter comme amélioration future.

## Critères de validation

- [ ] `pnpm build:ui` passe sans erreur
- [ ] Le fichier `ui/index.html` ne contient plus de bloc `<script>` inline
- [ ] Le dashboard fonctionne toujours (le token est obtenu via `/api/auth/me`)
- [ ] Aucune régression sur les autres fonctionnalités

## Dépendances

- Tâche 08 doit être complétée avant (le serveur ne doit plus injecter le token non plus,
  sinon le HTML servi contiendrait encore le token même si index.html est propre)
