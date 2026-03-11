# UX Design — claw-pilot

Référence visuelle et comportementale de tous les écrans et composants de l'application.
Sert de base d'échange pour les évolutions d'interface.

> **Composants source** : `ui/src/components/`  
> **Styles partagés** : `ui/src/styles/tokens.ts` + `ui/src/styles/shared.ts`  
> **Stack** : Lit web components, dark theme, CSS custom properties  
> **Captures de référence** : `screen1.png` (Constructeur d'agents), `screen2.png` (Vue Instances)

---

## Tokens de style globaux

| Token | Valeur approximative | Usage |
|---|---|---|
| `--bg-base` | `#0f1117` | Fond de page |
| `--bg-surface` | `#111827` | Cards, panels, dialogs |
| `--bg-border` | `#1f2937` | Bordures |
| `--bg-hover` | `#1a1d27` | Hover sur items |
| `--text-primary` | `#f9fafb` | Titres, valeurs importantes |
| `--text-secondary` | `#9ca3af` | Corps de texte |
| `--text-muted` | `#6b7280` | Labels, métadonnées |
| `--font-mono` | `JetBrains Mono`, `monospace` | Valeurs techniques |
| `--accent` | `#4f6ef7` | Bleu principal (CTA, sélection) |
| `--accent-subtle` | `rgba(79,110,247,0.08)` | Fond accent léger |
| `--accent-border` | `rgba(79,110,247,0.25)` | Bordure accent |
| `--state-success` | `#22c55e` | Running, succès |
| `--state-error` | `#ef4444` | Erreur, danger |
| `--state-warning` | `#f59e0b` | Ambre — bouton UI |
| `--state-info` | `#0ea5e9` | Cyan — bouton Agents |
| `--radius-sm` | `4px` | Badges, petits éléments |
| `--radius-md` | `6px` | Boutons, inputs |
| `--radius-lg` | `10px` | Cards, dialogs |

---

## Routing hash-based

Depuis v0.7.1, la navigation utilise des hash URLs (`#/...`). Le browser back/forward et le refresh de page fonctionnent correctement.

| Hash URL | Vue rendue |
|---|---|
| `#/` ou `#/instances` | Vue Instances (accueil) |
| `#/instances/:slug/builder` | Constructeur d'agents |
| `#/instances/:slug/settings` | Settings instance |
| `#/blueprints` | Vue Blueprints |
| `#/blueprints/:id/builder` | Blueprint Builder |

La navigation entre vues émet des événements `navigate { view, slug?, blueprintId? }` capturés par `app.ts`, qui met à jour le hash URL et rend le composant correspondant.

---

## Navigation globale (`app.ts`)

Barre de navigation fixe en haut de page.

```
┌─────────────────────────────────────────────────────────────────┐
│  ClawPilot   Instances [2]   Blueprints [3]       ● En direct   │
└─────────────────────────────────────────────────────────────────┘
```

| Élément | Description |
|---|---|
| **Logo** | "ClawPilot" — lien vers la vue Instances |
| **Instances** | Onglet avec badge numérique (nombre d'instances chargées) |
| **Blueprints** | Onglet vers la vue Blueprints. Badge numérique affiché si au moins 1 blueprint existe (nombre de blueprints chargés). Le badge n'est pas affiché si aucun blueprint ou si la vue Blueprints n'a pas encore été visitée. |
| **Indicateur WS** | Point vert + "En direct" si WebSocket connecté, gris + "Hors ligne" sinon |

**Footer** : `ClawPilot v0.14.x` | GitHub | Signaler un bug | Sélecteur de langue | © SWO — Licence MIT

### Bannière update claw-pilot (`cp-self-update-banner`)

Composant `<cp-self-update-banner>` affiché **en haut du `<main>`**, au-dessus de toutes les vues (cluster, blueprints, settings…). Wrapper léger autour de `<cp-update-banner-base>`.

```
┌─────────────────────────────────────────────────────────────────┐
│  ┌─ Bannière update claw-pilot (conditionnelle) ──────────────┐ │
│  │  ↑ claw-pilot update available  v0.12.0   [Update claw-pilot]│ │
│  └─────────────────────────────────────────────────────────────┘ │
│  [nav header]                                                   │
│  [contenu de la vue active]                                     │
└─────────────────────────────────────────────────────────────────┘
```

| État | Style | Contenu |
|---|---|---|
| **idle + updateAvailable** | Ambre (`--state-warning`) | "claw-pilot update available vX.Y.Z" + version courante + bouton **[Update claw-pilot]** |
| **running** | Cyan (`--state-info`) | Spinner + "Updating claw-pilot…" + "This may take several minutes (git + build)" |
| **done** | Vert (`--state-running`) | "claw-pilot updated → vX.Y.Z" + "Dashboard service restarted" + bouton **[×]** (dismiss) |
| **error** | Rouge (`--state-error`) | "claw-pilot update failed" + message d'erreur + bouton **[Retry]** |

**Polling** : check immédiat au démarrage + toutes les 60s. Accéléré à 3s pendant `status === "running"`.

**Post-done** : `location.reload()` automatique après 2s (charge le nouveau bundle JS). Si le reload n'arrive pas (restart lent, problème réseau), le bouton **×** permet de fermer manuellement le bandeau.

**Événement** : le bouton Update/Retry émet `cp-update-action` (bubbles + composed) → capturé par `cp-app` via `@cp-update-action` sur `<main>`.

**Source de version** : GitHub Releases API (`/repos/swoelffel/claw-pilot/releases/latest`). Comparaison semver standard.

---

## Composant partagé : Bannière de mise à jour (`cp-update-banner-base`)

**Fichier source** : `ui/src/components/update-banner-base.ts`

Composant Lit de base factorisant le CSS et la structure HTML des deux bandeaux de mise à jour (OpenClaw et claw-pilot). Non utilisé directement — instancié via les wrappers `cp-update-banner` et `cp-self-update-banner`.

### Props

| Prop | Type | Description |
|---|---|---|
| `status` | `OpenClawUpdateStatus \| SelfUpdateStatus \| null` | Statut de mise à jour passé par le wrapper |
| `productName` | `string` | Nom du produit affiché dans les messages (ex: `"OpenClaw"`, `"claw-pilot"`) |
| `buttonLabel` | `string` | Label du bouton d'action (état idle+updateAvailable) |
| `runningSubtitle` | `string` | Sous-titre affiché pendant l'état running |
| `doneSubtitle` | `string` | Sous-titre affiché après succès (état done) |
| `dismissable` | `boolean` | Si `true`, affiche un bouton × sur l'état done |

### Événements émis

| Événement | Condition | Description |
|---|---|---|
| `cp-update-action` | Clic Update ou Retry | Bubbles + composed. Capturé par le wrapper qui le re-émet. |
| `cp-update-dismiss` | Clic × (si dismissable) | Bubbles + composed. Dismiss local (état `_dismissed`). |

### Comportement dismiss

- L'état `_dismissed` est local au composant (propriété `@state`).
- Il se reset automatiquement si `status` change (nouveau cycle de mise à jour).
- Le dismiss est purement visuel — aucun appel API.

### Design system

Mêmes tokens que le reste de l'application :

| État | Couleur | Token |
|---|---|---|
| warning (update dispo) | Ambre | `--state-warning` (#f59e0b) |
| info (en cours) | Cyan | `--state-info` (#0ea5e9) |
| success (done) | Vert | `--state-running` (#10b981) |
| error | Rouge | `--state-error` (#ef4444) |

Spinner : `border: 2px solid currentColor`, `border-top-color: transparent`, `animation: spin 0.7s linear infinite`.  
Tags de version : `font-family: var(--font-mono)`, `font-size: 12px`, `font-weight: 600`.

---

## Écran 1 — Vue Instances (`cp-cluster-view`)

**Fichier source** : `ui/src/components/cluster-view.ts`  
**Capture de référence** : `screen2.png`

Page d'accueil. Grille de cards d'instances.

```
┌─────────────────────────────────────────────────────────────────┐
│  ┌─ Bannière update (conditionnelle) ──────────────────────────┐ │
│  │  ↑ OpenClaw update available  v2026.3.1   [Update all]      │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  2 instances                          [+ Nouvelle instance]     │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐                    │
│  │  Instance Card   │  │  Instance Card   │                    │
│  └──────────────────┘  └──────────────────┘                    │
└─────────────────────────────────────────────────────────────────┘
```

### États

| État | Rendu |
|---|---|
| **Chargement** | Texte centré "Loading instances..." (early return — header non affiché) |
| **Erreur** | Bandeau d'erreur rouge en haut, grille vide |
| **Vide** | Icône + "No instances found" centré + bouton **[Discover instances]** |
| **Normal** | Bannière update (si applicable) + grille `auto-fill minmax(300px, 1fr)`, gap 16px |

**État vide — détail :**

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                    ▪                                            │
│              No instances found                                 │
│                                                                 │
│              [Discover instances]                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Le bouton **[Discover instances]** (`btn btn-secondary`) ouvre le dialog `cp-discover-dialog` qui scanne le système à la recherche d'instances OpenClaw existantes et propose de les adopter.

### Bannière update OpenClaw (`cp-update-banner`)

Composant `<cp-update-banner>` affiché en haut de la vue, avant le header de section. Invisible si pas d'update et pas de job actif.

Wrapper léger autour de `<cp-update-banner-base>` (voir section dédiée ci-dessous).

| État | Style | Contenu |
|---|---|---|
| **idle + updateAvailable** | Ambre (`--state-warning`) | "OpenClaw update available vX.Y.Z" + version courante + bouton **[Update all instances]** |
| **running** | Cyan (`--state-info`) | Spinner + "Updating OpenClaw…" + "This may take up to 60 seconds" |
| **done** | Vert (`--state-running`) | "OpenClaw updated → vX.Y.Z" + message (ex: "All instances restarted") |
| **error** | Rouge (`--state-error`) | "OpenClaw update failed" + message d'erreur + bouton **[Retry]** |

**Polling** : pendant `status === "running"`, `cluster-view` poll `fetchUpdateStatus()` toutes les 2s. À la transition vers `done`, recharge la liste des instances.

**Événement** : le bouton Update/Retry émet `cp-update-action` (bubbles + composed) → capturé par `cluster-view` qui appelle `triggerUpdate()`.

**Pas de dismiss manuel** — le bandeau disparaît automatiquement quand `updateAvailable === false && status === "idle"`.

### Interactions

- **Clic sur une card** → navigation vers la Vue Détail de l'instance
- **Bouton "+ Nouvelle instance"** → ouvre le Dialog de création (`cp-create-dialog`)
- Après création : ferme le dialog + recharge la liste

---

## Composant : Instance Card (`cp-instance-card`)

**Fichier source** : `ui/src/components/instance-card.ts`

```
┌────────────────────────────────────────────┐
│  Mon instance          ● RUNNING [Stop] ···│  ← header
│  default                                   │
├────────────────────────────────────────────┤
│  ◉ Gateway  ✈ @my_bot  ⬡ 11 agents        │  ← status bar
├────────────────────────────────────────────┤
│  anthropic/claude-sonnet-4-5               │  ← modèle
│  :18789                  openclaw v2026.3.1│  ← technique
│                                            │
│  (message d'erreur si échec)               │  ← erreur conditionnelle
└────────────────────────────────────────────┘
```

### Hiérarchie typographique

| Élément | Taille | Poids | Couleur |
|---|---|---|---|
| `display_name` (ou slug si absent) | 16px | 700 | `--text-primary` |
| `slug` (si display_name défini) | 11px | 400 | `--text-muted`, monospace |
| Modèle | 13px | 400 | `--text-secondary`, monospace |
| Port / version | 11px | 400 | `--text-muted`, monospace |

### Zone 1 — Header

Flex row `justify-content: space-between`, `gap: 10px`.

**Côté gauche :**

| Élément | Description |
|---|---|
| **display_name** | `font-size: 16px`, `font-weight: 700`, `--text-primary`. Si `display_name` est null, affiche le slug à la place avec le même style. |
| **slug** *(conditionnel)* | `font-size: 11px`, `--text-muted`, monospace, `margin-top: 2px`. Affiché uniquement si `display_name` est défini. |

**Côté droit** (`card-header-right`, flex row `gap: 8px`) :

| Élément | Description |
|---|---|
| **Badge état** | Pill coloré avec point lumineux + label. Voir états ci-dessous. |
| **Bouton Start/Stop** | Bouton unique toggle. "Start" (style `btn-start` vert) si non running, "Stop" (style `btn-stop` rouge) si running. Disabled pendant `_loading`. |
| **Bouton `···`** | Bouton menu 28×28px. Ouvre le popover d'actions au clic. Classe `open` quand actif. |

**États du badge :**

| État | Couleur |
|---|---|
| `running` | Vert `--state-running` |
| `stopped` | Gris `--text-muted` |
| `error` | Rouge `--state-error` |
| `unknown` | Gris |

### Zone 2 — Status bar

Flex row, `gap: 10px`, séparée du header et du meta par des bordures `--bg-border`. Masquée si aucun indicateur à afficher.

| Indicateur | Condition | Style |
|---|---|---|
| `◉ Gateway` | `state === "running"` ET `gateway === "healthy"` | Vert `--state-running` |
| `◎ Gateway KO` | `state === "running"` ET `gateway === "unhealthy"` | Rouge `--state-error` |
| `✈ @bot` | `telegram_bot` défini ET `telegram !== "disconnected"` | Pill bleu `#0088cc` |
| `✈ @bot ⚠` | `telegram_bot` défini ET `telegram === "disconnected"` | Pill ambre `--state-warning` |
| `⬡ N agent(s)` | `agentCount > 0` | Texte `--text-muted` |
| `⚠ N device(s)` | `pendingDevices > 0` | Pill ambre cliquable → `navigate { view: "instance-settings", section: "devices" }` |

### Zone 3 — Meta

Colonne flex, `gap: 4px`.

| Champ | Condition | Style |
|---|---|---|
| **Modèle** | Si `default_model` défini. Résolution intelligente : si JSON `{"primary":"..."}`, extrait la clé `primary`. | `font-size: 13px`, `--text-secondary`, monospace |
| **Port** | Toujours. | `font-size: 11px`, `--text-muted`, monospace |
| **openclaw vX.Y.Z** | Si prop `openclawVersion` définie (injectée par `cluster-view`). Aligné à droite sur la même ligne que le port. | `font-size: 11px`, `--text-muted`, monospace |

### Zone 4 — Erreur *(conditionnelle)*

`font-size: 11px`, `--state-error`, `margin-top: 8px`. Affiché si une action start/stop/restart échoue. Message résolu via `userMessage()`.

### Menu popover `···`

Ouvert au clic sur le bouton `···`. Fermé au clic extérieur (listener `document click` dans `connectedCallback`/`disconnectedCallback`). Position `absolute`, `top: calc(100% + 4px)`, `right: 0`, `z-index: 100`.

```
┌─────────────────────┐
│  ⎋  ⎋ UI            │  ← visible si state === "running"
│  ⬡  Agents          │  ← visible si running OU agentCount > 0
│  ⚙  Settings        │  ← toujours
│  ↺  Restart         │  ← visible si state === "running"
│  ─────────────────  │
│  ✕  Delete          │  ← danger, séparé
└─────────────────────┘
```

| Item | Condition | Comportement |
|---|---|---|
| **⎋ UI** | `state === "running"` | Lien `<a>` vers `localhost:port/#token=<gatewayToken>`, `target="_blank"` |
| **Agents** | `state === "running"` OU `agentCount > 0` | Émet `navigate { view: "agents-builder", slug }` |
| **Settings** | Toujours | Émet `navigate { view: "instance-settings", slug }` |
| **Restart** | `state === "running"` | Appel API `restartInstance(slug)`, `_loading = true` |
| **Delete** | Toujours | Émet `request-delete { slug }` (confirmation gérée par le parent) |

Tous les items : `stopPropagation()` + `_menuOpen = false` avant action.

### Comportements

- **Clic card** : géré par le parent (`cluster-view`) → navigation vers la vue détail
- **Clic Start/Stop** : `stopPropagation()` + appel API + `_loading = true` pendant l'opération
- **Clic `···`** : `stopPropagation()` + toggle `_menuOpen`
- **Clic extérieur** : ferme le popover via listener `document click`
- **Clic pill devices** : `stopPropagation()` + `navigate { view: "instance-settings", section: "devices" }`

### Données temps réel (WebSocket)

Le handler `health_update` dans `app.ts` propage les champs suivants vers `InstanceInfo` à chaque tick (toutes les 10s) :

| Champ | Type |
|---|---|
| `gateway` | `"healthy" \| "unhealthy" \| "unknown"` |
| `systemd` | `"active" \| "inactive" \| "failed" \| "unknown"` |
| `agentCount` | `number` |
| `pendingDevices` | `number` |
| `telegram` | `"connected" \| "disconnected" \| "not_configured"` |

---

## Écran 2 — Vue Détail Instance (`cp-instance-detail`)

**Fichier source** : `ui/src/components/instance-detail.ts`

Vue complète d'une instance. Largeur max `1100px`, centrée.

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Back                                                         │
│                                                                 │
│  default                                    ● RUNNING          │
│                                                                 │
│  [Arrêter]  [Redémarrer]  [⎋ Open UI]  [Delete]               │
│                                                                 │
│  ┌─ Instance Info ──────────────────────────────────────────┐  │
│  │  PORT  SYSTEMD UNIT  TELEGRAM  MODEL  CONFIG  STATE DIR  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─ Agents (11) ────────────────────────────────────────────┐  │
│  │  ID | Name | Model | Workspace                           │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─ Recent Conversations ───────────────────────────────────┐  │
│  │  HH:MM:SS  from → to  message                            │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Bouton ← Back

Outline gris, hover violet `#6c63ff`. Émet `navigate { slug: null }` → retour à la vue Instances.

### Header détail

- **Titre** : slug en `font-size: 28px`, `font-weight: 700`
- **Sous-titre** : display_name si défini, `font-size: 14px`, `--text-secondary`
- **Badge état** : pill avec point, même logique que la card mais plus grand (`border-radius: 20px`)

### Barre d'actions

Boutons affichés selon l'état de l'instance :

| Bouton | Visible si | Style |
|---|---|---|
| **Démarrer** | `stopped`, `error`, `unknown` | Vert outline |
| **Arrêter** | `running` | Rouge outline |
| **Redémarrer** | `running`, `error`, `unknown` | Violet outline `#6c63ff` |
| **⎋ Open UI** | `running` | Ambre outline. URL = nginx_domain si défini, sinon `localhost:port` |
| **Delete** | Toujours | Rouge discret, `margin-left: auto` (poussé à droite) |

Tous disabled pendant `_actionLoading` ou `_deleting`.

### Confirmation de suppression (inline)

Apparaît sous la barre d'actions quand "Delete" est cliqué.

```
┌─ Permanently destroy "default"? ─────────────────────────────┐
│  This will stop the service, remove all files...              │
│  [input: tapez le slug]  [Destroy]  [Cancel]                  │
└───────────────────────────────────────────────────────────────┘
```

- Fond rouge très transparent, bordure rouge
- Input monospace, focus rouge
- Bouton **Destroy** disabled tant que l'input ≠ slug exact
- Bouton **Destroy** devient "Deleting…" pendant l'opération
- `Enter` dans l'input → confirme | `Escape` → annule

### Section Instance Info

Grid `auto-fill minmax(200px, 1fr)`. Chaque item : label uppercase muted + valeur monospace.

Champs : Port, Systemd Unit, Telegram Bot *(si défini)*, Default Model *(si défini)*, Config Path, State Dir, Created.

### Section Agents

Tableau avec colonnes : ID | Name | Model | Workspace.  
Badge `default` violet sur l'agent par défaut.  
Si vide : texte centré "No agents registered".

### Section Recent Conversations

Liste des 10 dernières conversations. Chaque entrée sur une ligne :

```
HH:MM:SS   ● from-agent → to-agent   message tronqué
```

- **Heure** : monospace, `--text-muted`
- **Point de statut** : ambre (`running`), vert (`done`), rouge (`failed`)
- **from** : violet `#6c63ff`, monospace
- **to** : vert `#10b981`, monospace
- **Message** : tronqué avec ellipsis

---

## Dialog : Nouvelle Instance (`cp-create-dialog`)

**Fichier source** : `ui/src/components/create-dialog.ts`

Modal centré, overlay sombre avec `backdrop-filter: blur(4px)`. Largeur max `560px`.

```
┌─ New Instance ──────────────────────────── [✕] ┐
│                                                  │
│  ── Identity ──────────────────────────────────  │
│  Slug *          Display name                    │
│  [dev-team    ]  [Dev Team    ]                  │
│                                                  │
│  ── Configuration ─────────────────────────────  │
│  Gateway port *                                  │
│  [18790       ]  (Auto-suggested from free range)│
│                                                  │
│  ── Provider ──────────────────────────────────  │
│  AI Provider *   Default model *                 │
│  [Anthropic ▼]   [claude-sonnet ▼]               │
│  API Key *                                       │
│  [sk-ant-...  ]                                  │
│                                                  │
│  ── Team Blueprint ────────────────────────────  │
│  [None ▼]                                        │
│                                                  │
│  ── Agent team ────────────────────────────────  │
│  [Minimal (main only)]  [Custom agents]          │
│                                                  │
│                          [Cancel]  [Create Instance] │
└──────────────────────────────────────────────────┘
```

### Sections

| Section | Champs |
|---|---|
| **Identity** | Slug * (validation temps réel), Display name (auto-rempli depuis slug) |
| **Configuration** | Gateway port * (auto-suggéré via API) |
| **Provider** | AI Provider (select), Default model (select), API Key * (si provider requiresKey) |
| **Team Blueprint** | Select optionnel parmi les blueprints existants |
| **Agent team** | Toggle Minimal / Custom. En mode Custom : liste d'agents (id + nom) + bouton "+ Add agent" |

### Validation du slug

- Auto-lowercase, caractères `[a-z0-9-]` uniquement
- Erreur inline si vide / format invalide / longueur hors 2-30
- Auto-remplit le Display name (capitalisé, tirets → espaces) tant que l'utilisateur ne l'a pas modifié manuellement

### État de soumission

Pendant le provisioning : le formulaire est remplacé par un spinner + message "Provisioning instance **slug**..." (+ "Deploying blueprint agents..." si blueprint sélectionné).

### Fermeture

- Bouton ✕ (disabled pendant soumission)
- Clic sur l'overlay
- Bouton Cancel

---

## Écran 2b — Vue Settings Instance (`cp-instance-settings`)

**Fichier source** : `ui/src/components/instance-settings.ts`

Vue de configuration complète d'une instance. Accessible via le bouton **Settings** de la card ou de la vue détail. Layout deux colonnes : sidebar fixe + zone de contenu par panneau (une section à la fois).

```
┌─ Header bar ──────────────────────────────────────────────────┐
│  ← Back   Settings — default          [Cancel]  [Save]        │
└───────────────────────────────────────────────────────────────┘
┌─ Layout ──────────────────────────────────────────────────────┐
│  ┌─ Sidebar ──┐  ┌─ Content (panneau actif) ───────────────┐  │
│  │  General   │  │  ┌─ GENERAL ──────────────────────────┐ │  │
│  │  Agents    │  │  │  Display name  Port (readonly)      │ │  │
│  │  Telegram  │  │  │  Default model (select grouped)     │ │  │
│  │  Plugins   │  │  │  Tools profile (select)             │ │  │
│  │  Gateway   │  │  │                                     │ │  │
│  │  Devices   │  │  │  PROVIDERS                          │ │  │
│  └────────────┘  │  │  [Anthropic]  sk-ant-***  [Change]  │ │  │
│                  │  │  [+ Add provider]                   │ │  │
│                  │  └─────────────────────────────────────┘ │  │
│                  └──────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

### Principe de navigation par panneau

Clic sur un item de la sidebar → **remplace** le contenu par le panneau correspondant (pas de scroll). Une seule section visible à la fois. Section active par défaut : **General**.

### Header bar

Toujours visible. Fond `--bg-surface`, bordure basse.

| Élément | Description |
|---|---|
| **← Back** | Outline gris, hover accent. Émet `navigate { slug: null }` → retour vue Instances. |
| **Titre** | "Settings — **slug**" (`font-size: 16px`, `font-weight: 700`). |
| **[Cancel]** | Visible si `_hasChanges` ET section active ≠ "devices". Annule toutes les modifications dirty. |
| **[Save]** | Visible si `_hasChanges` ET section active ≠ "devices". Disabled si erreur de validation ou `_saving`. Appelle `PATCH /api/instances/:slug/config`. |

> La section **Devices** n'a pas de champs éditables — Save/Cancel sont masqués quand elle est active.

### Sidebar

`flex: 0 0 180px`, sticky `top: 80px`. Navigation par panneaux : General, Agents, Telegram, Plugins, Gateway, Devices. Item actif : fond `--accent-subtle`, couleur `--accent`, `font-weight: 600`. Clic → `_activeSection = section` (swap immédiat du contenu).

**Badges numériques** sur les items de la sidebar :

| Item | Badge | Condition |
|---|---|---|
| **Telegram** | Rouge | Si des demandes de pairing Telegram sont en attente (`telegramPairing.pending.length > 0`) |
| **Devices** | Rouge | Si des demandes de device pairing sont en attente (`pendingDevices > 0`) |

### Champs modifiés

Les champs modifiés affichent une bordure `--accent` (classe `changed`). Les champs readonly ont un fond `--bg-surface` et `opacity: 0.6`.

### Section General

Grid 2 colonnes.

| Champ | Type | Comportement |
|---|---|---|
| **Display name** | Input texte | Éditable |
| **Port** | Readonly | Non modifiable |
| **Default model** | Select groupé par provider | Options groupées par provider configuré. Si le modèle courant n'est pas dans la liste, ajouté comme option isolée. |
| **Tools profile** | Select | Options : `coding`, `minimal`, `full`, `none` |

**Sous-section Providers** : liste des providers configurés. Chaque provider : card avec nom, ID monospace, env var, clé masquée + bouton **[Change]** (inline edit) ou **[Cancel]**. Bouton **[Remove]** disabled si le provider est utilisé par le default model. Bouton **[+ Add provider]** → select des providers disponibles (non encore configurés).

### Section Agents

**Defaults** (grid 2 colonnes) :

| Champ | Type |
|---|---|
| Default workspace | Input texte |
| Max concurrent subagents | Input number (1–20) |
| Archive after (min) | Input number |
| Compaction mode | Select : `auto`, `manual`, `off` |
| Heartbeat interval | Input texte. Validation : format `30m`, `1h`, `1h30m`. Bare number auto-corrigé → `Xm` au blur. Erreur inline si format invalide. |
| Heartbeat model | Select groupé par provider (+ option "— none —") |

**List** : tableau des agents (ID, Name, Model, Workspace, **Actions**). Affiché si `agents.length > 0`.

La colonne **Actions** contient un bouton ✏ (icône crayon SVG) par agent. Clic → charge les données de l'agent via l'API et ouvre le `cp-agent-detail-panel` en **drawer latéral** :

```
┌─ Backdrop semi-transparent ────────────────────────────────────┐
│                              ┌─ Drawer (420px fixe droite) ──┐ │
│                              │  cp-agent-detail-panel        │ │
│                              │  (même composant que canvas)  │ │
│                              └───────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

| Élément | Description |
|---|---|
| **Backdrop** | `position: fixed; inset: 0; background: rgba(0,0,0,0.35)`. Clic → ferme le drawer. |
| **Drawer** | `position: fixed; top: 0; right: 0; width: 420px; height: 100vh`. Passe à `width: 100vw` si le panel est en mode expanded. |
| **Panel** | `cp-agent-detail-panel` avec contexte `{ kind: "instance", slug }`. Même comportement que dans le canvas (onglets Info + fichiers, spawn links, édition). |
| **Fermeture** | Événement `panel-close` du panel OU clic sur le backdrop. |
| **Expand** | Événement `panel-expand-changed` → le drawer passe en plein écran. |
| **Mise à jour** | Événement `agent-meta-updated` → recharge le panel ET la config de l'instance. |

### Section Telegram

**Cas 1 — Telegram déjà configuré (`channels.telegram !== null`)**

Toggle **Enabled** + champs éditables :

| Champ | Type | Valeurs |
|---|---|---|
| **Bot Token** | Secret masqué + bouton `[Change]` / `[Cancel]` | Badge `hot-reload` |
| **DM Policy** | Select | `pairing` / `open` / `allowlist` / `disabled` |
| **Group Policy** | Select | `allowlist` / `open` / `disabled` |
| **Stream Mode** | Select | `partial` / `full` / `off` |

**Cas 2 — Telegram non configuré (`channels.telegram === null`)**

```
Telegram is not configured for this instance.
[Configure Telegram]   ← btn btn-ghost
```

Clic sur "Configure Telegram" → formulaire d'initialisation inline :

```
Bot Token *    [_________________________]  [BotFather ↗]
DM Policy      [pairing              ▼]
Group Policy   [allowlist            ▼]
Stream Mode    [partial              ▼]

                              [Cancel]  [Add]
```

- **[BotFather ↗]** : lien `https://t.me/BotFather`, `target="_blank"`, style `btn-reveal`
- **[Cancel]** : `btn btn-ghost` — remet `_addingTelegram = false`, vide les dirty keys telegram
- **[Add]** : `btn btn-primary` — disabled si `botToken` vide ou `_saving`. Déclenche `_save()` directement (pas d'attente du Save global). Affiche "Saving…" pendant l'opération.
- Après save réussi : config rechargée → section passe en Cas 1 avec les champs éditables.

### Sous-section Pairing Requests *(Telegram — visible si dmPolicy = "pairing")*

Affichée sous les champs Telegram quand le DM Policy effectif est `pairing` (valeur sauvegardée ou dirty). Chargée automatiquement à l'ouverture du panneau Telegram. Polling toutes les 10s si des demandes sont en attente.

```
┌─ Pairing Requests ──────────────────────────────── [↻] ┐
│                                                         │
│  ┌─ Demande ──────────────────────────────────────────┐ │
│  │  @username          1234   2m ago   [Approve]      │ │
│  │  user_id_mono                                      │ │
│  └────────────────────────────────────────────────────┘ │
│                                                         │
│  Approved senders: 3                                    │
└─────────────────────────────────────────────────────────┘
```

| Élément | Description |
|---|---|
| **Header** | "Pairing Requests" + bouton **[↻]** (refresh manuel, disabled pendant chargement) |
| **Carte demande** | Username (`@username` ou user_id si pas de username), user_id monospace, code de pairing (`font-weight: 700`, `letter-spacing: 0.08em`), âge relatif, bouton **[Approve]** |
| **Bouton Approve** | `btn btn-primary`, disabled pendant l'approbation. Affiche "…" pendant l'opération. |
| **Approved senders** | Compteur des utilisateurs déjà approuvés. |
| **État vide** | "No pending pairing requests." |
| **Erreur** | Bandeau rouge si chargement ou approbation échoue. |

**Âge relatif** : "just now" / "Xm ago" / "Xh ago" / "Xd ago" (basé sur `lastSeenAt` ou `createdAt`).

### Section Plugins

Plugin **mem0** : toggle Enabled + Ollama URL, Qdrant Host, Qdrant Port. Badge `restart` dans le header de section (indique que les changements nécessitent un restart). Si aucun plugin : message informatif.

### Section Gateway

Grid 2 colonnes.

| Champ | Type | Valeurs / Comportement |
|---|---|---|
| **Port** | Readonly | Non modifiable |
| **Bind** | Readonly | Non modifiable |
| **Auth Mode** | Readonly | Non modifiable |
| **Reload Mode** | Select | `hybrid`, `poll`, `off` |
| **Reload Debounce (ms)** | Input number | Min 100, max 5000 |

### Toast de confirmation

Apparaît en bas à droite (`position: fixed`, `bottom: 80px`, `right: 24px`) pendant 4s après sauvegarde.

| Type | Couleur | Message |
|---|---|---|
| **success** | Vert | "Configuration saved — hot-reload applied" |
| **warning** | Ambre | "Configuration saved — instance restarted (raison)" |
| **error** | Rouge | Message d'erreur |

### Bannière instance arrêtée

Si l'instance n'est pas `running`, un bandeau gris discret s'affiche en haut du contenu : "Instance is stopped. Changes will apply on next start."

### Section Devices

Panneau autonome — pas de champs éditables, pas de Save/Cancel. Affiche le composant `cp-instance-devices` (voir section dédiée ci-dessous). Polling automatique si des demandes sont en attente.

---

## Écran 3 — Constructeur d'agents (`cp-agents-builder`)

**Fichier source** : `ui/src/components/agents-builder.ts`  
**Capture de référence** : `screen1.png`

Canvas libre avec cards d'agents positionnées et liens SVG. Hauteur = `100vh - 56px (nav) - 48px (sous-nav)`.

```
┌─ Header ──────────────────────────────────────────────────────┐
│  ← Back  Agents Builder  default  ● running  [+ New agent]  [↓ Export]  [↑ Import]  [↻ Sync]  │
└───────────────────────────────────────────────────────────────┘
┌─ Canvas ──────────────────────────────────────────────────────┐
│                                                               │
│   [Main]──────────────────────────────────────────────────    │
│      ↘                                                        │
│        [Bob - Scrum Master]   [Amelia - Developer]            │
│      ↙                                                        │
│   [Mary - Business A...]    [Oscar - DevSecOps]               │
│                                                               │
│                              ┌─ Agent Detail Panel ─────────┐ │
│                              │  Main  main                  │ │
│                              │  [Info] [AGENTS.md] [SOUL.md]│ │
│                              │  ...                         │ │
│                              └──────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

### Header

| Élément | Description |
|---|---|
| **← Back** | Retour à la vue Instances. Outline gris, hover accent. |
| **Agents Builder** | Titre fixe |
| **slug** | Nom de l'instance en monospace muted |
| **Badge état** | État de l'instance (running/stopped/...) |
| **+ New agent** | Ouvre le dialog de création d'agent (`cp-create-agent-dialog`). Vert outline au hover. Poussé à droite (`margin-left: auto`). |
| **↓ Export** | Exporte l'équipe en `.team.yaml` (téléchargement direct). Outline gris. |
| **↑ Import** | Ouvre le dialog d'import d'équipe (`cp-import-team-dialog`). Outline gris. |
| **↻ Sync** | Resynchronise les agents depuis le disque. Accent outline. Disabled pendant sync. |

### Canvas

- Fond `--bg-base`, position `absolute inset: 0`
- Cards positionnées en `position: absolute`, centrées sur leur point (`transform: translate(-50%, -50%)`)
- Liens SVG en overlay (`pointer-events: none`)
- **Drag & drop** : `pointerdown/move/up` sur le canvas. Seuil de 5px pour distinguer clic (sélection) de drag (déplacement). Position persistée en DB après drag.
- **Clic court** : sélectionne/désélectionne l'agent → ouvre/ferme le panneau détail

### États du canvas

| État | Rendu |
|---|---|
| **Syncing** | Overlay semi-transparent + spinner centré |
| **Erreur** | Bandeau d'erreur centré en haut |
| **Vide** | "No agents found" + "Click Sync to refresh from disk" centré |
| **Normal** | Cards + liens SVG |

### Liens SVG (`cp-agent-links-svg`)

**Fichier source** : `ui/src/components/agent-links-svg.ts`

SVG plein canvas, `pointer-events: none`. Dessine les liens de type `spawn` entre agents.

| Type de lien | Style |
|---|---|
| **Spawn normal** | Tirets gris `#666`, flèche grise |
| **Spawn pending-remove** | Tirets rouges `#ef4444`, flèche rouge |
| **Spawn pending-add** | Tirets verts `#10b981`, flèche verte |

Les liens A2A ne sont pas dessinés en SVG — ils sont indiqués par la bordure accent des cards.

---

## Composant : Agent Card Mini (`cp-agent-card-mini`)

**Fichier source** : `ui/src/components/agent-card-mini.ts`

Card compacte positionnée sur le canvas. Largeur 130-160px (180px pour l'agent default).

```
┌─────────────────────────────┐
│  Bob - Scrum Master      ✕  │  ← row 1 : nom + bouton delete
│  sm              7 fichiers │  ← row 2 : agent_id + file count
│  [A2A]  claude-haku-4-5     │  ← row 3 : badge + modèle
└─────────────────────────────┘
```

### Badges (row 3)

| Badge | Couleur | Condition | Tooltip |
|---|---|---|---|
| **Default** | Accent bleu | `is_default === true` | "Main entry point for conversations..." |
| **A2A** | Accent bleu | Connecté en mode A2A | "Connected in Agent-to-Agent mode..." |
| **SA** | Gris outline | Ni default ni A2A | "SubAgent: specialized agent..." |

### États visuels

| État | Style |
|---|---|
| **Normal** | Bordure `--bg-border` |
| **A2A** | Bordure `--accent-border` |
| **Sélectionné** | Bordure `--accent` + glow `--accent-border` |
| **Nouveau** (2s) | Bordure verte épaisse + animation pulse qui s'estompe |

### Bouton delete (✕)

Visible uniquement si `deletable === true` (non-default). Opacity 0.45 → 1 au hover, couleur rouge. `stopPropagation()` → émet `agent-delete-requested`.

---

## Composant : Agent Detail Panel (`cp-agent-detail-panel`)

**Fichier source** : `ui/src/components/agent-detail-panel.ts`

Panneau latéral droit, `width: 420px`, hauteur 100% du canvas. S'étend à 100% en mode expanded.

```
┌─ Panel Header ──────────────────────────────────────┐
│  Main  main                    [🗑] [⊞] [✕]        │
│  (role si défini)                                   │
├─ Tabs ──────────────────────────────────────────────┤
│  [Info]  [AGENTS.md]  [SOUL.md]  [HEARTBEAT.md] ... │
├─ Body ──────────────────────────────────────────────┤
│  (contenu selon onglet actif)                       │
├─ Save Bar (conditionnelle) ─────────────────────────┤
│  [Save]  N changes pending  [Cancel]                │
└─────────────────────────────────────────────────────┘
```

### Header

- **Nom** : `font-size: 16px`, `font-weight: 700`
- **agent_id** : monospace muted à côté du nom
- **Role** *(optionnel)* : italique muted sous le nom
- **🗑 Delete** : visible si non-default. Hover rouge. Émet `agent-delete-requested`.
- **⊞/⊟ Expand** : bascule entre 420px et 100% de largeur
- **✕ Close** : émet `panel-close`

### Onglets

- **Info** : toujours présent
- **Fichiers** : un onglet par fichier dans `agent.files` (AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, HEARTBEAT.md, MEMORY.md...)

### Onglet Info

Affiche en colonne :

| Champ | Condition |
|---|---|
| **Model** | Si défini |
| **Workspace** | Toujours |
| **Last sync** | Si défini ET contexte instance (pas blueprint) |
| **A2A links** | Si liens A2A existent. Badges `↔ peer-id` accent. |
| **Can spawn** | Si liens spawn sortants OU agents disponibles. Badges éditables avec ✕ (supprimer) et ＋ (ajouter via dropdown). |
| **Spawned by** | Si liens spawn entrants. Badges `← source-id`. |
| **Notes** | Si `agent.notes` défini |

### Gestion des spawn links (inline)

- **Supprimer** : clic ✕ sur un badge → pending-removal (barré, rouge). Clic ↩ → annule.
- **Ajouter** : clic ＋ → dropdown des agents disponibles → sélection → pending-add (vert).
- **Save bar** : apparaît dès qu'il y a des changements pending. Bouton Save → appel API → rechargement. Bouton Cancel → annule tous les changements.

### Onglets fichiers

**Mode consultation :**
- Badge `editable` (vert) ou `read-only` (gris)
- Bouton ✏ si éditable → passe en mode édition
- Contenu rendu en Markdown (marked + DOMPurify)

**Mode édition :**
- Badge `EDITING` accent
- Onglets `Edit` / `Preview`
- Textarea monospace redimensionnable
- Boutons `Save` / `Cancel`
- Si Cancel avec modifications non sauvegardées → dialog de confirmation "Discard changes?"
- Même comportement si changement d'onglet avec modifications en cours

**Fichiers éditables** : AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, USER.md, HEARTBEAT.md  
**Fichiers read-only** : tous les autres (MEMORY.md, etc.)

---

## Dialog : Nouvel Agent (`cp-create-agent-dialog`)

**Fichier source** : `ui/src/components/create-agent-dialog.ts`

Modal centré, largeur max `480px`. Même structure que le dialog de création d'instance.

```
┌─ New agent ─────────────────────────── [✕] ┐
│                                              │
│  ── Identity ──────────────────────────────  │
│  Agent ID *        Display name *            │
│  [qa-engineer ]    [QA Engineer  ]           │
│  Role                                        │
│  [Quality Assurance                ]         │
│                                              │
│  ── Model ─────────────────────────────────  │
│  Provider          Model                     │
│  [Anthropic ▼]     [claude-sonnet ▼]         │
│                                              │
│                    [Cancel]  [Create agent]  │
└──────────────────────────────────────────────┘
```

### Validation

- Agent ID : auto-lowercase, `[a-z0-9-]`, 2-30 chars, pas déjà utilisé dans l'instance
- Display name : auto-rempli depuis l'ID (kebab-case → Title Case) tant que non modifié manuellement
- Bouton Create disabled si formulaire invalide ou providers en chargement

### État de soumission

Spinner + "Creating agent **slug**..."

---

## Dialog : Supprimer un Agent (`cp-delete-agent-dialog`)

**Fichier source** : `ui/src/components/delete-agent-dialog.ts`

Modal centré, largeur max `440px`. Confirmation destructive.

```
┌─ Delete agent ──────────────────────── [✕] ┐
│                                              │
│  ┌─ Warning ──────────────────────────────┐  │
│  │  This will permanently delete all...  │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  Bob - Scrum Master — sm                     │
│                                              │
│  Type the agent ID to confirm                │
│  [sm                                    ]    │
│                                              │
│                    [Cancel]  [Delete]        │
└──────────────────────────────────────────────┘
```

- Bouton **Delete** rouge plein, disabled tant que l'input ≠ `agent.agent_id`
- `Enter` dans l'input → confirme
- Pendant suppression : spinner + "Deleting agent... **slug**"

---

## Dialog : Supprimer une Instance (`cp-delete-instance-dialog`)

**Fichier source** : `ui/src/components/delete-instance-dialog.ts`

Modal centré, overlay sombre avec `backdrop-filter: blur(4px)`. Largeur max `440px`. Déclenché par le bouton ✕ de la card instance (événement `request-delete` capturé par `cluster-view`).

```
┌─ Delete instance ───────────────────── [✕] ┐
│                                              │
│  ┌─ Warning ──────────────────────────────┐  │
│  │  This will permanently stop the        │  │
│  │  service, remove all files...          │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  Mon instance — default                      │
│                                              │
│  Type the instance slug to confirm           │
│  [default                              ]     │
│                                              │
│                    [Cancel]  [Destroy]       │
└──────────────────────────────────────────────┘
```

- Bouton **Destroy** rouge plein, disabled tant que l'input ≠ slug exact
- `Enter` dans l'input → confirme
- Pendant suppression : spinner + "Destroying instance... **slug**"
- Après suppression : émet `instance-deleted { slug }` → `cluster-view` recharge la liste

---

## Dialog : Import d'équipe (`cp-import-team-dialog`)

**Fichier source** : `ui/src/components/import-team-dialog.ts`

Modal centré, overlay sombre avec `backdrop-filter: blur(4px)`. Largeur max `500px`. Accessible depuis le bouton **↑ Import** du header Agents Builder et Blueprint Builder.

```
┌─ Import Agent Team ─────────────────── [✕] ┐
│                                              │
│  ┌─ Drop zone ────────────────────────────┐  │
│  │  Drop .team.yaml file here             │  │
│  │  or click to browse                    │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  (après sélection d'un fichier valide)       │
│  File     my-team.team.yaml                  │
│  Agents   8 (current: 3)                     │
│  Links    12                                 │
│  Files    48                                 │
│                                              │
│  ┌─ Warning ──────────────────────────────┐  │
│  │  This will replace all existing        │  │
│  │  agents, files, and links.             │  │
│  └────────────────────────────────────────┘  │
│                                              │
│                    [Cancel]  [Import]        │
└──────────────────────────────────────────────┘
```

### Comportement

| Étape | Description |
|---|---|
| **Drop / Browse** | Zone drag & drop ou clic pour ouvrir le sélecteur de fichier (`.yaml`, `.yml`). Bordure accent + fond léger au hover/dragover. |
| **Dry-run auto** | Dès qu'un fichier est sélectionné, appel API automatique en mode dry-run → affiche le résumé (agents, liens, fichiers à importer). |
| **Résumé** | Nombre d'agents à importer, count actuel, liens, fichiers workspace. |
| **Warning** | Bandeau ambre : "This will replace all existing agents, files, and links. This action cannot be undone." |
| **Import** | Bouton disabled tant que le dry-run n'a pas réussi. Pendant l'import : spinner inline. |
| **Succès** | Émet `team-imported` → le parent recharge les données du canvas. |

**Contexte polymorphe** : fonctionne pour une instance (`kind: "instance"`) ou un blueprint (`kind: "blueprint"`). Les routes API appelées diffèrent selon le contexte.

---

## Écran 4 — Vue Blueprints (`cp-blueprints-view`)

**Fichier source** : `ui/src/components/blueprints-view.ts`

Structure identique à la Vue Instances : early return pendant le chargement, header avec count dynamique + bouton, grille de cards.

```
┌─────────────────────────────────────────────────────────────────┐
│  2 blueprints                         [+ New Blueprint]         │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐                    │
│  │  Blueprint Card  │  │  Blueprint Card  │                    │
│  └──────────────────┘  └──────────────────┘                    │
└─────────────────────────────────────────────────────────────────┘
```

### États

| État | Rendu |
|---|---|
| **Chargement** | "Loading blueprints..." centré (early return — header non affiché) |
| **Erreur** | Bandeau d'erreur rouge avant le header |
| **Vide** | Header "0 blueprints" + icône 📋 + "No blueprints yet" + hint |
| **Normal** | Header "N blueprints" + grille `auto-fill minmax(300px, 1fr)`, gap 16px |

### Interactions

- **Clic sur une card** → navigation vers le Blueprint Builder
- **Bouton "+ New Blueprint"** → ouvre le Dialog de création de blueprint
- **Suppression** : gérée inline dans la card (confirmation)

---

## Composant : Blueprint Card (`cp-blueprint-card`)

**Fichier source** : `ui/src/components/blueprint-card.ts`

```
┌─────────────────────────────────────┐
│ ▌ 🎯 HR Team              [Delete] │  ← header (barre couleur + icône + nom)
│                                     │
│  Description du blueprint...        │  ← description (2 lignes max)
│                                     │
│  3 agents   [hr]  [legal]           │  ← meta (count + tags)
│                                     │
│  ┌─ Delete blueprint "HR Team"? ──┐ │  ← confirmation inline (conditionnelle)
│  │  [Delete]  [Cancel]            │ │
│  └────────────────────────────────┘ │
└─────────────────────────────────────┘
```

### Éléments

| Élément | Description |
|---|---|
| **Barre couleur** | Bande verticale gauche 3px avec la couleur du blueprint (si définie) |
| **Icône** | Emoji ou texte, `font-size: 20px` (si défini) |
| **Nom** | `font-size: 16px`, `font-weight: 700` |
| **Bouton Delete** | Outline transparent → rouge au hover. `stopPropagation()`. |
| **Description** | 2 lignes max avec ellipsis |
| **Agent count** | "N agents" ou "No agents" |
| **Tags** | Pills accent arrondies (`border-radius: 20px`) |

### Confirmation de suppression

Apparaît inline sous la meta quand Delete est cliqué. Fond rouge transparent.  
Bouton **Delete** rouge plein → émet `blueprint-delete`. Bouton **Cancel** → masque la confirmation.  
Clic sur la card ignoré si la zone delete/confirm est cliquée.

### Hover

Bordure `--accent-border` + glow `0 0 0 1px --accent-border`.

---

## Écran 5 — Blueprint Builder (`cp-blueprint-builder`)

**Fichier source** : `ui/src/components/blueprint-builder.ts`

Même structure visuelle que le Constructeur d'agents (canvas + panel), mais pour les blueprints (pas d'instance live).

```
┌─ Header ──────────────────────────────────────────────────────┐
│  ← Back to Blueprints   HR Team  🎯          [+ New agent]   │
└───────────────────────────────────────────────────────────────┘
┌─ Canvas ──────────────────────────────────────────────────────┐
│  (même canvas que agents-builder)                             │
│                              ┌─ Agent Detail Panel ─────────┐ │
│                              │  (même panel, contexte BP)   │ │
│                              └──────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

### Différences vs Constructeur d'agents

| Aspect | Agents Builder | Blueprint Builder |
|---|---|---|
| Contexte panel | `{ kind: "instance", slug }` | `{ kind: "blueprint", blueprintId }` |
| Bouton Sync | Présent | Absent |
| Dialog création agent | `cp-create-agent-dialog` (complet) | Dialog inline simplifié (ID + Nom + Modèle) |
| Suppression agent | Via `cp-delete-agent-dialog` | Directe (pas de confirmation dialog) |
| Last sync dans panel | Affiché | Masqué |
| Spawn links API | `/api/instances/:slug/agents/:id/spawn-links` | `/api/blueprints/:id/agents/:id/spawn-links` |

### Dialog de création d'agent (inline dans blueprint-builder)

Dialog simplifié sans provider/API key :

```
┌─ New agent ─────────────────────────────────────┐
│  Agent ID *  [researcher              ]          │
│  Name *      [Research Agent          ]          │
│  Model       [claude-opus-4-5         ] (optionnel) │
│                          [Cancel]  [Create]      │
└──────────────────────────────────────────────────┘
```

---

## Dialog : Découverte d'instances (`cp-discover-dialog`)

**Fichier source** : `ui/src/components/discover-dialog.ts`

Modal centré, overlay sombre avec `backdrop-filter: blur(4px)`. Largeur max `520px`. Déclenché par le bouton **[Discover instances]** de la vue Instances (état vide). Implémente `DialogMixin`.

Le scan démarre automatiquement à l'ouverture (`connectedCallback`).

### Phases

```
┌─ Discover instances ──────────────────────────── [✕] ┐
│                                                       │
│  Phase scanning :                                     │
│  ┌─────────────────────────────────────────────────┐  │
│  │  [spinner]                                      │  │
│  │  Scanning system...                             │  │
│  │  Looking for OpenClaw instances                 │  │
│  └─────────────────────────────────────────────────┘  │
│                                                       │
│  Phase results (instances trouvées) :                 │
│  Found 2 instance(s) on this system:                  │
│  ┌─ Instance card ───────────────────────────────┐    │
│  │  default                    ● running         │    │
│  │  :18789  ✈ @my_bot  claude-sonnet  3 agents   │    │
│  └───────────────────────────────────────────────┘    │
│  ┌─ Instance card ───────────────────────────────┐    │
│  │  staging                    ○ stopped         │    │
│  │  :18790                                       │    │
│  └───────────────────────────────────────────────┘    │
│                                [Cancel]  [Adopt all (2)]│
│                                                       │
│  Phase adopting :                                     │
│  [spinner]  Registering instances...                  │
│                                                       │
│  Phase done :                                         │
│  ✓  2 instance(s) registered successfully.            │
│                                                       │
│  Phase error :                                        │
│  [bandeau rouge]  [Close]  [Retry]                    │
└───────────────────────────────────────────────────────┘
```

### Phases détail

| Phase | Déclencheur | Rendu |
|---|---|---|
| **scanning** | Ouverture du dialog | Spinner centré + "Scanning system..." + sous-titre "Looking for OpenClaw instances" |
| **results** | Scan terminé | Liste des instances trouvées (ou message "No OpenClaw instances found") + footer [Cancel] [Adopt all (N)] |
| **adopting** | Clic [Adopt all] | Spinner + "Registering instances..." |
| **done** | Adoption réussie | Icône ✓ vert + "N instance(s) registered successfully." Auto-fermeture après 1,5s avec émission `instances-adopted` |
| **error** | Erreur scan ou adoption | Bandeau rouge + [Close] + [Retry] |

### Instance card (dans la liste results)

Fond `--bg-base`, bordure `--bg-border`, `border-radius: --radius-md`.

| Élément | Description |
|---|---|
| **Slug** | `font-weight: 700`, `font-size: 14px` |
| **Badge état** | Pill vert "● running" si `gatewayHealthy`, gris "○ stopped" sinon |
| **Port** | Monospace muted `:XXXXX` |
| **Telegram** | Pill bleu `#0088cc` si `telegramBot` défini |
| **Model** | Monospace muted si `defaultModel` défini |
| **Agent count** | "N agents" si `agentCount > 0` |

### Comportements

- **Fermeture** : bouton ✕ (disabled pendant phase `adopting`) ou clic overlay (idem)
- **Retry** : relance le scan depuis la phase `scanning`
- **Adopt all** : adopte toutes les instances trouvées en une seule action
- **Après adoption** : émet `instances-adopted { count }` → `cluster-view` ferme le dialog et recharge la liste

### Accessibilité

`role="dialog"`, `aria-modal="true"`, `aria-labelledby`. Implémente `DialogMixin` (focus trap, Escape).

---

## Composant : Devices (`cp-instance-devices`)

**Fichier source** : `ui/src/components/instance-devices.ts`

Composant autonome affiché dans le panneau **Devices** des Settings instance. Gère le pairing des appareils (Control UI, CLI) avec l'instance OpenClaw.

```
┌─ DEVICES ───────────────────────────────────────────────────────┐
│                                                                  │
│  ┌─ PENDING (2) ──────────────────────── [Approve all] ────────┐ │
│  │  macos    browser-abc123    2m ago    [Approve]             │ │
│  │  linux    browser-def456    5m ago    [Approve]             │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  PAIRED (3)                                                      │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  macos    browser-xyz    admin    1h ago    [✕]             │ │
│  │  linux    cli            admin    3d ago    [cli]           │ │
│  │  windows  browser-abc    user     2d ago    [✕]             │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  [↻ Refresh]                                                     │
└──────────────────────────────────────────────────────────────────┘
```

### Section Pending

Fond ambre transparent (`rgba(245,158,11,0.08)`), bordure ambre. Visible uniquement si `devices.pending.length > 0`.

| Élément | Description |
|---|---|
| **Header "PENDING (N)"** | Label ambre uppercase + bouton **[Approve all]** si N > 1 |
| **Ligne device** | Platform (monospace) + clientId + âge relatif + bouton **[Approve]** |
| **[Approve]** | Vert outline. Spinner inline pendant l'approbation. Disabled pendant l'opération. |
| **[Approve all]** | Approuve tous les devices en séquence. Spinner inline. |

**Polling** : si des demandes sont en attente, polling automatique toutes les 5s. Arrêté quand la liste pending est vide.

### Section Paired

Bordure `--bg-border`, `border-radius: --radius-md`, overflow hidden.

| Élément | Description |
|---|---|
| **Titre "PAIRED (N)"** | Label uppercase muted |
| **Ligne device** | Platform (monospace) + clientId + role + âge relatif (basé sur `lastUsedAtMs` ou `approvedAtMs`) + action |
| **Action — CLI** | Badge `[cli]` gris monospace (non révocable) |
| **Action — Autres** | Bouton **[✕]** 24×24px, muted → rouge au hover. Clic → confirmation inline. |
| **Confirmation inline** | "Revoke?" + **[Confirm]** rouge + **[Cancel]** gris. Remplace le bouton ✕. |
| **État vide** | "No paired devices." |

### Âge relatif

Calculé depuis `lastUsedAtMs` (max des tokens) ou `approvedAtMs` : "just now" / "Xm ago" / "Xh ago" / "Xd ago".

### Footer

Bouton **[↻ Refresh]** (outline gris) + message d'erreur inline si une opération échoue.

### Props

| Prop | Type | Description |
|---|---|---|
| `slug` | `string` | Slug de l'instance |
| `active` | `boolean` | Si `false`, le composant ne charge pas et arrête le polling |

### Événements émis

| Événement | Payload | Description |
|---|---|---|
| `pending-count-changed` | `number` | Émis après chaque chargement — nombre de demandes en attente. Utilisé par `instance-settings` pour mettre à jour le badge sidebar. |

---

## Accessibilité des dialogs

Depuis v0.7.1, tous les dialogs modaux implémentent `DialogMixin` :

| Comportement | Détail |
|---|---|
| **Focus trap** | Le focus reste dans le dialog tant qu'il est ouvert (Tab / Shift+Tab cyclent dans le dialog) |
| **Escape** | Ferme le dialog (sauf pendant une opération en cours) |
| **aria-modal** | `aria-modal="true"` sur l'élément racine du dialog |

Dialogs concernés : `cp-create-dialog`, `cp-delete-instance-dialog`, `cp-create-agent-dialog`, `cp-delete-agent-dialog`, `cp-import-team-dialog`.

---

## Dialog : Nouveau Blueprint (`cp-create-blueprint-dialog`)

**Fichier source** : `ui/src/components/create-blueprint-dialog.ts`

Modal centré, largeur `480px`.

```
┌─ New Blueprint ──────────────────────────────────┐
│                                                  │
│  Name *                                          │
│  [e.g. HR Team, Dev Squad              ]         │
│                                                  │
│  Description                                     │
│  [What this team does...               ]         │
│  [                                     ]         │
│                                                  │
│  Icon                                            │
│  [Emoji or icon name                   ]         │
│                                                  │
│  Tags                                            │
│  [Comma-separated, e.g. hr, legal      ]         │
│                                                  │
│  Color                                           │
│  [✕] [●] [●] [●] [●] [●] [●] [●] [●]           │
│                                                  │
│                        [Cancel]  [Create]        │
└──────────────────────────────────────────────────┘
```

### Champs

| Champ | Obligatoire | Description |
|---|---|---|
| **Name** | Oui | Texte libre. Bouton Create disabled si vide. |
| **Description** | Non | Textarea redimensionnable |
| **Icon** | Non | Emoji ou texte libre |
| **Tags** | Non | Chaîne CSV (ex: "hr, legal") |
| **Color** | Non | Sélecteur de 8 couleurs preset + option "aucune" (✕). Swatches circulaires 28px. |

### Couleurs preset

`#4f6ef7` (bleu), `#10b981` (vert), `#f59e0b` (ambre), `#ef4444` (rouge), `#8b5cf6` (violet), `#06b6d4` (cyan), `#f97316` (orange), `#ec4899` (rose).

Swatch sélectionné : bordure blanche + scale 1.1.

---

*Mis à jour : 2026-03-10 - Refonte Instance Card v0.14.0 : menu popover `···`, status bar (gateway/telegram/agents/devices), hiérarchie display_name > slug, action Restart, propagation `telegram` dans HealthUpdate WS*
