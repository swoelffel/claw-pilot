# 15. Clés i18n login — 6 langues

## Contexte

Le projet utilise `@lit/localize` en mode runtime avec 6 langues : `en` (source), `fr`,
`de`, `es`, `it`, `pt`. Les fichiers de locale sont dans `ui/src/locales/`. Chaque
composant localisé utilise `msg("...", { id: "..." })` et le décorateur `@localized()`.

Cette tâche ajoute les clés de traduction pour le composant `<cp-login-view>` (tâche 11)
et les nouvelles strings de `app.ts` (tâche 12) dans les 6 fichiers de locale.

Convention d'ID : préfixe `login-` pour les strings de `login-view.ts`, pas de préfixe
pour les strings globales de `app.ts` (cohérent avec les conventions existantes).

## Fichiers concernés

- `ui/src/locales/en.ts` — modifier (ajouter les nouvelles clés)
- `ui/src/locales/fr.ts` — modifier
- `ui/src/locales/de.ts` — modifier
- `ui/src/locales/es.ts` — modifier
- `ui/src/locales/it.ts` — modifier
- `ui/src/locales/pt.ts` — modifier

## Implémentation détaillée

### Clés à ajouter

Les clés suivantes doivent être ajoutées à la fin de chaque fichier de locale,
dans une section commentée `// login-view.ts + app.ts (auth)` :

| ID | EN (source) | FR | DE | ES | IT | PT |
|----|-------------|----|----|----|----|-----|
| `login-title` | `claw-pilot` | `claw-pilot` | `claw-pilot` | `claw-pilot` | `claw-pilot` | `claw-pilot` |
| `login-label-username` | `Username` | `Nom d'utilisateur` | `Benutzername` | `Usuario` | `Nome utente` | `Nome de utilizador` |
| `login-label-password` | `Password` | `Mot de passe` | `Passwort` | `Contraseña` | `Password` | `Palavra-passe` |
| `login-btn-submit` | `Sign in` | `Se connecter` | `Anmelden` | `Iniciar sesión` | `Accedi` | `Entrar` |
| `login-error-invalid-creds` | `Invalid credentials` | `Identifiants incorrects` | `Ungültige Anmeldedaten` | `Credenciales incorrectas` | `Credenziali non valide` | `Credenciais inválidas` |
| `login-error-generic` | `An error occurred. Please try again.` | `Une erreur est survenue. Veuillez réessayer.` | `Ein Fehler ist aufgetreten. Bitte versuchen Sie es erneut.` | `Se produjo un error. Por favor, inténtelo de nuevo.` | `Si è verificato un errore. Riprova.` | `Ocorreu um erro. Por favor, tente novamente.` |
| `login-session-expired` | `Your session has expired. Please sign in again.` | `Votre session a expiré. Veuillez vous reconnecter.` | `Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.` | `Su sesión ha expirado. Por favor, inicie sesión de nuevo.` | `La sessione è scaduta. Effettua nuovamente l'accesso.` | `A sua sessão expirou. Por favor, inicie sessão novamente.` |
| `app-btn-logout` | `Sign out` | `Se déconnecter` | `Abmelden` | `Cerrar sesión` | `Esci` | `Sair` |

### Format d'ajout dans chaque fichier

Les fichiers de locale exportent un objet `templates`. Ajouter les clés à la fin :

```typescript
// login-view.ts + app.ts (auth)
"login-title": "claw-pilot",
"login-label-username": "Username",
"login-label-password": "Password",
"login-btn-submit": "Sign in",
"login-error-invalid-creds": "Invalid credentials",
"login-error-generic": "An error occurred. Please try again.",
"login-session-expired": "Your session has expired. Please sign in again.",
"app-btn-logout": "Sign out",
```

(Adapter les valeurs pour chaque langue selon le tableau ci-dessus.)

**Note** : `en.ts` est le fichier source (commentaire en tête : "English source strings —
reference only"). Les autres fichiers contiennent les traductions.

## Critères de validation

- [ ] `pnpm build:ui` passe sans erreur TypeScript
- [ ] Les 8 clés sont présentes dans les 6 fichiers de locale
- [ ] Les IDs correspondent exactement aux `msg()` calls dans `login-view.ts` et `app.ts`
- [ ] Aucune clé existante n'est modifiée ou supprimée

## Dépendances

- Tâche 11 doit être complétée avant (pour connaître les IDs exacts utilisés dans le composant)
