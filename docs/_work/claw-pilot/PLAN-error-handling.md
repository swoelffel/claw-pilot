# Plan — Gestion d'erreurs consistante

**Version** : 1.0
**Date** : 2026-02-26
**Auteur** : Stephane Woelffel (sponsor) / Assistant (redaction)
**Base** : claw-pilot v0.3.0, branche `feature/blueprints`
**Branche** : `feature/blueprints` (continuation)
**Repo** : https://github.com/swoelffel/claw-pilot

> Ce fichier est la copie de reference du plan. Source originale : `.opencode/plans/PLAN-error-handling.md`.

---

## 0. Contexte

L'audit complet de la gestion d'erreurs dans claw-pilot (94 points d'erreur cote
serveur, 11 composants UI, 18 cles i18n existantes) revele 6 problemes systemiques :

| # | Probleme | Impact utilisateur |
|---|----------|-------------------|
| P1 | `apiFetch` affiche le JSON brut (`API error 404: {"error":"Not found"}`) | Message incomprehensible |
| P2 | Composants blueprint : erreurs en anglais sans i18n | UI non traduite |
| P3 | Le serveur ne retourne pas de code d'erreur structure | Le client ne peut pas mapper vers i18n |
| P4 | Aucune correspondance entre erreurs serveur et messages i18n | Impossible de differencier les erreurs |
| P5 | 6 erreurs silencieuses (`console.error` ou ignorees) | Pas de feedback utilisateur |
| P6 | Nommage des variables d'erreur incoherent entre composants | Dette technique |

L'objectif est de mettre en place une chaine d'erreurs consistante de bout en bout :
serveur -> API -> client -> affichage i18n.

---

## 1. Objectifs

| # | Objectif | Mesure de succes |
|---|----------|------------------|
| O1 | L'utilisateur ne voit jamais de JSON brut ou de message technique | Aucun `{"error":...}` visible dans l'UI |
| O2 | Toutes les erreurs sont traduites dans les 6 locales | 0 chaine anglaise en dur dans les catch blocks |
| O3 | Le serveur retourne un code machine exploitable | Toutes les reponses d'erreur ont un champ `code` |
| O4 | Les erreurs silencieuses sont remontees a l'utilisateur | Sauf position save (non-critique, reste en console) |
| O5 | Convention de nommage unique pour les variables d'erreur | Audit automatique possible |

---

## 2. Architecture cible

### 2.1 Format d'erreur API (serveur -> client)

Toutes les reponses d'erreur suivent un format uniforme :

```json
{
  "error": "Human-readable message (EN, for logs/debug)",
  "code": "INVALID_SLUG"
}
```

Le champ `error` est un message anglais descriptif destine aux logs et au debugging.
Le champ `code` est un identifiant machine que le client utilise pour resoudre le
message i18n.

### 2.2 Catalogue de codes d'erreur

20 codes couvrant les 94 points identifies dans l'audit :

| Code | HTTP | Contexte |
|------|------|----------|
| `UNAUTHORIZED` | 401 | Auth middleware, WebSocket |
| `NOT_FOUND` | 404 | Instance, blueprint, agent, fichier introuvable |
| `INVALID_JSON` | 400 | Body JSON mal forme ou absent |
| `INVALID_SLUG` | 400 | Format slug/agent_id invalide (regex) |
| `SLUG_REQUIRED` | 400 | Slug, name, ou agent_id manquant |
| `SLUG_TAKEN` | 409 | Slug, name, ou agent_id deja utilise |
| `FIELD_REQUIRED` | 400 | Champ obligatoire manquant (model, provider, apiKey...) |
| `FIELD_INVALID` | 400 | Valeur invalide (port hors range, x/y non numeriques...) |
| `FILE_NOT_EDITABLE` | 403 | Fichier workspace en lecture seule |
| `FILE_NOT_FOUND` | 404 | Fichier workspace specifique introuvable |
| `AGENT_NOT_FOUND` | 404 | Agent specifique introuvable dans instance/blueprint |
| `PORT_CONFLICT` | 409 | Port deja utilise |
| `SERVER_NOT_INIT` | 500 | Serveur non initialise (run `claw-pilot init`) |
| `SYNC_FAILED` | 500 | Synchronisation agents echouee |
| `PROVISION_FAILED` | 500 | Provisionnement instance echoue |
| `LIFECYCLE_FAILED` | 500 | Start/stop/restart echoue |
| `DESTROY_FAILED` | 500 | Suppression instance echouee |
| `AGENT_CREATE_FAILED` | 500 | Creation agent echouee |
| `AGENT_DELETE_FAILED` | 500 | Suppression agent echouee |
| `FILE_SAVE_FAILED` | 500 | Sauvegarde fichier echouee |
| `LINK_UPDATE_FAILED` | 500 | Mise a jour spawn/a2a links echouee |
| `INTERNAL_ERROR` | 500 | Catch-all pour erreurs inattendues |

