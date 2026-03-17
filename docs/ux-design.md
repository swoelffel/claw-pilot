# UX Design — claw-pilot

Référence visuelle et comportementale de tous les écrans et composants de l'application.
Sert de base d'échange pour les évolutions d'interface.

> **Composants source** : `ui/src/components/`  
> **Styles partagés** : `ui/src/styles/tokens.ts` + `ui/src/styles/shared.ts`  
> **Stack** : Lit web components, dark theme, CSS custom properties  
> **Captures de référence** : `screen1.png` (Constructeur d'agents), `screen2.png` (Vue Instances)

---

## Tokens de style globaux

| Token | Valeur | Usage |
|---|---|---|
| `--bg-base` | `#0f1117` | Fond de page |
| `--bg-surface` | `#1a1d27` | Cards, panels, dialogs |
| `--bg-hover` | `#1e2130` | Hover sur items |
| `--bg-border` | `#2a2d3a` | Bordures |
| `--text-primary` | `#e2e8f0` | Titres, valeurs importantes |
| `--text-secondary` | `#94a3b8` | Corps de texte |
| `--text-muted` | `#64748b` | Labels, métadonnées |
| `--font-ui` | `Geist`, `-apple-system`, `sans-serif` | Police principale |
| `--font-mono` | `Geist Mono`, `monospace` | Valeurs techniques |
| `--accent` | `#4f6ef7` | Bleu principal (CTA, sélection) |
| `--accent-hover` | `#6b85f8` | Bleu hover |
| `--accent-subtle` | `rgba(79,110,247,0.08)` | Fond accent léger |
| `--accent-border` | `rgba(79,110,247,0.25)` | Bordure accent |
| `--state-running` | `#10b981` | Running, succès |
| `--state-stopped` | `#64748b` | Arrêté |
| `--state-error` | `#ef4444` | Erreur, danger |
| `--state-warning` | `#f59e0b` | Ambre — avertissement |
| `--state-info` | `#0ea5e9` | Cyan — info |
| `--focus-ring` | `0 0 0 2px rgba(79,110,247,0.5)` | Focus outline |
| `--radius-sm` | `4px` | Badges, petits éléments |
| `--radius-md` | `8px` | Boutons, inputs |
| `--radius-lg` | `12px` | Cards, dialogs |

---

## Écran 0 — Login (`cp-login-view`)

**Fichier source** : `ui/src/components/login-view.ts`

Affiché à la place de toute l'application si l'utilisateur n'est pas authentifié (ou si la session a expiré). Centré verticalement et horizontalement sur `min-height: 100vh`.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│              ┌─ Card (max-width 360px) ──────────────────┐     │
│              │                                           │     │
│              │           Claw Pilot                      │     │
│              │                                           │     │
│              │  [Bandeau session expirée — ambre]        │     │
│              │  (conditionnel)                           │     │
│              │                                           │     │
│              │  Username                                 │     │
│              │  [admin                          ]        │     │
│              │                                           │     │
│              │  Password                                 │     │
│              │  [                               ]        │     │
│              │                                           │     │
│              │  [Sign in]                                │     │
│              │                                           │     │
│              │  (message d'erreur si échec)              │     │
│              │                                           │     │
│              │  v0.36.1                                  │     │
│              └───────────────────────────────────────────┘     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Éléments

| Élément | Description |
|---|---|
| **Titre** | "Claw**Pilot**" — span accent sur "Pilot", `font-size: --text-xl`, `font-weight: 700`, centré |
| **Bandeau session expirée** | Fond ambre `rgba(245,158,11,0.1)`, bordure ambre. Visible si prop `sessionExpired = true`. Message : "Your session has expired. Please sign in again." |
| **Username** | Input texte, pré-rempli avec `"admin"` |
| **Password** | Input password, autofocus à l'ouverture |
| **[Sign in]** | Bouton plein `--accent`, largeur 100%, `min-height: 44px`. Affiche "…" pendant la soumission. |
| **Erreur** | Texte rouge centré sous le bouton. Messages : "Invalid credentials" (401), "Too many attempts. Please wait a moment." (429), "An error occurred. Please try again." (autres). |
| **Version** | `v{APP_VERSION}` monospace muted, centré, `font-size: 11px` |

### Comportements

- `Enter` dans n'importe quel champ → soumet le formulaire
- Pendant la soumission : bouton disabled
- Succès : émet `authenticated { token }` → `cp-app` stocke le token et initialise l'app
- La card a `background: --bg-surface`, `border: 1px solid --bg-border`, `border-radius: 8px`, `padding: 32px`

---

## Routing hash-based

Depuis v0.7.1, la navigation utilise des hash URLs (`#/...`). Le browser back/forward et le refresh de page fonctionnent correctement.

| Hash URL | Vue rendue | Composant |
|---|---|---|
| `#/` | Vue Instances (accueil) | `cp-cluster-view` |
| `#/instances/:slug/builder` | Constructeur d'agents | `cp-agents-builder` |
| `#/instances/:slug/settings` | Settings instance | `cp-instance-settings` |
| `#/blueprints` | Vue Blueprints | `cp-blueprints-view` |
| `#/blueprints/:id/builder` | Blueprint Builder | `cp-blueprint-builder` |

La navigation entre vues émet des événements `navigate { view, slug?, blueprintId? }` capturés par `app.ts`, qui met à jour le hash URL et rend le composant correspondant.

---

## Navigation globale (`app.ts`)

Barre de navigation fixe en haut de page (`height: 56px`, `background: --bg-surface`).

```
┌─────────────────────────────────────────────────────────────────┐
│  ClawPilot   Instances [2]   Blueprints [3]   ● Live  [Sign out]│
└─────────────────────────────────────────────────────────────────┘
```

| Élément | Description |
|---|---|
| **Logo** | "Claw**Pilot**" (span accent sur "Pilot") — clic → vue Instances |
| **Instances** | Onglet actif si vue cluster, agents-builder ou instance-settings. Badge numérique si `instanceCount > 0`. |
| **Blueprints** | Onglet actif si vue blueprints ou blueprint-builder. Badge numérique si `blueprintCount !== null && blueprintCount > 0`. |
| **Indicateur WS** | Point vert (`--state-running`) + "Live" si connecté ; point rouge (`--state-error`) + "Offline" si déconnecté. |
| **Sign out** | Bouton outline gris, hover rouge (`--state-error`). Appelle `POST /api/auth/logout` puis réinitialise l'état local. |

**Footer** (`height: 48px`, `background: --bg-surface`) :

```
┌─────────────────────────────────────────────────────────────────┐
│  ClawPilot  [v0.36.1]  ·  GitHub  ·  Issues    🌐 EN ▾  ·  © 2026 SWO — MIT License │
└─────────────────────────────────────────────────────────────────┘
```

| Élément | Description |
|---|---|
| **ClawPilot** | Marque avec span accent, `font-weight: 600` |
| **[vX.Y.Z]** | Badge version monospace accent (`--accent-subtle`, `--accent-border`) |
| **GitHub** | Lien `https://github.com/swoelffel/claw-pilot`, `target="_blank"` |
| **Issues** | Lien `https://github.com/swoelffel/claw-pilot/issues`, `target="_blank"` |
| **Sélecteur de langue** | Bouton `🌐 XX ▾` — ouvre un dropdown vers le haut avec les 6 langues disponibles. Clic extérieur ferme le dropdown. |
| **© année SWO** | Texte muted avec "MIT License" |

### Bannière update claw-pilot (`cp-self-update-banner`)

Composant `<cp-self-update-banner>` affiché **en haut du `<main>`**, au-dessus de toutes les vues (cluster, blueprints, settings…). Wrapper léger autour de `<cp-update-banner-base>`.

```
┌─────────────────────────────────────────────────────────────────┐
│  [nav header]                                                   │
├─────────────────────────────────────────────────────────────────┤
│  ┌─ Bannière update claw-pilot (conditionnelle) ──────────────┐ │
│  │  ↑ claw-pilot update available  v0.12.0   [Update claw-pilot]│ │
│  └─────────────────────────────────────────────────────────────┘ │
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

Composant Lit de base factorisant le CSS et la structure HTML du bandeau de mise à jour claw-pilot. Non utilisé directement — instancié via le wrapper `cp-self-update-banner`.

### Props

| Prop | Type | Description |
|---|---|---|
| `status` | `SelfUpdateStatus \| null` | Statut de mise à jour passé par le wrapper |
| `productName` | `string` | Nom du produit affiché dans les messages (ex: `"claw-pilot"`) |
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

Page d'accueil. Grille de cards d'instances. `padding: 24px`.

```
┌─────────────────────────────────────────────────────────────────┐
│  2 instances                          [+ New Instance]          │
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
| **Normal** | Header "N instances" + grille `auto-fill minmax(300px, 1fr)`, gap 16px |

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

Le bouton **[Discover instances]** (`btn btn-secondary`) ouvre le dialog `cp-discover-dialog` qui scanne le système à la recherche d'instances claw-runtime existantes et propose de les adopter.

### Interactions

- **Clic sur une card** → navigation vers la Vue Détail de l'instance
- **Bouton "+ New Instance"** → ouvre le Dialog de création (`cp-create-dialog`)
- Après création : ferme le dialog + recharge la liste

---

## Composant : Instance Card (`cp-instance-card`)

**Fichier source** : `ui/src/components/instance-card.ts`

```
┌────────────────────────────────────────────────┐
│  Mon instance    ⚡ runtime  ● running  [···]  │  ← header
│  default                                       │
├────────────────────────────────────────────────┤
│  ◉ Gateway  ✈ @my_bot  ⬡ 11 agents  ⚠ PERM   │  ← status bar
├────────────────────────────────────────────────┤
│  anthropic/claude-sonnet-4-5                   │  ← modèle
│  :18789                                        │  ← port
│                                                │
│  (message d'erreur si échec)                   │  ← erreur conditionnelle
└────────────────────────────────────────────────┘
```

### Hiérarchie typographique

| Élément | Taille | Poids | Couleur |
|---|---|---|---|
| `display_name` (ou slug si absent) | 16px | 700 | `--text-primary` |
| `slug` (si display_name défini) | 11px | 400 | `--text-muted`, monospace |
| Modèle | 13px | 400 | `--text-secondary`, monospace |
| Port | 11px | 400 | `--text-muted`, monospace |

### Zone 1 — Header

Flex row `justify-content: space-between`, `gap: 10px`.

**Côté gauche :**

| Élément | Description |
|---|---|
| **display_name** | `font-size: 16px`, `font-weight: 700`, `--text-primary`. Si `display_name` est null, affiche le slug à la place. |
| **slug** *(conditionnel)* | `font-size: 11px`, `--text-muted`, monospace, `margin-top: 2px`. Affiché uniquement si `display_name` est défini. |

**Côté droit** (`card-header-right`, flex row `gap: 8px`) :

| Élément | Description |
|---|---|
| **Badge `⚡ runtime`** | Pill violet indigo `rgba(99,102,241,0.12)` / `#818cf8`. Toujours affiché. Indique le moteur claw-runtime. |
| **Badge état** | Pill coloré avec point lumineux + label texte de l'état. |
| **Bouton `···`** | Bouton menu 28×28px. Ouvre le popover d'actions au clic. Classe `open` quand actif. |

**États du badge :**

| État | Couleur |
|---|---|
| `running` | Vert `--state-running` |
| `stopped` | Gris `--state-stopped` |
| `error` | Rouge `--state-error` |
| `unknown` | Gris |

### Zone 2 — Status bar

Flex row, `gap: 10px`, `flex-wrap: wrap`, séparée du header et du meta par des bordures `--bg-border`. Masquée si aucun indicateur à afficher (`items.length === 0`).

| Indicateur | Condition | Style |
|---|---|---|
| `◉ Gateway` | `state === "running"` ET `gateway === "healthy"` | Vert `--state-running` |
| `◎ Gateway KO` | `state === "running"` ET `gateway === "unhealthy"` | Rouge `--state-error` |
| `✈ @bot` | `telegram_bot` défini ET `telegram !== "disconnected"` | Pill bleu `#0088cc` |
| `✈ @bot ⚠` | `telegram_bot` défini ET `telegram === "disconnected"` | Pill ambre `--state-warning` |
| `⬡ N agent(s)` | `agentCount > 0` | Texte `--text-muted` |
| ~~`⚠ N device(s)`~~ | *(removed in v0.34.0 — device pairing no longer supported)* | — |
| `⚠ PERM` | `pendingPermissions > 0` | Pill rouge cliquable → `navigate { view: "instance-settings", section: "runtime" }`. `font-weight: 700`. |

### Zone 3 — Meta

Colonne flex, `gap: 4px`.

| Champ | Condition | Style |
|---|---|---|
| **Modèle** | Si `default_model` défini. Résolution intelligente : si JSON `{"primary":"..."}`, extrait la clé `primary`. | `font-size: 13px`, `--text-secondary`, monospace |
| **Port** | Toujours. | `font-size: 11px`, `--text-muted`, monospace |

### Zone 4 — Erreur *(conditionnelle)*

`font-size: 11px`, `--state-error`, `margin-top: 8px`. Affiché si une action start/stop/restart échoue. Message résolu via `userMessage()`.

### Menu popover `···`

Ouvert au clic sur le bouton `···`. Fermé au clic extérieur (listener `document click`). Position `absolute`, `top: calc(100% + 4px)`, `right: 0`, `z-index: 100`, `min-width: 164px`, `box-shadow: 0 4px 20px rgba(0,0,0,0.45)`.

```
┌─────────────────────┐
│  ■  Stop            │  ← rouge si running / ▶ Start vert si stopped
│  ─────────────────  │
│  ⬡  Agents          │  ← visible si running OU agentCount > 0
│  ⚙  Settings        │  ← toujours
│  ↺  Restart         │  ← visible si state === "running"
│  ─────────────────  │
│  ✕  Delete          │  ← danger, séparé
└─────────────────────┘
```

| Item | Condition | Style | Comportement |
|---|---|---|---|
| **■ Stop / ▶ Start** | Toujours | Rouge `.stop` si running, vert `.start` si stopped | Appel API `stopInstance` / `startInstance`. Disabled pendant `_loading`. |
| **⬡ Agents** | `state === "running"` OU `agentCount > 0` | Normal | Émet `navigate { view: "agents-builder", slug }` |
| **⚙ Settings** | Toujours | Normal | Émet `navigate { view: "instance-settings", slug }` |
| **↺ Restart** | `state === "running"` | Normal | Appel API `restartInstance(slug)` |
| **✕ Delete** | Toujours | Rouge `.danger` | Émet `request-delete { slug }` (confirmation gérée par le parent) |

Tous les items : `stopPropagation()` + `_menuOpen = false` avant action.

### Comportements

- **Clic `···`** : `stopPropagation()` + toggle `_menuOpen`
- **Clic extérieur** : ferme le popover via listener `document click` (ajouté dans `connectedCallback`, retiré dans `disconnectedCallback`)
- **Clic pill devices** : `stopPropagation()` + `navigate { view: "instance-settings", section: "devices" }`
- **Clic pill PERM** : `stopPropagation()` + `navigate { view: "instance-settings", section: "runtime" }`

### Données temps réel (WebSocket)

Le handler `health_update` dans `app.ts` propage les champs suivants vers `InstanceInfo` à chaque tick :

| Champ | Type |
|---|---|
| `gateway` | `"healthy" \| "unhealthy" \| "unknown"` |
| `state` | `"running" \| "stopped" \| "error" \| "unknown"` |
| `agentCount` | `number` |
| `pendingDevices` | `number` |
| `pendingPermissions` | `number` |
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

## Composant : Runtime Chat (`cp-runtime-chat`)

**Fichier source** : `ui/src/components/runtime-chat.ts`

Composant de chat temps réel avec un agent claw-runtime via SSE. Intégré dans la section **Runtime** des Settings instance. Layout flex colonne, hauteur 100% de son conteneur.

```
┌─ cp-runtime-chat ─────────────────────────────────────────────┐
│  [Agent ▼]  🔒 Permanent                     [···]            │  ← header (permanent agent)
│  — ou —                                                       │
│  [Agent ▼]  [Session selector ▼]  [+ New]                     │  ← header (ephemeral agent)
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  (zone messages — flex: 1, overflow-y: auto)                  │  ← messages
│                                                               │
│  ┌─ message user ──────────────────────────────────────────┐  │
│  │  Mon message                                            │  │
│  └─────────────────────────────────────────────────────────┘  │
│  ┌─ message assistant ─────────────────────────────────────┐  │
│  │  Réponse de l'agent                                     │  │
│  └─────────────────────────────────────────────────────────┘  │
│  [spinner]  Agent is thinking…                                │  ← état sending/streaming
│                                                               │
├───────────────────────────────────────────────────────────────┤
│  [textarea…]                                    [Send]        │  ← input
├───────────────────────────────────────────────────────────────┤
│  (bandeau d'erreur si connexion perdue)                       │  ← erreur conditionnelle
└───────────────────────────────────────────────────────────────┘
```

### Header

| Élément | Description |
|---|---|
| **Agent selector** | `<select>` affiché si l'instance a plusieurs agents. Sélection de l'agent courant. |
| **Badge 🔒 Permanent** | Affiché si l'agent courant est permanent (`persistent === true`). Texte muted. |
| **Session selector** | `<select>` flex:1. Option "New session" + sessions existantes. **Masqué pour les agents permanents** (une seule session). |
| **[+ New]** | `btn btn-ghost`, `font-size: 12px`. Crée une nouvelle session. **Masqué pour les agents permanents**. |
| **[···]** | Menu dropdown avec actions. L'option "New session" est **masquée pour les agents permanents**. |

### Zone messages

- Fond transparent, `padding: 16px`, `gap: 12px`
- **État vide** : "Start a conversation with the agent" centré, `--text-muted`
- **Message user** : `background: --bg-hover`, aligné à droite, `max-width: 85%`, `border-radius: --radius-md`
- **Message assistant** : fond transparent, `border: 1px solid --bg-border`, aligné à gauche
- **Message streaming** : même style assistant + curseur `▋` + `opacity: 0.85`
- **Spinner "thinking"** : affiché si `status === "sending"` ou `status === "streaming"` sans texte accumulé. Spinner 16px + "Agent is thinking…"

### Input

- `<textarea>` flex:1, `rows="2"`, `resize: none`, `background: --bg-hover`
- `Enter` (sans Shift) → envoie le message
- `Shift+Enter` → saut de ligne
- Disabled si `status !== "idle"`
- **[Send]** : `btn btn-primary`, disabled si textarea vide ou status ≠ idle

### Flux SSE

Ouvert via `EventSource` sur `GET /api/instances/:slug/runtime/sessions/:id/stream`.

| Événement SSE | Comportement |
|---|---|
| `message.part.delta` | Accumule `_streamingText` |
| `message.created` (assistant) | Réinitialise `_streamingText`, status → streaming |
| `message.updated` | Vide `_streamingText`, status → idle |
| `session.status` (busy/idle) | Met à jour le status |
| `session.ended` | status → idle |
| `ping` | Ignoré (keep-alive) |
| Erreur SSE | status → error, message "Connection to runtime lost. Please refresh." |

### Premier message (nouvelle session)

Le premier message d'une nouvelle session est envoyé via `POST /api/instances/:slug/runtime/chat`. La réponse HTTP contient directement le texte de l'assistant (le stream SSE n'est pas encore ouvert). Le stream est ouvert après pour les messages suivants.

### Props

| Prop | Type | Description |
|---|---|---|
| `slug` | `string` | Slug de l'instance |

---

## Écran 2b — Vue Settings Instance (`cp-instance-settings`)

**Fichier source** : `ui/src/components/instance-settings.ts`

Vue de configuration complète d'une instance. Accessible via le bouton **Settings** de la card. Layout deux colonnes : sidebar fixe + zone de contenu par panneau (une section à la fois).

```
┌─ Header bar ──────────────────────────────────────────────────┐
│  ← Back   default — Settings          [Cancel]  [Save]        │
└───────────────────────────────────────────────────────────────┘
┌─ Layout ──────────────────────────────────────────────────────┐
│  ┌─ Sidebar ──┐  ┌─ Content (panneau actif) ───────────────┐  │
│  │  General   │  │  ┌─ GENERAL ──────────────────────────┐ │  │
│  │  Agents    │  │  │  Display name  Port (readonly)      │ │  │
│  │  Runtime   │  │  │  Default model (select grouped)     │ │  │
│  │  Channels  │  │  │  Tools profile (select)             │ │  │
│  │  Devices   │  │  │                                     │ │  │
│  │  MCP  [3]  │  │  │  PROVIDERS                          │ │  │
│  │  Permissions│ │  │  [Anthropic]  sk-ant-***  [Change]  │ │  │
│  │  Config    │  │  │  [+ Add provider]                   │ │  │
│  └────────────┘  │  └─────────────────────────────────────┘ │  │
│                  └──────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

### Principe de navigation par panneau

Clic sur un item de la sidebar → **remplace** le contenu par le panneau correspondant (pas de scroll). Une seule section visible à la fois. Section active par défaut : **General** (ou `initialSection` passé en prop).

### Header bar

Toujours visible. Fond `--bg-surface`, bordure basse.

| Élément | Description |
|---|---|
| **← Back** | Outline gris, hover accent. Émet `navigate { slug: null }` → retour vue Instances. |
| **Titre** | "**slug** — Settings" (`font-size: 16px`, `font-weight: 700` sur le slug). |
| **[Cancel]** | Visible si `_hasChanges`. Annule toutes les modifications dirty. |
| **[Save]** | Visible si `_hasChanges`. Disabled si erreur de validation ou `_saving`. Appelle `PATCH /api/instances/:slug/config`. |

### Sidebar

Navigation par 7 panneaux : **General**, **Agents**, **Runtime**, **Channels**, **MCP**, **Permissions**, **Config**. *(Devices panel removed in v0.34.0)* Item actif : fond `--accent-subtle`, couleur `--accent`, `font-weight: 600`. Clic → `_activeSection = section` (swap immédiat du contenu).

**Badges numériques** sur les items de la sidebar :

| Item | Badge | Condition |
|---|---|---|
| **MCP** | Numérique accent | Nombre de serveurs MCP connectés (`_mcpConnectedCount > 0`) |
| **Permissions** | Numérique accent | Nombre de demandes de permission en attente (`_pendingPermissionsCount > 0`) |

### Champs modifiés

Les champs modifiés affichent une bordure `--accent` (classe `changed`). Les champs readonly ont un fond `--bg-surface`.

### Section General

Grid 2 colonnes.

| Champ | Type | Comportement |
|---|---|---|
| **Display name** | Input texte | Éditable |
| **Port** | Readonly | Non modifiable (`:XXXXX`) |
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

**Agents — List** : tableau des agents (ID, Name, Model, Workspace, **Actions**). Affiché si `agents.length > 0`.

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

### Section Runtime

Panneau informatif + chat intégré. Pas de champs éditables (Save/Cancel non affichés quand active).

```
┌─ Runtime ─────────────────────────────────────────────────────┐
│  This instance runs on claw-runtime — the native claw-pilot   │
│  agent engine.                                                │
│                                                               │
│  Engine      claw-runtime                                     │
│  Config file runtime.json                                     │
│                                                               │
│  ── Chat ──────────────────────────────────────────────────── │
│  ┌─ cp-runtime-chat (480px hauteur) ────────────────────────┐ │
│  │  [Session selector ▼]  [+ New]                           │ │
│  │  ─────────────────────────────────────────────────────── │ │
│  │  (messages)                                              │ │
│  │  ─────────────────────────────────────────────────────── │ │
│  │  [textarea…]  [Send]                                     │ │
│  └──────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

| Élément | Description |
|---|---|
| **Engine** | Valeur fixe `claw-runtime`, monospace |
| **Config file** | Valeur fixe `runtime.json`, monospace muted |
| **Chat** | Composant `cp-runtime-chat` intégré dans un conteneur `height: 480px`, `border: 1px solid --bg-border`, `border-radius: --radius-md` |

### Toast de confirmation

Apparaît en bas à droite (`position: fixed`, `bottom: 80px`, `right: 24px`) pendant 4s après sauvegarde.

| Type | Couleur | Message |
|---|---|---|
| **success** | Vert | "Configuration saved — hot-reload applied" |
| **warning** | Ambre | "Configuration saved — instance restarted (raison)" |
| **error** | Rouge | Message d'erreur |

**Avertissement port changé** : si le port a changé, un bandeau `⚠` s'affiche sous le header : "Port changed — browser pairing will be lost after restart. Go to the Devices tab to approve the new request."

### Section Channels (`cp-instance-channels`)

**Fichier source** : `ui/src/components/instance-channels.ts`

Panneau autonome — pas de Save/Cancel global (sauvegarde inline par canal). Affiche une card par canal de communication.

**Machine à états Telegram (3 états) :**

| État | Condition | Rendu |
|---|---|---|
| **A — unconfigured** | `channels.telegram === null` OU `enabled=false` sans token | "Telegram is not configured" + bouton **[Configure Telegram]** |
| **B — init-form** | Clic sur [Configure Telegram] | Formulaire d'initialisation inline |
| **C — configured** | `enabled=true` OU token présent | Formulaire d'édition complet |

**État A — Non configuré :**

```
┌─ ✈ Telegram Bot ─────────────────────── ○ Inactive ─┐
│  Telegram is not configured for this instance.       │
│                              [Configure Telegram]    │
└──────────────────────────────────────────────────────┘
```

**État B — Formulaire d'initialisation :**

```
┌─ ✈ Telegram Bot ─────────────────────────────────────┐
│  Bot token *  [_________________________]  [BotFather ↗] │
│  DM policy    [Pairing (code approval) ▼]            │
│  Group policy [Allowlist               ▼]            │
│                                  [Cancel]  [Add]     │
└──────────────────────────────────────────────────────┘
```

**État C — Configuré :**

```
┌─ ✈ Telegram Bot [N] ─────────────── ● Configured ───┐
│  [toggle] Enabled                                    │
│  Bot token  [sk-***masked***]  [Change]  [×]         │
│  DM policy  [Pairing ▼]                              │
│  Group policy [Allowlist ▼]                          │
│                                                      │
│  ── Pairing requests ──────────────────── [Refresh] ─│
│  @username  Code: 1234-5678  2m ago  [Approve] [Reject]│
│  Approved senders: 3                                 │
│                                                      │
│  [Bannière restart si requiresRestart]               │
│                              [Cancel]  [Save]        │
└──────────────────────────────────────────────────────┘
```

| Champ | Valeurs |
|---|---|
| **DM policy** | `pairing` (code approval) / `open` (allow all) / `allowlist` / `disabled` |
| **Group policy** | `open` (allow all groups) / `allowlist` / `disabled` |

**Badge pending** : nombre rouge sur le titre "Telegram Bot" si des demandes de pairing sont en attente.

**Status badge** : `● Configured` (vert) si enabled + token présent ; `◎ No token` (ambre) si enabled sans token ; `○ Inactive` (gris) si disabled.

**Bannière restart** : fond ambre, message "Changes require a runtime restart to take effect." + bouton **[Restart runtime]**.

**Pairing requests** : visible uniquement si `dmPolicy === "pairing"`. Polling toutes les 10s si des demandes sont en attente. Boutons **[Approve]** et **[Reject]** par demande.

**Canaux "Coming soon"** : WhatsApp et Slack affichés en cards grises `opacity: 0.55` avec badge "COMING SOON".

### ~~Section Devices~~ *(removed in v0.34.0)*

Device pairing has been removed. The `cp-instance-devices` component and sidebar panel are no longer rendered. The `rt_pairing_codes` table is retained in the DB (additive-only policy).

### Section MCP (`cp-instance-mcp`)

**Fichier source** : `ui/src/components/instance-mcp.ts`

Panneau autonome — pas de Save/Cancel. Affiche les serveurs MCP connectés à l'instance claw-runtime.

```
┌─ MCP ─────────────────────────────────────────────────┐
│                                                       │
│  CONNECTED [3] ────────────────────────────────────── │
│  ┌──────────────────────────────────────────────────┐ │
│  │  ● my-server    stdio   5 tools  [Tools ▾]       │ │
│  │  ● web-search   http    3 tools  [Tools ▾]       │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  DISCONNECTED [1] ─────────────────────────────────── │
│  ┌──────────────────────────────────────────────────┐ │
│  │  ○ old-server   stdio   0 tools                  │ │
│  │    ⚠ Connection refused                          │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  [↻ Refresh]                                          │
└───────────────────────────────────────────────────────┘
```

| Élément | Description |
|---|---|
| **Groupe CONNECTED** | Titre vert + badge count vert. Serveurs avec `connected: true`. |
| **Groupe DISCONNECTED** | Titre gris + badge count gris. Serveurs avec `connected: false`. |
| **Ligne serveur** | Point vert/gris + nom + badge type (`stdio`/`http`) + count outils + bouton **[Tools ▾]** si outils disponibles |
| **Expand outils** | Grid 2 colonnes, fond `--bg-hover`, noms monospace |
| **Erreur serveur** | `⚠ message` rouge sous la ligne si `lastError` défini |
| **[↻ Refresh]** | Recharge manuellement |

**Polling** : toutes les 30s quand le panneau est actif.

**Badge sidebar** : nombre de serveurs connectés (`mcp-connected-count-changed` event).

### Section Permissions (`cp-instance-permissions`)

**Fichier source** : `ui/src/components/instance-permissions.ts`

Panneau autonome — pas de Save/Cancel. Affiche les règles de permission persistées et les demandes en attente.

```
┌─ PERMISSIONS ─────────────────────────────────────────┐
│                                                       │
│  ┌─ PENDING REQUESTS (2) ────────────────────────────┐│
│  │  Bash  /tmp/**  2m ago  [Handle]                  ││
│  │  Read  ~/docs/* 5m ago  [Handle]                  ││
│  └───────────────────────────────────────────────────┘│
│                                                       │
│  PERSISTENT RULES (3)                                 │
│  Approved by user — survive restarts                  │
│  ┌──────────────────────────────────────────────────┐ │
│  │  [allow]  Bash  /tmp/**   global  2h ago  [✕]   │ │
│  │  [deny]   Read  ~/secret  agent1  1d ago  [✕]   │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  [↻ Refresh]                                          │
└───────────────────────────────────────────────────────┘
```

| Élément | Description |
|---|---|
| **Pending requests** | Fond ambre transparent, bordure ambre. Visible si `action === "ask"`. Bouton **[Handle]** → émet `open-permission-overlay` pour ouvrir l'overlay global. |
| **Persistent rules** | Règles `allow`/`deny`. Badge action coloré (vert/rouge). Colonnes : action, permission, pattern, scope, âge relatif, bouton **[✕]** (revoke). |
| **Revoke** | Appel `DELETE /api/instances/:slug/runtime/permissions/:id`. Spinner inline pendant l'opération. |
| **[↻ Refresh]** | Recharge manuellement |

**Badge sidebar** : nombre de demandes en attente (`_pendingPermissionsCount`).

### Section Config (`cp-instance-config`)

**Fichier source** : `ui/src/components/instance-config.ts`

Panneau de configuration avancée du runtime. Sous-navigation par onglets. Save/Cancel propres au panneau (indépendants du Save global).

```
┌─ CONFIG ──────────────────────────────────────────────┐
│  [Models]  [Compaction]  [Sub-agents]                 │
│  ─────────────────────────────────────────────────── │
│  (contenu selon onglet actif)                         │
│                                                       │
│  [Save]  [Cancel]  ← visible si dirty                 │
└───────────────────────────────────────────────────────┘
```

**Onglet Models :**

| Champ | Description |
|---|---|
| **Internal model** | Input texte. Modèle utilisé pour la compaction et les résumés (ex: `anthropic/claude-haiku-3-5`). |
| **Model aliases** | Liste d'alias (id → provider + model). Chaque alias : 3 inputs inline (alias, provider, model) + bouton **[✕]**. Bouton **[+ Add alias]** en bas. |

**Onglet Compaction :**

| Champ | Description |
|---|---|
| **Threshold** | Slider 50–99%. Pourcentage de la fenêtre de contexte avant déclenchement. |
| **Reserved tokens** | Input number 1000–32000. Tokens réservés pour le résumé. |

**Onglet Sub-agents :**

| Champ | Description |
|---|---|
| **Max spawn depth** | Slider 0–10. Profondeur maximale d'imbrication des sous-agents. |
| **Max active children per session** | Slider 1–20. Nombre max de sous-agents actifs simultanément par session. |

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

## ~~Composant : Devices (`cp-instance-devices`)~~ *(removed in v0.34.0)*

> **DEPRECATED** — Device pairing was removed in v0.34.0. This component is no longer rendered. The documentation below is retained for historical reference only.

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

## Composant global : Overlay de permission (`cp-permission-request-overlay`)

**Fichier source** : `ui/src/components/permission-request-overlay.ts`

Overlay fixe coin bas-droit (`bottom: 24px`, `right: 24px`, `z-index: 9999`, `width: 480px`). Affiché automatiquement quand un agent claw-runtime émet un événement `permission.asked` via le stream SSE. Géré par `cp-app` (ou le composant parent qui surveille l'instance active).

```
┌─ 🔐 Permission Request ──────────────────────── [✕] ─┐
│                                                       │
│  Description de la demande (si fournie)               │
│                                                       │
│  ┌─ Détails ────────────────────────────────────────┐ │
│  │  Permission  Bash                                │ │
│  │  Pattern     /tmp/**                             │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  42s  ████████████████░░░░░░░░  (countdown bar)       │
│                                                       │
│  [toggle]  This time only / Always (for this agent)   │
│                                                       │
│  [Deny]  [Deny with feedback]  [Approve]  [Dismiss]   │
└───────────────────────────────────────────────────────┘
```

### Comportement

| Élément | Description |
|---|---|
| **Header** | Fond rouge transparent `rgba(239,68,68,0.06)`. Titre rouge `--state-error` + icône 🔐. Badge count si plusieurs demandes en file. Bouton **[✕]** dismiss. |
| **Description** | Texte libre fourni par l'agent (optionnel). |
| **Détails** | Fond `--bg-hover`, bordure `--bg-border`. Lignes : Permission (monospace) + Pattern (monospace). |
| **Countdown** | Barre de progression rouge qui se vide en 60s. Auto-dismiss à 0. |
| **Toggle persist** | "This time only" (défaut) / "Always (for this agent)". Contrôle si la règle est persistée. |
| **[Deny]** | Rouge outline. Envoie `decision: "deny"` immédiatement. |
| **[Deny with feedback]** | Rouge outline transparent. Premier clic → affiche textarea commentaire. Deuxième clic → envoie avec commentaire. |
| **[Approve]** | Vert outline. Envoie `decision: "allow"`. |
| **[Dismiss]** | Gris, `margin-left: auto`. Retire la demande de la file sans répondre. |

### File FIFO

Les demandes s'accumulent en file. Une seule est affichée à la fois. Après réponse ou dismiss, la suivante s'affiche et le countdown repart à 60s.

### Source SSE

Écoute `GET /api/instances/:slug/runtime/chat/stream`. Événement `permission.asked` → ajoute à la file.

### API de réponse

`POST /api/instances/:slug/runtime/permission/reply` avec `{ permissionId, decision, persist, comment? }`.

---

## Composant global : Bus Alerts (`cp-bus-alerts`)

**Fichier source** : `ui/src/components/bus-alerts.ts`

Toasts d'alertes live positionnés en bas-droit (`bottom: 100px`, `right: 24px`, `z-index: 9998`). Affichés au-dessus du footer, en-dessous de l'overlay de permission. Maximum 3 toasts simultanés (FIFO — le plus ancien est retiré si dépassé).

```
                              ┌─ Toast (360px) ──────────────────┐
                              │ ⚠  Doom loop detected            │
                              │    Agent: researcher             │
                              │                              [✕] │
                              └──────────────────────────────────┘
                              ┌─ Toast ──────────────────────────┐
                              │ ♥  Heartbeat alert               │
                              │    Message de l'agent...  [View] │
                              │                              [✕] │
                              └──────────────────────────────────┘
```

### Types d'alertes

| Type d'événement | Variante | Icône | Titre | Persistant |
|---|---|---|---|---|
| `tool.doom_loop` | warning | ⚠ | "Doom loop detected" | Oui |
| `heartbeat.alert` | warning | ♥ | "Heartbeat alert" | Oui |
| `provider.failover` | info | ↺ | "Provider failover" | Non (8s) |
| `provider.auth_failed` | error | ✕ | "Provider auth failed" | Oui |
| `llm.chunk_timeout` | warning | ⏱ | "LLM chunk timeout" | Non (8s) |
| `agent.timeout` | error | ⏱ | "Agent timeout" | Oui |

### Design

| Élément | Description |
|---|---|
| **Bordure gauche** | 3px colorée selon variante (ambre/rouge/cyan) |
| **Icône** | Colorée selon variante |
| **Titre** | `font-size: 12px`, `font-weight: 700`, `--text-primary` |
| **Corps** | `font-size: 11px`, `--text-secondary`, tronqué avec ellipsis |
| **[View]** | Bouton ambre outline. Visible uniquement pour `heartbeat.alert`. Émet `navigate-to-session { sessionId, slug }`. |
| **[✕]** | Bouton dismiss muted → primary au hover. |
| **Animation** | `slide-in` : translateX(20px) → 0, opacity 0 → 1, 0.2s ease-out. |

### API publique

`addAlert(event: { type, payload, slug? })` — appelé depuis `app.ts` lors de la réception de messages WebSocket bus.

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

*Mis à jour : 2026-03-16 - v0.28.5 : refonte Instance Card (badge ⚡ runtime, pill ⚠ PERM, menu simplifié), sidebar Settings étendue (8 panneaux : General/Agents/Runtime/Channels/Devices/MCP/Permissions/Config), ajout composants cp-instance-channels, cp-instance-mcp, cp-instance-permissions, cp-instance-config, cp-permission-request-overlay, cp-bus-alerts*