### 2.3 Chaine de traitement (flot complet)

```
Serveur (server.ts)
  |  apiError(c, 400, "INVALID_SLUG", "must be 2-30 lowercase...")
  |  -> { "error": "must be 2-30 lowercase...", "code": "INVALID_SLUG" }
  v
Client (api.ts -- apiFetch)
  |  Parse le JSON, extrait code + error
  |  -> throw new ApiError(400, "INVALID_SLUG", "must be 2-30 lowercase...")
  v
Client (lib/error-messages.ts -- userMessage)
  |  Mappe "INVALID_SLUG" -> msg("Must be 2-30 lowercase...", { id: "err-invalid-slug" })
  |  -> string traduite dans la locale courante
  v
Composant UI
  |  this._error = userMessage(err);
  |  -> affichage dans <div class="error-banner">
  v
Utilisateur
  |  Voit : "Doit faire 2-30 caracteres minuscules, chiffres ou tirets" (FR)
```

---

## 3. Implementation

### Niveau 1 -- API structuree (serveur + client)

#### [N1-1] Helper `apiError()` dans `server.ts`

**Fichier** : `src/dashboard/server.ts`

Creer un helper local en debut de `startDashboard()` :

```typescript
function apiError(
  c: Context,
  status: number,
  code: string,
  message: string,
) {
  return c.json({ error: message, code }, status);
}
```

Remplacer les 94 appels `c.json({ error: "..." }, xxx)` par `apiError(c, xxx, "CODE", "...")`.

**Regles de mapping** pour les messages existants :

| Message actuel (serveur) | Code cible |
|--------------------------|-----------|
| `"Unauthorized"` | `UNAUTHORIZED` |
| `"Not found"` | `NOT_FOUND` |
| `"Invalid JSON body"` | `INVALID_JSON` |
| `"Invalid agent_id: must be..."` | `INVALID_SLUG` |
| `"Invalid slug: must be..."` | `INVALID_SLUG` |
| `"name is required"` | `SLUG_REQUIRED` |
| `"agent_id and name are required"` | `FIELD_REQUIRED` |
| `"A blueprint with this name already exists"` | `SLUG_TAKEN` |
| `"An agent with this id already exists..."` | `SLUG_TAKEN` |
| `"content is required"` | `FIELD_REQUIRED` |
| `"content must be a string"` | `FIELD_INVALID` |
| `"targets must be an array..."` | `FIELD_INVALID` |
| `"x and y must be numbers"` | `FIELD_INVALID` |
| `"Invalid id"` | `FIELD_INVALID` |
| `"Invalid port: must be..."` | `FIELD_INVALID` |
| `"defaultModel is required"` | `FIELD_REQUIRED` |
| `"provider is required"` | `FIELD_REQUIRED` |
| `"apiKey must be a string..."` | `FIELD_INVALID` |
| `"File is not editable"` | `FILE_NOT_EDITABLE` |
| `"File not found"` | `FILE_NOT_FOUND` |
| `"Agent not found"` | `AGENT_NOT_FOUND` |
| `"Agent '...' not found in config"` | `AGENT_NOT_FOUND` |
| `"Server not initialized..."` | `SERVER_NOT_INIT` |
| `err.message` ou `"Sync failed"` | `SYNC_FAILED` |
| `err.message` ou `"Provisioning failed"` | `PROVISION_FAILED` |
| `err.message` ou `"Start/Stop/Restart failed"` | `LIFECYCLE_FAILED` |
| `err.message` ou `"Destroy failed"` | `DESTROY_FAILED` |
| `err.message` (catch creation agent) | `AGENT_CREATE_FAILED` |
| `err.message` (catch delete agent) | `AGENT_DELETE_FAILED` |
| `err.message` (catch save file) | `FILE_SAVE_FAILED` |
| `err.message` (catch spawn links) | `LINK_UPDATE_FAILED` |
| Tout autre `err.message`/`String(err)` | `INTERNAL_ERROR` |

Les routes `DELETE /api/instances/:slug/agents/:agentId` et
`PUT .../files/:filename` utilisent actuellement une heuristique fragile basee sur
`msg.includes("not found")` pour determiner le status code. Remplacer par une
detection explicite du type d'erreur :

```typescript
// AVANT (fragile)
const msg = err.message.toLowerCase();
const status = msg.includes("not found") ? 404 : msg.includes("default") ? 409 : 500;

// APRES (explicite)
if (err instanceof InstanceNotFoundError) {
  return apiError(c, 404, "NOT_FOUND", err.message);
}
return apiError(c, 500, "AGENT_DELETE_FAILED", err.message ?? "Agent delete failed");
```

**Effort** : 45 min

---

#### [N1-2] Classe `ApiError` cote client

**Fichier** : `ui/src/lib/api-error.ts` (nouveau)

```typescript
/**
 * Structured error from the claw-pilot API.
 * Carries the HTTP status and a machine-readable error code
 * that the UI maps to a localized user message.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
```

**Effort** : 5 min

---

#### [N1-3] Modifier `apiFetch` pour parser le JSON et throw `ApiError`

**Fichier** : `ui/src/api.ts`

```typescript
// AVANT
if (!res.ok) {
  const text = await res.text().catch(() => res.statusText);
  throw new Error(`API error ${res.status}: ${text}`);
}

// APRES
if (!res.ok) {
  let code = "INTERNAL_ERROR";
  let message = res.statusText;
  try {
    const body = await res.json();
    code = body.code ?? "INTERNAL_ERROR";
    message = body.error ?? res.statusText;
  } catch {
    // Body is not JSON -- keep defaults
  }
  throw new ApiError(res.status, code, message);
}
```

Import `ApiError` en haut du fichier.

**Effort** : 10 min

---

### Niveau 2 -- Mapping i18n cote client

#### [N2-1] Creer `userMessage()` -- resolution code -> i18n

**Fichier** : `ui/src/lib/error-messages.ts` (nouveau)

```typescript
import { msg } from "@lit/localize";
import { ApiError } from "./api-error.js";

/**
 * Resolve an error to a user-facing localized message.
 * - ApiError: maps code -> i18n string
 * - Other errors: generic fallback
 */
export function userMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return resolveCode(err.code);
  }
  return msg("An unexpected error occurred", { id: "err-unknown" });
}

function resolveCode(code: string): string {
  switch (code) {
    case "UNAUTHORIZED":
      return msg("Session expired. Please refresh the page.", { id: "err-unauthorized" });
    case "NOT_FOUND":
      return msg("Resource not found.", { id: "err-not-found" });
    case "INVALID_JSON":
      return msg("Invalid request format.", { id: "err-invalid-json" });
    case "INVALID_SLUG":
      return msg("Must be 2-30 lowercase letters, numbers, or hyphens.", { id: "err-invalid-slug" });
    case "SLUG_REQUIRED":
      return msg("This name is required.", { id: "err-slug-required" });
    case "SLUG_TAKEN":
      return msg("This name is already in use.", { id: "err-slug-taken" });
    case "FIELD_REQUIRED":
      return msg("A required field is missing.", { id: "err-field-required" });
    case "FIELD_INVALID":
      return msg("Invalid field value.", { id: "err-field-invalid" });
    case "FILE_NOT_EDITABLE":
      return msg("This file is read-only.", { id: "err-file-read-only" });
    case "FILE_NOT_FOUND":
      return msg("File not found.", { id: "err-file-not-found" });
    case "AGENT_NOT_FOUND":
      return msg("Agent not found.", { id: "err-agent-not-found" });
    case "PORT_CONFLICT":
      return msg("This port is already in use.", { id: "err-port-conflict" });
    case "SERVER_NOT_INIT":
      return msg("Server not initialized. Run claw-pilot init first.", { id: "err-server-not-init" });
    case "SYNC_FAILED":
      return msg("Agent sync failed. Check server logs.", { id: "err-sync-failed" });
    case "PROVISION_FAILED":
      return msg("Failed to create instance. Check server logs.", { id: "err-provision-failed" });
    case "LIFECYCLE_FAILED":
      return msg("Action failed. Check server logs.", { id: "err-lifecycle-failed" });
    case "DESTROY_FAILED":
      return msg("Failed to delete instance. Check server logs.", { id: "err-destroy-failed" });
    case "AGENT_CREATE_FAILED":
      return msg("Failed to create agent.", { id: "err-agent-create-failed" });
    case "AGENT_DELETE_FAILED":
      return msg("Failed to delete agent.", { id: "err-agent-delete-failed" });
    case "FILE_SAVE_FAILED":
      return msg("Failed to save file.", { id: "err-file-save-failed" });
    case "LINK_UPDATE_FAILED":
      return msg("Failed to update agent links.", { id: "err-link-update-failed" });
    default:
      return msg("An unexpected error occurred", { id: "err-unknown" });
  }
}
```

**Prefixe i18n** : `err-` pour toutes les cles d'erreur (nouveau prefixe dedie).

**Effort** : 15 min

---

#### [N2-2] Ajouter les 22 cles d'erreur dans les 6 locales

**Fichiers** : `ui/src/locales/{en,fr,de,es,it,pt}.ts`

Nouvelles cles (section `// error-messages.ts`) :

| Cle | EN | FR |
|-----|----|----|
| `err-unauthorized` | Session expired. Please refresh the page. | Session expiree. Veuillez rafraichir la page. |
| `err-not-found` | Resource not found. | Ressource introuvable. |
| `err-invalid-json` | Invalid request format. | Format de requete invalide. |
| `err-invalid-slug` | Must be 2-30 lowercase letters, numbers, or hyphens. | Doit faire 2-30 caracteres minuscules, chiffres ou tirets. |
| `err-slug-required` | This name is required. | Ce nom est requis. |
| `err-slug-taken` | This name is already in use. | Ce nom est deja utilise. |
| `err-field-required` | A required field is missing. | Un champ obligatoire est manquant. |
| `err-field-invalid` | Invalid field value. | Valeur de champ invalide. |
| `err-file-read-only` | This file is read-only. | Ce fichier est en lecture seule. |
| `err-file-not-found` | File not found. | Fichier introuvable. |
| `err-agent-not-found` | Agent not found. | Agent introuvable. |
| `err-port-conflict` | This port is already in use. | Ce port est deja utilise. |
| `err-server-not-init` | Server not initialized. Run claw-pilot init first. | Serveur non initialise. Lancez claw-pilot init d'abord. |
| `err-sync-failed` | Agent sync failed. Check server logs. | Synchronisation echouee. Verifiez les logs serveur. |
| `err-provision-failed` | Failed to create instance. Check server logs. | Echec de creation de l'instance. Verifiez les logs serveur. |
| `err-lifecycle-failed` | Action failed. Check server logs. | Action echouee. Verifiez les logs serveur. |
| `err-destroy-failed` | Failed to delete instance. Check server logs. | Echec de suppression. Verifiez les logs serveur. |
| `err-agent-create-failed` | Failed to create agent. | Echec de creation de l'agent. |
| `err-agent-delete-failed` | Failed to delete agent. | Echec de suppression de l'agent. |
| `err-file-save-failed` | Failed to save file. | Echec de la sauvegarde. |
| `err-link-update-failed` | Failed to update agent links. | Echec de mise a jour des liens. |
| `err-unknown` | An unexpected error occurred. | Une erreur inattendue s'est produite. |

Les traductions DE, ES, IT, PT suivront le meme schema.

**Effort** : 20 min

---

#### [N2-3] Remplacer toutes les chaines d'erreur en dur dans les composants

**Patron a appliquer partout** :

```typescript
// AVANT (incoherent -- melange err.message brut + fallback anglais)
catch (err) {
  this._error = err instanceof Error ? err.message : "Failed to create agent";
}

// APRES (uniforme)
catch (err) {
  this._error = userMessage(err);
}
```

**Composants impactes** (11 fichiers) :

| Composant | Fichier | Catch blocks a modifier |
|-----------|---------|------------------------|
| `cp-cluster-view` | `cluster-view.ts` | 1 (`_load`) |
| `cp-instance-card` | `instance-card.ts` | 1 (`_action`) |
| `cp-instance-detail` | `instance-detail.ts` | 3 (`_load`, `_action`, `_confirmDelete`) |
| `cp-create-dialog` | `create-dialog.ts` | 3 (`_loadNextPort`, `_loadProviders`, `_submit`) |
| `cp-agents-builder` | `agents-builder.ts` | 1 (`_syncAndLoad`) |
| `cp-agent-detail-panel` | `agent-detail-panel.ts` | 1 (`_saveFile`) |
| `cp-create-agent-dialog` | `create-agent-dialog.ts` | 1 (`_submit`) |
| `cp-delete-agent-dialog` | `delete-agent-dialog.ts` | 1 (`_submit`) |
| `cp-blueprints-view` | `blueprints-view.ts` | 2 (`_load`, `_onBlueprintDelete`) |
| `cp-create-blueprint-dialog` | `create-blueprint-dialog.ts` | 1 (`_submit`) |
| `cp-blueprint-builder` | `blueprint-builder.ts` | 3 (`_load`, `_deleteAgent`, `_createAgent`) |

**Total** : 18 catch blocks modifies.

Import a ajouter dans chaque fichier :

```typescript
import { userMessage } from "../lib/error-messages.js";
```

**Note sur les validations client pre-API** : les validations dans `_validateSlug()`
de `create-dialog.ts` et `create-agent-dialog.ts` restent inchangees -- elles utilisent
deja `msg()` avec leurs propres cles i18n specifiques au contexte du formulaire. Ce sont
des validations synchrones cote client, pas des erreurs API.

**Effort** : 30 min

---

### Niveau 3 -- Erreurs silencieuses + coherence

#### [N3-1] Afficher les erreurs actuellement silencieuses

**3 cas identifies lors de l'audit** :

| Composant | Erreur silencieuse actuelle | Fix propose |
|-----------|---------------------------|-------------|
| `agent-detail-panel.ts` | Spawn link save -> `console.error` (~l.886) | Ajouter `_error` affiche dans le panel info |
| `agent-detail-panel.ts` | File load echec -> ignore (~l.743) | Afficher `adp-file-not-available` (cle existante) |
| `agents-builder.ts` / `blueprint-builder.ts` | Position save -> `console.error` | **Garder en `console.error`** -- evenement frequent (drag), UX degradee si erreur affichee |

**Seules les 2 premieres justifient un fix.**

Pour `agent-detail-panel.ts`, spawn link save :

```typescript
// AVANT
} catch (err) {
  console.error("Failed to save spawn links:", err);
}

// APRES
} catch (err) {
  this._error = userMessage(err);
}
```

Pour `agent-detail-panel.ts`, file load :

```typescript
// AVANT
} catch {
  // silently ignored
}

// APRES
} catch {
  this._fileContent = null;
  // Le template affiche deja adp-file-not-available quand _fileContent est null
}
```

**Effort** : 10 min

---

#### [N3-2] Normaliser le nommage des variables d'erreur

**Convention unique** :

| Variable | Usage | Contexte |
|----------|-------|---------|
| `_error` | Erreur principale (load, action globale, save) | Tous les composants |
| `_submitError` | Erreur de soumission d'un formulaire | Dialogs uniquement |
| `_slugError` (ou `_xxxError`) | Erreur de validation d'un champ specifique | Formulaires -- inchange |

**Renommages necessaires** :

| Composant | Variable actuelle | Variable cible |
|-----------|------------------|---------------|
| `instance-detail.ts` | `_actionError` | `_error` |
| `instance-detail.ts` | `_deleteError` | `_error` |
| `blueprint-builder.ts` | `_createError` | `_submitError` |
| `agent-detail-panel.ts` | `_fileSaveError` | `_error` |

Pour `instance-detail.ts`, les 3 variables (`_error`, `_actionError`, `_deleteError`)
sont mutuellement exclusives dans l'UI -- une seule est affichee a la fois.
Fusionner en une seule `_error` avec reset avant chaque operation :

```typescript
// AVANT
@state() private _error = "";
@state() private _actionError = "";
@state() private _deleteError = "";

// APRES
@state() private _error = "";
```

Chaque action efface l'erreur precedente : `this._error = "";` en debut de methode.

**Effort** : 20 min

---

## 4. Cles i18n existantes depreciees

Les 18 cles d'erreur existantes dans les locales peuvent etre conservees ou supprimees :

**A conserver** (utilisees dans les validations client pre-API) :
- `error-slug-required`, `error-slug-format`, `error-slug-length` (create-dialog)
- `cad-error-slug-required`, `cad-error-slug-invalid`, `cad-error-slug-taken` (create-agent-dialog)

**A supprimer** (remplacees par les cles `err-*`) :
- `error-load-instances` -> `err-not-found` ou `err-unknown`
- `action-failed`, `action-failed-detail` -> `err-lifecycle-failed`
- `failed-load-instance` -> `err-not-found`
- `delete-failed` -> `err-destroy-failed`
- `error-fetch-port` -> `err-unknown`
- `error-load-providers` -> `err-unknown`
- `error-provisioning` -> `err-provision-failed`
- `ab-error-load` -> `err-unknown`
- `cad-error-create` -> `err-agent-create-failed`
- `dad-error-delete` -> `err-agent-delete-failed`

Ces cles ne seront pas supprimees immediatement pour eviter toute regression. Elles
seront marquees comme depreciees (commentaire) et nettoyees dans une passe ulterieure.

---

## 5. Fichiers impactes

| Fichier | Type | Changement |
|---------|------|-----------|
| `src/dashboard/server.ts` | Modifie | Helper `apiError()` + refactorer les 94 points d'erreur |
| `ui/src/lib/api-error.ts` | **Nouveau** | Classe `ApiError` |
| `ui/src/lib/error-messages.ts` | **Nouveau** | Mapping code -> `msg()` i18n |
| `ui/src/api.ts` | Modifie | `apiFetch` parse JSON + throw `ApiError` |
| `ui/src/locales/en.ts` | Modifie | +22 cles `err-*` |
| `ui/src/locales/fr.ts` | Modifie | +22 cles `err-*` |
| `ui/src/locales/de.ts` | Modifie | +22 cles `err-*` |
| `ui/src/locales/es.ts` | Modifie | +22 cles `err-*` |
| `ui/src/locales/it.ts` | Modifie | +22 cles `err-*` |
| `ui/src/locales/pt.ts` | Modifie | +22 cles `err-*` |
| `ui/src/components/cluster-view.ts` | Modifie | `userMessage(err)` |
| `ui/src/components/instance-card.ts` | Modifie | `userMessage(err)` |
| `ui/src/components/instance-detail.ts` | Modifie | Fusion variables + `userMessage(err)` |
| `ui/src/components/create-dialog.ts` | Modifie | `userMessage(err)` |
| `ui/src/components/agents-builder.ts` | Modifie | `userMessage(err)` |
| `ui/src/components/agent-detail-panel.ts` | Modifie | `userMessage(err)` + erreurs silencieuses |
| `ui/src/components/create-agent-dialog.ts` | Modifie | `userMessage(err)` |
| `ui/src/components/delete-agent-dialog.ts` | Modifie | `userMessage(err)` |
| `ui/src/components/blueprints-view.ts` | Modifie | `userMessage(err)` |
| `ui/src/components/create-blueprint-dialog.ts` | Modifie | `userMessage(err)` |
| `ui/src/components/blueprint-builder.ts` | Modifie | `userMessage(err)` + renommage |

**Total** : 21 fichiers (2 nouveaux, 19 modifies)

---

## 6. Ordre d'execution

L'implementation suit une progression bottom-up : serveur d'abord (source de verite),
puis couche client, puis composants UI.

```
Etape 1 -- Serveur                                   ~45 min
  [N1-1] Helper apiError() + refactorer 94 points

Etape 2 -- Client (couche API)                       ~15 min
  [N1-2] Classe ApiError (nouveau fichier)
  [N1-3] Modifier apiFetch

Etape 3 -- Client (couche i18n)                      ~35 min
  [N2-1] Creer userMessage() (nouveau fichier)
  [N2-2] Ajouter 22 cles dans les 6 locales

Etape 4 -- Composants UI                             ~50 min
  [N2-3] Remplacer 18 catch blocks dans 11 composants
  [N3-1] Fix 2 erreurs silencieuses
  [N3-2] Renommer 4 variables d'erreur

Etape 5 -- Validation                                ~15 min
  pnpm typecheck
  pnpm test:run (95/95 doivent passer)
  pnpm build
  Deploiement VM01
  Test manuel : creer un agent avec ID invalide -> message traduit
```

**Effort total estime** : ~2h40

---

## 7. Points d'attention

### Retrocompatibilite API

L'ajout du champ `code` dans les reponses d'erreur est non-breaking : les clients
existants qui lisent `body.error` continuent de fonctionner. Le champ `code` est
additif.

### Erreurs avec contexte dynamique

Certaines erreurs serveur incluent des valeurs dynamiques (`Instance "foo" not found`,
`Port 18789 is already in use`). Le champ `error` conserve le message anglais complet
(utile pour les logs). Le champ `code` permet au client de resoudre un message i18n
generique sans la valeur dynamique.

Si a l'avenir on veut des messages i18n parametres (`"Le port {port} est deja utilise"`),
le serveur pourra ajouter un champ optionnel `params`:
```json
{ "error": "Port 18789 is already in use", "code": "PORT_CONFLICT", "params": { "port": 18789 } }
```
Ce n'est pas dans le scope de ce plan mais l'architecture le permet.

### Validation client vs validation serveur

Les validations synchrones cote client (`_validateSlug()` dans les formulaires) restent
la premiere ligne de defense. Elles interceptent les erreurs **avant** l'appel API et
utilisent leurs propres cles i18n specifiques au contexte du formulaire (ex: `cad-error-slug-invalid`).

La couche `userMessage()` traite les erreurs **apres** l'appel API -- c'est un filet de
securite pour les cas ou la validation client a ete contournee ou pour les erreurs
purement serveur (conflit, race condition...).

Les deux couches coexistent. La validation client donne des messages plus contextuels,
la couche API donne des messages generiques mais toujours traduits.

---

*Mis a jour : 2026-02-26 - v1.0 : Creation initiale -- plan gestion d'erreurs consistante*
