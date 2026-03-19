# Changelog

All notable changes to claw-pilot are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

---

## [0.41.36] — 2026-03-19

### Fixed

- **UI — bouton "Sauver" dans la card Agent** : le bouton icône disquette dans l'en-tête de `cp-agent-detail-panel` (contexte instance) déclenchait une navigation vers `/agent-templates` après chaque clic, car il appelait `saveAgentAsBlueprint` suivi d'un `navigate: {view: "agent-templates"}`. Suppression de la navigation post-save — le template est créé silencieusement, l'utilisateur reste dans le builder.
- **Renommage du bouton** : le label "Save as template" / "Sauver comme template" est remplacé par "Save" / "Sauver" dans les 6 langues, car la card est utilisée dans plusieurs contextes et le nom précédent était trompeur.

---

## [0.41.35] — 2026-03-19

### Fixed

- **UI — card Agent : redirections spurieuses après sauvegarde de fichier** : corriger un anti-pattern Lit introduit lors de la refacto `cp-agent-file-editor`. Les fonctions `loadFile`/`saveFile` étaient recréées à chaque `render()` (factory calls inline), ce qui provoquait des cycles `updated()` parasites dans le child component et, sous certaines conditions de scheduling, déclenchait un event `navigate` vers `/agent-templates` après chaque sauvegarde. Fix : mémoïsation des callbacks comme class fields stables, reconstruits uniquement quand `agent`, `context` ou `templateId` changent (`agent-detail-panel.ts`, `agent-template-detail.ts`).
- **UI — perte d'édition en cours dans `cp-agent-file-editor`** : l'array `filenames` était recalculé inline dans `render()` de `agent-template-detail`, ce qui déclenchait le reset complet du cache et de l'état d'édition à chaque re-render du parent. Fix : `_filenames` est maintenant un class field stable, alimenté une seule fois après le fetch dans `_load()`.
- **UI — `context` inline object dans les parents de `cp-agent-detail-panel`** : dans `agents-builder.ts`, `instance-settings.ts` et `blueprint-builder.ts`, le `PanelContext` était créé inline (`${{ kind: "instance", slug: this.slug }}`), provoquant des rebuilds inutiles des closures file-editor à chaque render du parent. Fix : `_panelContext` est maintenant un class field, reconstruit uniquement dans `updated()` quand `slug` ou `blueprintId` change.

### Changed

- **Suppression du fichier `IDENTITY.md`** dans les workspaces agents : remplacé définitivement par `BOOTSTRAP.md` (fichier d'onboarding). Mis à jour dans : `constants.ts`, `system-prompt.ts`, `runtime.ts` (route), templates workspace, dialog de création de templates, locales (6 langues), tests.

---

## [0.41.34] — 2026-03-19

### Added

- **Visionneur de system prompt en temps réel** dans l'onglet CONTEXT du panel /pilot :
  - Le system prompt construit (le prompt réel envoyé au LLM) est affiché sous la barre de consommation de tokens dans l'onglet CONTEXT.
  - **Sections collapsibles** : le prompt est parsé en blocs XML (`<agent_identity>`, `<instructions>`, `<teammates>`, `<env>`, `<behavior>`, `<session_context>`, `<available_skills>`) — chaque section est un accordion indépendant avec icône, label, compteur de caractères et bouton Copier.
  - **Mise à jour temps réel** via bus event `session.system_prompt` émis dans `prompt-loop.ts` après chaque reconstruction du prompt. Le frontend écoute l'event SSE et patche `_context.systemPrompt` sans rechargement complet.
  - **Cache en mémoire** (`system-prompt-cache.ts`) : le dernier prompt construit par session est mémorisé et servi par l'endpoint `GET .../sessions/:id/context` (champ `systemPrompt` + `systemPromptBuiltAt`).
  - État vide informatif ("Disponible après le premier message") tant qu'aucun appel LLM n'a eu lieu pour la session.
  - i18n : 6 clés ajoutées en 6 langues (en/fr/de/es/it/pt).

---

## [0.41.33] — 2026-03-19

### Added

- **Niveau 3+ — Skills visibles dans le bloc `<teammates>`** : le system prompt des agents injecte désormais les compétences déclarées (`expertIn`) de chaque agent dans le bloc `<teammates>`. Le LLM voit directement qui sait faire quoi au moment de raisonner, sans attendre d'appeler le `task` tool.
  - Format : `- dev-agent (Dev) [skills: code-review, test-writing]`
  - Hint de routing ajouté quand au moins un agent déclare des skills : `"To route by skill, use the skill name as subagent_type in the task tool (e.g. task({ subagent_type: "code-review", ... }))."`
  - `runtimeAgentConfigs` maintenant passé à `buildSystemPrompt()` depuis `prompt-loop.ts`
  - 6 nouveaux tests unitaires couvrant les cas : skills affichés, hint présent/absent, marker [you], runtimeAgentConfigs absent (rétrocompat)

---

## [0.41.32] — 2026-03-19

### Added

- **Niveau 3 — Routing A2A par compétences** (`expertIn`) :
  - Nouveau champ `expertIn: string[]` dans `AgentConfigSchema` (runtime.json) et `Agent.Info` (runtime registry). Permet à chaque agent primary de déclarer ses domaines de compétence (ex: `["code-review", "test-writing"]`).
  - **Résolution par skill dans le `task` tool** : si `subagent_type` ne matche ni par ID d'agent ni par nom built-in, le moteur cherche le premier agent primary qui déclare cette skill dans `expertIn`. Exemple : `task({ subagent_type: "code-review", prompt: "..." })` → résout vers l'agent qui a `expertIn: ["code-review"]`.
  - Les skills déclarées sont affichées dans la description du `task` tool (à côté du nom de l'agent) pour guider le LLM.
  - L'error message en cas d'agent inconnu liste désormais les skills disponibles pour le routing.
  - **UI — onglet Config** : nouveau champ "Skill routing" avec tag input pour éditer `expertIn`. Saisie libre par entrée ou virgule, avec suppression par tag. Sauvegardé via PATCH config.
  - **API** : `expertIn` exposé dans `GET /api/instances/:slug/config` (champ `expertIn: string[]` par agent) et patchable via `PATCH /api/instances/:slug/config`.
  - **i18n** : 5 nouvelles clés (`cfg-skill-routing`, `cfg-expert-in-label`, `cfg-skill-remove-aria`, `cfg-expert-in-placeholder`, `cfg-expert-in-add`) dans les 6 langues (en, fr, de, es, it, pt).

---

## [0.41.31] — 2026-03-19

### Changed

- **UI — édition de fichiers agents** : extraction du code d'édition de fichiers workspace en un composant réutilisable `cp-agent-file-editor`. Ce composant est maintenant utilisé dans les 3 surfaces d'édition : agents d'instance, agents de blueprint, et templates d'agent (`/agent-templates`). La page templates gagne ainsi le preview Markdown (Edit/Preview), le dirty tracking, le cache de fichiers et la confirmation avant de quitter sans sauvegarder (discard dialog), auparavant disponibles uniquement dans le panneau agent.

---

## [0.41.30] — 2026-03-19

### Changed

- **Agent templates — création** : les fichiers workspace (SOUL.md, HEARTBEAT.md, AGENTS.md, TOOLS.md, USER.md, IDENTITY.md) sont désormais pré-remplis avec les templates par défaut de l'application à la création d'un template d'agent, au lieu d'être vides. Les placeholders (`{{agentName}}`, `{{agentId}}`, etc.) sont substitués avec le nom et l'ID du template.

---

## [0.41.29] — 2026-03-19

### Added

- **Agent templates — create dialog** (Niveau 2 V2) : dialog "New Agent Template" pour créer un template from scratch (nom, description, catégorie, fichiers workspace par défaut). Bouton "+ New template" dans la galerie désormais fonctionnel.
- **Agent templates — "Use template" flow** (Niveau 2 V2) : bouton "Use" sur les cards de la galerie et "Use template" dans la vue détail. Ouvre le dialog de création d'agent avec sélecteur d'instance cible, pré-rempli avec le nom du template. Appelle `POST /agents/from-template` avec copie des fichiers workspace.
- **Agent templates — import/export YAML** (Niveau 2 V2) :
  - Export : `GET /api/agent-blueprints/:id/export` retourne un fichier YAML avec métadonnées + fichiers workspace. Bouton "Export" dans la vue détail.
  - Import : `POST /api/agent-blueprints/import` accepte du YAML et crée un template. Bouton "Import YAML" avec file picker dans la galerie.
- **API** : `createAgentBlueprint()` accepte désormais le champ `category`. Nouvelles fonctions `exportAgentBlueprint()` et `importAgentBlueprint()`.
- **i18n** : traductions du dialog de création, du flow "Use template", et de l'import/export dans les 6 langues (en, fr, de, es, it, pt).

### Fixed

- Nettoyage des imports inutilisés dans `agent-templates-view.ts` et `agent-template-detail.ts` (0 warnings oxlint UI).

---

## [0.41.28] — 2026-03-18

### Added

- **Agent blueprints — dashboard UI** (Niveau 2, Phase 2) : interface complète pour la gestion des templates d'agent.
  - **Page "Templates"** : galerie des agent blueprints avec cards (nom, description, catégorie, nombre de fichiers, date). Actions : clone, suppression, ouverture du détail.
  - **Vue détail** : métadonnées du template + éditeur de fichiers workspace (onglets par fichier, textarea avec sauvegarde).
  - **Navigation** : onglet "Templates" dans la barre de nav (hash routes `#/agent-templates` et `#/agent-templates/:id`).
  - **"Save as template"** : bouton dans le detail panel d'un agent (contexte instance) pour créer un template depuis un agent existant.
  - **Types + API** : `AgentBlueprintInfo`, `AgentBlueprintFileContent` + 10 fonctions API (`fetchAgentBlueprints`, `createAgentBlueprint`, `cloneAgentBlueprint`, `saveAgentAsBlueprint`, `createAgentFromTemplate`, etc.).
  - **i18n** : traductions du nav tab et du bouton "Save as template" dans les 6 langues.

---

## [0.41.27] — 2026-03-18

### Added

- **Agent blueprints — backend** (Niveau 2, Phase 1) : infrastructure complète pour les templates d'agent réutilisables.
  - **DB migration v16** : tables `agent_blueprints` (id TEXT PK, name, description, category, config_json, icon, tags) + `agent_blueprint_files` (workspace files par blueprint).
  - **Repository** : `AgentBlueprintRepository` — CRUD blueprints + fichiers + clone (deep copy).
  - **API** (11 routes) : `GET/POST /api/agent-blueprints`, `GET/PUT/DELETE .../\:id`, `POST .../\:id/clone`, `GET/PUT/DELETE .../\:id/files/\:filename`, `POST .../from-agent` (Save as template).
  - **Create from template** : `POST /api/instances/\:slug/agents/from-template` — crée un agent dans une instance en copiant les fichiers workspace d'un blueprint.

---

## [0.41.26] — 2026-03-18

### Added

- **Champ `category` dans `Agent.Info`** (Niveau 1.1) : formalise la classification implicite des agents built-in. Trois valeurs : `"user"` (Pilot, agents custom), `"tool"` (explore, general, build, plan), `"system"` (compaction, title, summary). Le champ est exposé dans l'API builder (`AgentPayloadItem.category`) et affiché dans le dashboard (badges "Tool", "System", "Agent" sur les cards mini + badge catégorie dans le detail panel). Traductions ajoutées dans les 6 langues.
- **`Agent.Summary` étendu** : inclut désormais `category` dans le type Summary et la fonction `toSummary()`.
- **Tests** : 5 nouveaux tests validant les catégories des agents built-in, des agents custom, et de `toSummary()`.

---

## [0.41.25] — 2026-03-18

### Added

- **Heartbeat UI — champs `tz` et `model`** : l'onglet Heartbeat expose désormais le sélecteur de timezone (requis si `activeHours` est défini) et le modèle dédié pour les ticks. Le plumbing existait déjà (state, load, save) — seuls les inputs HTML manquaient.

### Fixed

- **`bootstrapFiles` câblé end-to-end** : la feature "Additional workspace files (globs)" dans l'onglet Config de l'agent card était une feature morte — le GET ne retournait pas le champ, le PATCH ne l'acceptait pas, le save UI ne l'envoyait pas. Renommage `workspaceGlobs` → `bootstrapFiles` en UI pour aligner sur le schéma backend, et câblage complet (GET response, PATCH schema + apply, UI save).

---

## [0.41.24] — 2026-03-18

### Fixed

- **Agent card — onglets Config et Heartbeat inéditables** : `_initConfigTab()` et `_initHeartbeatTab()` appellent désormais `fetchInstanceConfig()` pour charger les vraies valeurs depuis `runtime.json` au lieu de lire les champs `.config`/`.heartbeat` absents de `AgentBuilderInfo`. Un spinner s'affiche pendant le chargement. Les onglets Config et Heartbeat sont masqués en contexte Blueprint (ces données sont propres aux instances).

---

## [0.41.23] — 2026-03-18

### Changed

- **Renommage de l'agent par défaut `main` → `pilot`** : l'agentId et le nom d'affichage de l'agent par défaut passent de `"main"` / `"Main"` à `"pilot"` / `"Pilot"`. Impacts : `createDefaultRuntimeConfig`, agent synthétique dans `discovery.ts` et `agent-sync.ts`, workspace path `workspaces/pilot`, fallback API création d'instance, seed blueprint, wizard CLI, dialog UI. Les instances existantes ne sont pas affectées (recréer pour bénéficier du nouveau nom).

---

## [0.41.22] — 2026-03-18

### Fixed

- **Dead code supprimé** : `getWorkspaceCacheSize()` était exportée depuis `workspace-cache.ts` mais jamais utilisée. Suppression pour corriger le check knip en CI.

---

## [0.41.21] — 2026-03-18

### Fixed

- **File tools utilisaient `process.cwd()` au lieu du workDir de l'instance** : glob, grep, read, edit, write, multiedit, bash et skill utilisaient `process.cwd()` comme répertoire racine. Quand le daemon claw-runtime est lancé depuis le dashboard, `process.cwd()` vaut `/` (racine du filesystem), causant des scans infinis. Fix : ajout du champ `workDir` dans `Tool.Context`, injecté depuis `prompt-loop.ts`. Tous les file tools utilisent désormais `ctx.workDir ?? process.cwd()`.

---

## [0.41.20] — 2026-03-18

### Fixed

- **Parties `tool_call` dupliquées et spam `chunk_timeout`** : `tool-set-builder` réutilise désormais la partie créée par `onChunk` (Path-A) via `getOrCreateToolCallPart()`, éliminant les doublons sans `toolCallId` qui causaient `MissingToolResultsError`. Le watchdog `chunk_timeout` est maintenant annulé dès le premier timeout pour éviter les événements répétés toutes les 5 s. Ajout de la gestion des `tool-error` chunks via `onStepFinish` avec émission d'un `tool-result` synthétique pour maintenir le contexte LLM valide entre les turns de session permanente. Propagation des champs `toolProfile`, `permissions`, `heartbeat`, `humanDelay`, `identity`, `sandbox`, `groupChat` dans team-export/import/schema.

---

## [0.41.19] — 2026-03-18

### Fixed

- **Version courante toujours obsolète dans la bannière (cause racine)** : le cache de 5 minutes sur `SelfUpdateChecker` stockait aussi `currentVersion` (version locale). Après un déploiement manuel, le cache retournait l'ancienne version locale pendant 5 minutes. Fix : seul le résultat GitHub (`latestVersion` + `latestTag`) est mis en cache. `currentVersion` est relue depuis `package.json` sur disque à chaque check — coût négligeable (~1 ms).

---

## [0.41.18] — 2026-03-18

### Fixed

- **Version courante toujours incorrecte dans la bannière de mise à jour** : `_getCurrentVersion()` utilisait `require("../package.json")` dont le résultat est mis en cache par Node à vie dans le process. Après un auto-update (sans restart), le process continuait à lire l'ancienne version depuis le cache de `require`. Fix : lecture directe avec `readFileSync` + `JSON.parse` — pas de cache Node, et `invalidateCache()` réinitialise aussi `_currentVersion` pour relire le fichier au prochain check.
- **`system.ts` lisait `package.json` avec un chemin incorrect** : `../../../package.json` (3 niveaux) au lieu de `../package.json` (1 niveau depuis `dist/`). La version retournée par `GET /api/health` était "unknown" sur le serveur déployé.

---

## [0.41.17] — 2026-03-18

### Fixed

- **Auto-update ne redémarre pas le service sur macOS** : la commande `launchctl stop … && sleep 2 && launchctl start …` s'exécutait dans le même shell — `stop` tuait le processus avant que `start` puisse tourner. Fix : le `launchctl start` est maintenant lancé dans un sous-shell décroché (`nohup sh -c 'sleep 3 && launchctl start …' &`) qui survit au kill du parent, puis `launchctl stop` est appelé en dernier.
- **Cache GitHub pour le check de version** : `GET /api/self/update-status` appelait l'API GitHub à chaque requête UI (toutes les 60 s). Le résultat est maintenant mis en cache 5 minutes côté serveur. Le cache est invalidé lors du déclenchement d'un update.

---

## [0.41.16] — 2026-03-18

### Fixed

- **Telegram token ne s'enregistre pas** : après un save dans `cp-instance-channels`, le parent (`cp-instance-settings`) gardait son ancien `_config` et le repassait à l'enfant au prochain re-render (déclenché par le WS health_update), écrasant ainsi le token fraîchement sauvegardé. Fix : l'enfant émet un event `channels-config-saved` avec la config fraîche ; le parent met à jour son `_config` en conséquence.
- **Boucle UX infinie (save → restart → save)** : deux causes combinées.
  1. Le backend retournait `requiresRestart: true` même quand il avait déjà redémarré l'instance automatiquement. Fix : `requiresRestart` est maintenant `false` si le restart automatique a réussi.
  2. `_syncFromConfig()` ne réinitialisait pas `_requiresRestart`, donc la bannière "Restart runtime" persistait après un reload de config. Fix : `_requiresRestart = false` au début de `_syncFromConfig()`.

---

## [0.41.15] — 2026-03-18

### Added

- **A2A primary-to-primary** : le tool `task` peut maintenant déléguer à un agent *primary* (ex: `dev`) en plus des subagents built-in. L'agent cible utilise sa session permanente — son contexte et sa mémoire sont préservés entre les délégations. Le LLM voit les peer agents listés dans la description du tool avec leur `id` comme `subagent_type`.

### Changed

- `buildToolSet` / `createTaskTool` : ajout de `runtimeAgentConfigs` (agents primary du runtime) et `modelAliases` (résolution du modèle du peer). Le `runtimeConfig` complet est maintenant propagé depuis `runPromptLoop` jusqu'au task tool.
- Description du tool `task` : les peer agents primaires apparaissent dans une section dédiée "User-defined primary agents".

---

## [0.41.14] — 2026-03-18

### Fixed

- **A2A : l'agent main ne pouvait pas communiquer avec les autres agents** : le `toolProfile` par défaut de l'agent main était `"coding"`, qui n'inclut pas le tool `task` (le mécanisme réel de communication agent-to-agent). Correction : `toolProfile` passe à `"full"` par défaut pour l'agent main dans `createDefaultRuntimeConfig`.
- **System prompt trompeur** : le bloc `<teammates>` indiquait d'utiliser `"the agentToAgent tool"` alors que le tool s'appelle `task`. Le LLM cherchait un tool inexistant. Correction : le message indique désormais `"the task tool"`.

---

## [0.41.13] — 2026-03-18

### Fixed

- **Bannière de mise à jour persistante** : après une mise à jour sur macOS (MACMINI-INT), le service ne redémarrait pas car `systemctl` n'est pas disponible — le job restait en état `done` indéfiniment. Correction : utilisation de `launchctl stop/start` sur macOS, `systemctl` sur Linux.
- **Dismiss de la bannière ignoré** : fermer la bannière "Updated successfully" via le bouton × ne survivait pas aux rechargements de page (état purement en mémoire). Correction : le dismiss est désormais persisté dans `sessionStorage` avec la clé du job, ce qui le maintient entre les reloads de la même session.

---

## [0.41.12] — 2026-03-18

### Fixed

- **Vue Pilot trop haute** : le conteneur pilot utilisait `height: calc(100vh - 56px - 48px)` hardcodé dans le template, ce qui s'additionnait avec `min-height` du `<main>` et causait un débordement vertical. Correction : `<main>` reçoit la classe `pilot` en vue pilot (`height` exact, `min-height: unset`), et le conteneur interne utilise `height: 100%`.

---

## [0.41.11] — 2026-03-18

### Fixed

- **Scroll horizontal persistant** : `header`, `footer`, `main` et `cp-login-view` manquaient de `width: 100%; box-sizing: border-box` — ils débordaient hors du host malgré `overflow-x: hidden` sur `:host`. Corrigé sur tous les éléments racines du shadow DOM de `cp-app` et sur `cp-login-view`.

---

## [0.41.10] — 2026-03-18

### Fixed

- **UI scroll horizontal/vertical** : le `<main>` affichait 2305 × 1109 px à cause de l'absence de `width: 100%` et `overflow-x: hidden` sur le host `<cp-app>`. Ajout de `width: 100%; max-width: 100vw; overflow-x: hidden` sur le `:host` de `app.ts` et `overflow-x: hidden` sur le `<body>` dans `index.html`.

---

## [0.41.9] — 2026-03-18

### Changed

- **UI full-width** : réduction des marges latérales pour mieux utiliser l'espace disponible.
  - **Header / Footer** : padding latéral réduit de 24 px à 16 px (12 px sur mobile).
  - **Cluster view / Blueprints view** : padding réduit de 24 px à 16 px (12 px sur mobile).
  - **Settings** : suppression du `max-width: 1100px` — la vue Settings utilise désormais 100 % de la largeur. Padding réduit de 24 px à 16 px (12 px sur mobile).

---

## [0.41.8] — 2026-03-18

### Changed

- **UI responsive** : l'application s'adapte désormais aux fenêtres étroites (breakpoint 640 px).
  - **Header** : `flex-wrap` sur les petits écrans, hauteur auto, indicateur WS masqué sous 640 px.
  - **Footer** : hauteur fixe supprimée (`min-height` à la place) — le contenu peut passer sur 2 lignes sans être coupé.
  - **Cluster / Blueprints** : le `.section-header` (titre + bouton "+ New Instance" / "+ New Blueprint") passe en colonne sous 640 px — le bouton n'est plus hors écran.
  - **Settings** : la sidebar (180 px fixe) se transforme en barre de tabs horizontale sous 640 px. Le `.field-grid` passe de 2 colonnes à 1 colonne. Le drawer d'agent utilise `min(420px, 100vw)`.
  - **Pilot header** : les stats de tokens/coût peuvent se réduire (`flex-shrink: 1`) sans déborder.
  - **Agents Builder / Blueprint Builder** : le header d'outils passe en `flex-wrap` et le bouton "+ Add Agent" occupe toute la largeur sous 640 px.
  - **Pilot breadcrumb** : le slug est tronqué avec `text-overflow: ellipsis` si trop long.

---

## [0.41.7] — 2026-03-18

### Fixed

- **Workspace path convention** : standardisation sur `workspaces/<agentId>/` partout dans l'application. Avant, provisioner/sync/discovery utilisaient `workspaces/workspace/` (agent par défaut) et `workspaces/workspace-<id>/` (agents secondaires), tandis que le runtime (`resolveAgentWorkspacePath`, `discoverWorkspaceInstructions`, `resolveWorkspaceDir`, `compaction`, `memory/index`) utilisait des chemins incompatibles (`workspace-<agentId>/` plat dans stateDir ou `workspaces/<agentId>/`). Résultat : les fichiers `SOUL.md`, `USER.md`, `HEARTBEAT.md`, `memory/*.md` n'étaient jamais chargés dans le prompt système — les agents fonctionnaient sans aucun contexte workspace.
- **`resolveAgentWorkspacePath`** : signature simplifiée (suppression du paramètre `agentsList` devenu inutile). Retourne toujours `workspaces/<agentId>` (ou le chemin explicite si fourni dans la config).

---

## [0.41.6] — 2026-03-18

### Changed

- **Instance card** : ajout d'un bouton **"Pilot"** dans le menu popover de la carte instance (visible uniquement si l'instance est `running`), entre Start/Stop et Agents. Ouvre une vue standalone plein écran `/instances/:slug/pilot`.
- **Vue Pilot** : nouvelle route dédiée `#/instances/:slug/pilot` avec header de navigation (← Back / slug / Pilot) et `cp-runtime-pilot` en plein écran. Plus de barre sidebar Settings autour.
- **Settings — sidebar** : suppression de l'entrée "Pilot" de la sidebar. Le Pilot n'est plus une section des Settings.
- **Badge ⚠ PERM** : navigue maintenant directement vers la vue Pilot (au lieu de Settings section runtime).

---

## [0.41.5] — 2026-03-18

### Changed

- **Settings — General** : ajout d'un sélecteur "Default provider" (visible quand plusieurs providers sont configurés sur l'instance). Changer de provider met à jour automatiquement le modèle par défaut vers le premier modèle de ce provider.
- **Settings — General** : le sélecteur "Default model" est maintenant filtré par provider sélectionné (au lieu de montrer tous les modèles de tous les providers configurés en un seul groupe). Les modèles des providers non configurés ne sont pas proposés.
- **Settings — Config / Models** : le champ "Internal model" est maintenant un `<select>` groupé par provider (identique au sélecteur de modèle dans General) quand des providers sont configurés. Inclut une option "— same as default model —" pour utiliser le modèle principal.

---

## [0.41.4] — 2026-03-18

### Fixed

- **Channels — Telegram** : le composant affichait "Telegram n'est pas configuré" même avec un bot configuré. Cause : `connectedCallback()` appelait `_syncFromConfig()` avant que Lit ne passe les props — `this.config` était `null` à ce moment. Corrigé en retirant l'appel dans `connectedCallback()` (l'initialisation se fait maintenant uniquement via `updated()`, après le premier rendu avec les props).

---

## [0.41.3] — 2026-03-18

### Fixed

- **Settings — General** : suppression du champ "Tools profile" (non persisté côté runtime). Le `defaultModel` est maintenant aussi synchronisé dans la DB SQLite en plus de `runtime.json`.
- **Settings — Agents (defaults)** : la compaction mode est maintenant sauvegardée dans `runtime.json`. Suppression des champs factices (`workspace`, `maxConcurrent`, `archiveAfterMinutes`, heartbeat global) qui n'avaient aucun effet.
- **Settings — Agents (panel d'édition)** : les onglets Config (toolProfile, maxSteps, temperature, thinking, timeoutMs…) et Heartbeat sauvegardent maintenant correctement dans `runtime.json` via `PATCH /config` au lieu de `PATCH /agents/:id/meta` qui les rejetait en 400.
- **Settings — Config** : l'onglet Config (modèles internes, alias, compaction threshold, subagents) charge et sauvegarde maintenant correctement depuis/vers `runtime.json` via les bons champs (`agentDefaults.*`).
- **API `PATCH /config`** : schéma Zod étendu pour accepter `agentDefaults` (compaction, subagents, models, defaultInternalModel) et `agents[]` (tous les champs de configuration par agent).

---

## [0.41.2] — 2026-03-17

### Fixed

- **Onglet SYSTEM — "No workspace files detected"** : le endpoint `/context` cherchait les fichiers workspace directement à la racine de `stateDir` (`~/.claw-pilot/instances/<slug>/SOUL.md`) au lieu du vrai dossier workspace (`workspaces/<agentId>/` ou `workspaces/workspace/`). Corrigé en résolvant le dossier workspace avec le même layout que le runtime. Ajout de `MEMORY.md` dans la liste des candidats.

---

## [0.41.1] — 2026-03-17

### Fixed

- **Panel Teammates** : les sous-agents techniques (`explore`, `general`) n'apparaissent plus dans la liste Teammates du Pilot. Seuls les agents `kind: "primary"` y sont affichés.
- **Auto-exclusion Teammates** : l'agent courant ne s'affichait plus dans sa propre liste Teammates — la comparaison `a.name !== agentId` était case-sensitive (`"Main" !== "main"`). Corrigé avec `.toLowerCase()`.

---

## [0.40.1] — 2026-03-17

### Security

- **Workspace isolation** : le `Working directory` affiché à l'agent dans le system prompt pointe désormais vers son workspace (`~/.claw-pilot/instances/{slug}/workspaces/{workspace}`) plutôt que vers la racine de l'instance, évitant d'exposer `.env`, `runtime.json` et `runtime.pid` à l'agent.

### Changed

- Ajout de `agentWorkDir` dans `SystemPromptContext`, `PromptLoopInput` et `RouterInput` — le `workDir` (stateDir) continue d'être utilisé en interne pour la résolution des fichiers workspace, skills et mémoire.

---

## [0.39.0] — 2026-03-17

### Changed

- **Reclassification des agents built-in** : tous les 7 agents built-in (`build`, `plan`, `explore`, `general`, `compaction`, `title`, `summary`) sont désormais des sous-agents techniques (`kind: "subagent"`, `hidden: true` pour `build`, `plan`, `compaction`, `title`, `summary`). `explore` et `general` restent visibles pour le task tool.
- **Agent "Main" comme agent primaire par défaut** : `createDefaultRuntimeConfig()` crée un agent `id: "main"`, `name: "Main"` avec les permissions complètes (`DEFAULT_RULESET + question:allow`) et `persistence: "permanent"`. C'est désormais le vrai agent de travail de l'utilisateur.
- **`defaultAgentName()` réécrit** : plus de préférence hardcodée sur `"build"`. La fonction retourne l'agent avec `isDefault: true`, ou le premier agent visible non-subagent (agents config). Lance une erreur si aucun agent primaire visible n'est trouvé.
- **`isDefault` propagé dans `Agent.Info`** : nouveau champ optionnel, propagé depuis `RuntimeAgentConfig.isDefault` via `createFromConfig()` et `mergeAgentConfig()`.
- **`build` et `plan` ont désormais un prompt inline** : `PROMPT_BUILD` et `PROMPT_PLAN` sont assignés aux agents built-in correspondants (nécessaire en mode subagent).
- **Permissions par défaut pour "Main"** : `createDefaultRuntimeConfig()` inclut maintenant le `DEFAULT_RULESET` complet, plus `question: allow`. Plus de mode "ask" systématique pour chaque outil.
- **Header Pilot affiche le nom d'affichage** : `cp-pilot-header` reçoit désormais `agentName` (display name) en plus de `agentId` et affiche `"Main"` au lieu de `"main"` (ou `"build"`).

### Fixed

- **Nom d'agent incorrect dans le header Pilot** : le header affichait `"build"` (l'id de l'agent built-in) au lieu du nom d'affichage de l'agent config. Corrigé en passant `context.agent.name` au header.

---

## [0.38.1] — 2026-03-17

### Fixed

- **Bandeau "claw-pilot updated"** : ne réapparaît plus après avoir été fermé lors d'un changement de page — le dismiss est maintenant persisté jusqu'à un vrai changement de statut fonctionnel (`idle`/`running`/`done`/`error`), pas à chaque re-rendu du poller

### Changed

- **Layout Instance Settings** : toutes les sections (General, Agents, Channels, MCP, Permissions, Config) utilisent désormais le même layout plein écran que Pilot (`max-width: none`)
- **Hauteur Pilot** : corrigée — `calc(100vh - 56px - 56px - 48px)` prend en compte les 3 couches de chrome (nav app + header settings + save bar), plus de scroll involontaire

---

## [0.38.0] — 2026-03-17

### Added

- **`cp-runtime-pilot` quasi real-time** — chargement automatique de la session permanente au démarrage (sans premier message), messages des autres channels (Telegram, CLI) visibles en temps réel
- **Auto-détection de session** : `_detectPermanentSession()` liste les sessions actives au chargement et sélectionne la plus récente avec `persistent: true` — l'historique s'affiche immédiatement
- **SSE auto-reconnexion** avec backoff exponentiel (1s → 2s → … → 30s max) — plus de perte silencieuse de stream
- **Polling léger 10s** — filet de sécurité pour les messages arrivés pendant une micro-déconnexion SSE
- **`visibilitychange`** — refresh immédiat + réouverture SSE au retour sur l'onglet
- **`message.created` role=user** géré côté client — un message entrant depuis Telegram/CLI déclenche immédiatement `_reloadLastMessages()`
- **Adoption de session via SSE** — si un event arrive avec un `sessionId` avant que l'auto-detect soit terminé, le composant l'adopte immédiatement

### Changed

- **Onglet "Runtime" → "Pilot"** dans la sidebar Instance Settings
- **Bloc en-tête supprimé** dans la section Pilot (Engine, Config file, description) — `cp-runtime-pilot` occupe maintenant toute la surface disponible
- **Layout plein écran** pour la section Pilot : `max-width: none`, hauteur = `100vh - header - savebar`, le composant s'étire avec `flex: 1`

---

## [0.37.0] — 2026-03-17

### Added

- **`cp-runtime-pilot`** — remplace `cp-runtime-chat` par un écran de pilotage complet de l'agent et du LLM :
  - Affichage de l'historique complet des messages avec leurs **parts** : text, tool_call (args + output collapsibles + durée d'exécution), reasoning (collapsible), subtask (lien sous-agent + résumé), compaction (marqueur visuel)
  - **Panneau de contexte** latéral rétractable (5 sections : jauge tokens, tools disponibles, info agent + session tree, system prompt / fichiers workspace, journal d'événements temps réel)
  - **17 event types** bus forwarded via SSE (vs 5 avant) : permissions, provider failover, doom loop, MCP tools changed, agent timeout, subagent completed, etc.
  - Cross-channel : messages de tous les channels dans le même flux
- **Endpoint `GET /sessions/:id/context`** — vue synthétique du contexte LLM (agent config, model capabilities, token usage estimé, tools, MCP servers, workspace files, session tree)
- **Pagination curseur** sur `GET /sessions/:id/messages` (`?limit=50&before=<id>`) + `hasMore` — prépare les sessions permanentes longues
- **`durationMs`** persisté dans le metadata des parts `tool_call` pour affichage côté UI
- `fetchSessionMessages()` et `fetchSessionContext()` dans `api.ts`
- Types `PilotMessage`, `PilotPart`, `SessionContext`, `PilotBusEvent` dans `types.ts`

### Changed

- `cp-runtime-chat` supprimé — remplacé par `cp-runtime-pilot`
- Hauteur du panneau Runtime dans Instance Settings passée de 480px à 560px
- SSE stream : `sessionId` query param désormais optionnel (stream all-instance events)
- `getRuntimeChatStreamUrl()` : `sessionId` rendu optionnel

---

## [0.36.1] — 2026-03-17

### Fixed

- **PLAN-16: Session unique par agent permanent** — la clé de session permanente est maintenant `<slug>:<agentId>` (sans peerId). Un agent permanent a une seule session partagée entre tous les canaux (Telegram, web, CLI). Corrige la fragmentation de sessions introduite en v0.34.0 :
  - `buildPermanentSessionKey(slug, agentId)` — signature réduite à 2 arguments (peerId supprimé)
  - `getOrCreatePermanentSession()` — ne dépend plus du peerId pour la clé
  - Route `POST /runtime/chat` — suppression de la dérivation peerId depuis `X-Device-Id` / IP
  - Migration DB v14 étendue : archive les doublons permanents (garde le plus ancien), recalcule les clés au format `<slug>:<agentId>`, supprime l'index `idx_rt_sessions_permanent`
- **workDir absent du daemon** — `ClawRuntime` reçoit maintenant `workDir` (= `stateDir`) comme 4e argument du constructeur. Les messages reçus via Telegram/WebChat chargent maintenant les fichiers workspace (SOUL.md, IDENTITY.md, AGENTS.md, TOOLS.md, etc.) dans le prompt système. Propagé à `ChannelRouter.route()` et au heartbeat runner.
- **Prompts legacy BUILD_AGENT / PLAN_AGENT** — suppression du champ `prompt` inline hardcodé sur `BUILD_AGENT` et `PLAN_AGENT` dans `defaults.ts`. Ces agents utilisent maintenant leurs fichiers workspace (SOUL.md, IDENTITY.md) ou `DEFAULT_INSTRUCTIONS` en fallback. Les agents internes (compaction, title, summary, explore, general) conservent leur prompt inline.

### Changed

- **UI runtime chat** — le bouton "New session" et l'option dropdown correspondante sont masqués pour les agents permanents. Badge "🔒 Permanent" affiché dans le header du chat. Champ `persistent: boolean` ajouté à `RuntimeSession` et propagé dans le repository.
- **Documentation mise à jour** — CLAUDE.md, main-doc.md, registry-db.md, ux-design.md mis à jour pour PLAN-16 (sessions permanentes, schema v15, suppression Devices).

---

## [0.36.0] — 2026-03-17

### Changed

- **Instance state directories relocated** — moved from `~/.runtime-<slug>/` to `~/.claw-pilot/instances/<slug>/` for better organization and discoverability. All claw-pilot data is now consolidated under `~/.claw-pilot/`:
  - `constants.ts`: replaced `RUNTIME_STATE_PREFIX` with `INSTANCES_DIR`
  - `platform.ts`: removed `getHomeDir()`, added `getInstancesDir()`
  - `discovery.ts`: adapted directory scanning to new structure
  - `provisioner.ts`: creates `instances/` parent directory
  - **DB migration v15**: recalculates `state_dir` and `config_path` for all instances
  - All tests updated and passing (892 tests)

---

## [0.35.0] — 2026-03-17

### Fixed

- **Bug critique "Connection to runtime lost"** — suppression du check `hasBus()` dans les routes du dashboard (`runtime.ts`, `mcp.ts`, `permissions.ts`). Ce check vérifiait le registre bus du processus dashboard, qui est toujours vide car les buses sont créés dans les processus runtime daemon (processus séparés). Conséquence : la route SSE `GET /runtime/chat/stream` retournait systématiquement 404 `RUNTIME_NOT_RUNNING`, bloquant le chat web sur toutes les instances. Le bus est désormais créé lazily par `getBus()` dans le processus dashboard lors du premier appel à `runPromptLoop()`.

---

## [0.34.0] — 2026-03-16

### Added

- **Sessions permanentes cross-canal (PLAN-15c/d)** — un agent `primary` a désormais une seule session par utilisateur, indépendante du canal (chat, Telegram, CLI) :
  - `getOrCreatePermanentSession()` — session unique scopée par `(instanceSlug, agentId, peerId)` sans canal
  - `ChannelRouter` : garde-fou — les agents `kind: "subagent"` ne peuvent plus recevoir de messages utilisateur
  - `createDefaultRuntimeConfig()` : l'agent `main` est explicitement `persistence: "permanent"`
  - `POST /runtime/chat` : utilise `getOrCreatePermanentSession()` pour les agents permanents
  - `ui/api.ts` : `deviceId` stable en `localStorage` envoyé via `X-Device-Id` pour garantir la continuité de session entre rechargements
- **UI services** — extraction de `app.ts` en modules testables :
  - `ui/src/services/auth-state.ts` : encapsulation du token Bearer (remplace `window.__CP_TOKEN__`)
  - `ui/src/services/ws-monitor.ts` : gestion WS avec auth par message applicatif (token plus visible en query param)
  - `ui/src/services/router.ts` : routage hash-based extrait comme fonctions pures
  - `ui/src/services/update-poller.ts` : polling self-update extrait comme classe
- **Runtime chat UI** — header compact (36px) avec sélecteur d'agent :
  - Combo agent remplace la combo session — affichée uniquement si plusieurs agents configurés
  - Stats (msg count, coût) inline dans le header — stats bar supprimée
- **DB migration v14** — index composite `idx_rt_messages_session_role` sur `(session_id, role)` pour optimiser `countHeartbeatAlerts()`

### Changed

- **`prompt-loop.ts` décomposé** (1100 → 495 lignes) en 4 modules cohésifs :
  - `message-builder.ts` : construction des messages LLM, correction N+1 sur le chargement des parts (une seule requête SQL batch)
  - `tool-set-builder.ts` : toolset Vercel AI SDK, doom-loop, hooks plugin, injection dep circulaire résolue
  - `usage-tracker.ts` : normalisation comptage tokens (Anthropic vs OpenAI)
  - `workspace-cache.ts` : cache mtime/TTL pour les fichiers workspace (SOUL.md etc.)
- **`runtime-session-repository.ts`** — requête SQL enrichie (coût, tokens, nb messages) extraite du route handler vers le repository
- **CSP renforcée** — `unsafe-inline` retiré de `script-src` dans `dashboard/server.ts`
- **`resolveEffectivePersistence()`** exportée depuis `agent/index.ts`

### Removed

- **Device pairing supprimé** (feature morte) : `devices.ts` (CLI), `device-manager.ts` (core), `instance-devices.ts` (UI, 588 lignes), `devices.e2e.test.ts`, route handler, types, traductions i18n

---

## [0.33.0] — 2026-03-16

### Added

- **Mémoire structurée (Phase 4)** — système de mémoire long terme intelligent avec 5 catégories, déduplication, consolidation et decay :
  - `templates/workspace/memory/` — 5 templates mémoire par défaut (`facts.md`, `decisions.md`, `user-prefs.md`, `timeline.md`, `knowledge.md`) créés lors du provisionnement d'un agent `primary`
  - `memory/decay.ts` (nouveau module) — `parseMemoryEntry()`, `applyDecayToFile()`, `extractReferencedContents()` : score de confiance `[0.0-1.0]` décroissant à chaque compaction, suppression des entrées sous `0.3`
  - `appendToMemoryFileDeduped()` dans `writer.ts` — déduplication sémantique via FTS5 avant ajout (fallback sur déduplication basique si index absent)
  - `consolidateMemoryFileIfNeeded()` dans `writer.ts` — consolidation LLM asynchrone quand un fichier dépasse 150 lignes (backup avant écrasement, supprimé après succès)
  - Score `[1.0]` préfixé sur toutes les nouvelles entrées mémoire

### Changed

- `ExtractedKnowledge` dans `compaction.ts` — étendu à 5 catégories : `facts`, `decisions`, `preferences`, `timeline`, `knowledge`
- `EXTRACTION_PROMPT` dans `compaction.ts` — prompt V2 avec 5 catégories et exemples de format
- `compact()` — intègre decay (sauf `timeline.md`) et consolidation asynchrone après extraction
- `readCurrentMemory()` — lit les 5 fichiers mémoire pour la déduplication lors de l'extraction
- `rebuildMemoryIndex()` dans `memory/index.ts` — nettoie les scores `[x.x]` avant indexation FTS5 pour ne pas polluer les recherches
- `AgentProvisioner.createAgent()` — crée les 5 fichiers mémoire pour les agents `primary`
- `templates/workspace/SOUL.md` — section "Memory and Continuity" ajoutée avec liste des fichiers mémoire et instruction `memory_search`

---

## [0.32.0] — 2026-03-16

### Added

- **Session permanente (Phase 3)** — session unique cross-canal par utilisateur, jamais archivée, avec contexte de reprise après restart :
  - `getOrCreatePermanentSession()` dans `session.ts` — trouve ou crée la session permanente scopée par `(instanceSlug, agentId, peerId)` sans canal ; réactive automatiquement une session archivée par force
  - Titre initial des sessions permanentes = `agentId` (mis à jour par l'agent `title` après la première interaction)
  - `SystemPromptContext` étendu — nouveaux champs optionnels `db`, `sessionId`, `runtimeConfig` (backward-compat)
  - `getCompactionSummary()` + `buildSessionContextBlock()` dans `system-prompt.ts` — injection du dernier résumé de compaction dans le prompt système sous `<session_context>` pour les agents permanents (continuité après restart)
  - `PromptLoopInput.runtimeConfig` — nouveau champ optionnel pour transmettre la config complète à `buildSystemPrompt()`
  - `CompactionConfigSchema.periodicMessageCount` — déclenchement périodique de la compaction tous les N messages pour les agents permanents (0 = désactivé, défaut)
  - Compaction périodique dans `prompt-loop.ts` — flag `compactedThisTurn` pour éviter double compaction dans le même tour

### Changed

- `ChannelRouter.findOrCreateSession()` — routage conditionnel : agents permanents → `getOrCreatePermanentSession()`, agents éphémères → comportement actuel
- `buildAgentConfig()` dans `router.ts` — résout et injecte `persistence` dans le `RuntimeAgentConfig` construit dynamiquement
- `runPromptLoop()` — passe `db`, `sessionId` et `runtimeConfig` à `buildSystemPrompt()`
- `buildSystemPrompt()` — injecte `<session_context>` après `BEHAVIOR_BLOCK` pour les agents permanents avec compaction existante

---

## [0.31.0] — 2026-03-16

### Added

- **Sous-agents comme outils purs (Phase 2)** — formalisation des sous-agents éphémères sans identité propre, sans mémoire, sans capacité de spawn :
  - `promptMode: "subagent"` — nouveau mode de découverte workspace chargeant uniquement `AGENTS.md` et `TOOLS.md` (économie estimée : 4 000–10 000 tokens par appel sous-agent)
  - `DISCOVERY_FILES_SUBAGENT` dans `system-prompt.ts` — liste réduite pour les sous-agents éphémères
  - `resolveDiscoveryFiles()` — inférence automatique du mode depuis `agentKind` si `promptMode` absent (`kind="subagent"` → `"subagent"`, `kind="primary"` → `"full"`)
  - `discoverWorkspaceInstructions()` — nouveau paramètre `skipMemory` — skip la lecture de `memory/*.md` pour les sous-agents
  - `getToolsForAgent()` dans `registry.ts` — wrapper de `getTools()` qui filtre le tool `task` pour les agents `kind="subagent"` (hard rule : les sous-agents ne peuvent jamais spawner)
  - `session/cleanup.ts` (nouveau module) — `cleanupEphemeralSessions()` : suppression en cascade (parts → messages → sessions) des sessions éphémères archivées au-delà du délai de rétention
  - `SubagentsConfigSchema.retentionHours` — délai de rétention configurable (défaut : 72h, 0 = conservation indéfinie)
  - Cleanup déclenché au démarrage du runtime + timer périodique toutes les 6h dans `engine.ts`
  - `ListSessionsOptions.excludeChannels` dans `session.ts` — filtre de canaux pour `listSessions()`
  - `agent-provisioner.ts` — les agents `kind="subagent"` ne reçoivent que `AGENTS.md` et `TOOLS.md` lors du provisionnement

### Changed

- `listSessions()` — nouvelle interface `ListSessionsOptions` avec `excludeChannels` (rétrocompatible)
- `GET /api/instances/:slug/runtime/sessions` — filtre par défaut `channel != "internal"` ; paramètre `?includeInternal=true` pour l'audit
- `runPromptLoop()` — utilise `getToolsForAgent()` avec `agentKind` au lieu de `getTools()`
- `task.ts` — suppression de `canSpawnSubagents` (désormais géré au niveau du registry par `getToolsForAgent`)

---

## [0.30.0] — 2026-03-16

### Added

- **Compaction intelligente (Phase 1)** — transformation de la compaction en système de mémoire cohérent pour sessions permanentes :
  - `listMessagesFromCompaction()` dans `message.ts` — charge uniquement le message de compaction + messages postérieurs (compaction sélective) ; backward-compat si aucune compaction
  - `countMessagesSinceLastCompaction()` dans `message.ts` — comptage des messages depuis la dernière compaction (pour déclenchement périodique Phase 3)
  - `memory/writer.ts` (nouveau module) — `appendToMemoryFile()` avec déduplication basique, `archiveBootstrap()` pour l'archivage post-bootstrap
  - `extractKnowledge()` dans `compaction.ts` — appel LLM dédié avant chaque compaction pour extraire faits/décisions/préférences vers `memory/facts.md`, `memory/decisions.md`, `memory/user-prefs.md` (agents `persistence: "permanent"` uniquement)
  - `COMPACTION_PROMPT_V2` — prompt structuré en 5 sections (Active Goals, Key Constraints, Current State, Open Items, Working Context) remplaçant le prompt en prose libre
  - `CompactionInput.workDir` (optionnel) — passage du répertoire de travail pour l'extraction de connaissances
  - Prompt de l'agent `compaction` mis à jour pour être cohérent avec le nouveau format structuré

### Changed

- `buildCoreMessages()` dans `prompt-loop.ts` — les parts `"compaction"` sont désormais traitées comme du texte (incluses dans le contexte LLM)
- `runPromptLoop()` utilise `listMessagesFromCompaction()` au lieu de `listMessages()` — chargement sélectif du contexte après compaction
- `compact()` passe `workDir` depuis `prompt-loop.ts` — activation de l'extraction de connaissances pour les agents permanents

---

## [0.29.0] — 2026-03-16

### Added

- **Agents permanents — modèle de données (Phase 0)** — fondation pour la distinction agents permanents / sous-agents éphémères :
  - `AgentConfigSchema.persistence` (`"permanent"` | `"ephemeral"`, optionnel) — cycle de vie de session configurable par agent dans `runtime.json`
  - `Agent.Info.kind` (`"primary"` | `"subagent"`) — rôle fonctionnel distinct du champ `mode` (visibilité UI) ; les 7 agents built-in sont annotés explicitement
  - `resolveEffectivePersistence()` — résolution de la persistence effective (config > kind > safe default)
  - `buildPermanentSessionKey()` — clé de session cross-canal `<slug>:<agentId>:<peerId>` (sans canal) pour les sessions permanentes
  - `createSession({ persistent: true })` — création de sessions permanentes avec session_key cross-canal
  - `archiveSession()` garde-fou — refuse d'archiver une session permanente sans `force: true`
  - Bloc `<agent_identity>` injecté en début de prompt système pour les agents `kind: "primary"` (Name, ID, Born, Instance, Channel, Runtime) — position stable pour le cache Anthropic
  - `WorkspaceState.agentCreatedAt` — date de création de l'agent stockée dans `workspace-state.json`
  - `archiveBootstrapContent()` — archive le contenu de `BOOTSTRAP.md` dans `memory/bootstrap-history.md` lors du premier bootstrap

- **DB — migration v13** :
  - `rt_sessions.persistent INTEGER NOT NULL DEFAULT 0` — sessions existantes non affectées (backward-compat)
  - Index partiel `idx_rt_sessions_permanent` pour lookup rapide des sessions permanentes actives
  - `agents.created_at TEXT` avec backfill conditionnel pour les agents existants

---

## [0.28.5-beta] — 2026-03-15

### Fixed

- **UI Channels — token non persisté depuis l'état C** — dans le panneau configuré (état C), quand aucun token n'était présent, le champ password était visible sans que `_tokenEditMode` soit `true` ; `_saveEdit()` conditionnait l'envoi du token à `_tokenEditMode && _newToken`, donc le token saisi n'était jamais envoyé au backend ; la condition est maintenant `_newToken` seul (le token est envoyé dès qu'il est rempli, que ce soit en mode "Change" ou en saisie initiale)

---

## [0.28.4-beta] — 2026-03-15

### Fixed

- **UI Channels — panneau Telegram affiché par défaut** — sur une installation fraîche, `telegram.enabled: false` sans token faisait quand même passer le composant en état "configuré" (état C), affichant le toggle, les policies et la section pairing ; le composant reste maintenant en état "non configuré" (état A) tant que `enabled: false` ET qu'aucun token n'est présent

---

## [0.28.3-beta] — 2026-03-15

### Fixed

- **Telegram — crash au démarrage si token absent** — sur une installation fraîche, `telegram.enabled: true` dans `runtime.json` sans token dans `.env` faisait crasher le runtime avec `ChannelError: Bot token env var not set` ; `TelegramChannel.connect()` logue maintenant un warning et retourne silencieusement, le channel reste en état `not_configured` jusqu'à ce que le token soit configuré

---

## [0.28.2-beta] — 2026-03-15

### Fixed

- **Lifecycle — crash silencieux au démarrage** — si `claw-runtime` mourait avant d'écrire le PID file (config invalide, erreur MCP, erreur channel), le dashboard attendait 10 s en silence puis affichait "PID file not found" sans aucune indication de la cause réelle ; le child process est maintenant surveillé via l'événement `exit` et l'erreur est levée immédiatement avec le code de sortie et les 20 dernières lignes du log
- **Lifecycle — stdout/stderr perdus sur macOS** — le process enfant était spawné avec `stdio: "ignore"` sur Darwin, rendant tout diagnostic impossible ; stdout et stderr sont maintenant redirigés vers `<stateDir>/logs/runtime.log` sur toutes les plateformes
- **Runtime — suppression prématurée du PID file** — en cas d'erreur dans `runtime.start()`, le PID file était supprimé avant que le lifecycle poller ait pu détecter le crash, créant une race condition ; le PID file est maintenant conservé jusqu'au SIGTERM/SIGINT

---

## [0.28.1-beta] — 2026-03-15

### Fixed

- **Telegram — activation ne se sauvegardait pas** — `PATCH /config` pour `channels.telegram` créait silencieusement un `runtime.json` par défaut si absent au lieu d'ignorer le patch ; l'activation est maintenant persistée même sur une instance fraîche
- **Telegram — config perdue quand `enabled: false`** — `buildInstanceConfig` retournait `telegram: null` quand le bot était désactivé, perdant la visibilité sur le token masqué et les policies ; l'objet telegram est maintenant toujours retourné (jamais null quand `runtime.json` existe)
- **Telegram — `dmPolicy`/`groupPolicy` non persistés** — les deux champs n'étaient pas dans le schema Zod ni dans le PATCH handler ; ils sont maintenant correctement lus, écrits et retournés

### Added

- **Telegram — workflow de pairing DM** — les utilisateurs non-autorisés qui envoient un message au bot reçoivent automatiquement un code de pairing (`XXXX-XXXX`) ; l'admin approuve en 1 clic depuis Settings → Channels → Telegram → section "Pairing requests" (visible si `dmPolicy === "pairing"`) ; le code est stocké en DB (`rt_pairing_codes`, channel=telegram) avec le `peer_id` et le username
- **Telegram — routes pairing** — `GET /api/instances/:slug/telegram/pairing` (liste pending + approved), `POST .../approve` (ajoute l'ID à `allowedUserIds`), `DELETE .../pairing/:code` (rejeter)
- **Telegram — UX Settings refonte** — état A (non configuré → bouton "Configure Telegram"), état B (formulaire d'init avec token + dmPolicy + groupPolicy), état C (édition + section pairing avec poll auto 10s + badge numérique si pending)
- **Telegram — `groupPolicy`** — nouveau champ (`open` | `allowlist` | `disabled`) dans le schema runtime et dans l'UI
- **DB — migration v12** — colonne `meta TEXT` dans `rt_pairing_codes` pour stocker le username Telegram du demandeur

---

## [0.28.0-beta] — 2026-03-15

### Added

- **Channels — Section Telegram dans les Settings** — nouvelle section "Channels" dans la sidebar des Settings Instance ; panneau Telegram complet : toggle enable/disable, saisie sécurisée du bot token (écrit dans `<stateDir>/.env`, jamais dans `runtime.json`), env var name, polling interval, DM policy, allowed user IDs ; bannière de restart après modification ; cards "Coming soon" pour WhatsApp et Slack
- **Channels — Health Telegram réel** — `TelegramChannel.getStatus()` expose l'état réel du poller (`connected` / `disconnected` / `not_configured`) ; `ClawRuntime.getChannelStatuses()` agrège les statuts de tous les channels ; `HealthChecker` lit le statut live si un runtime est actif, sinon déduit depuis `runtime.json`
- **Channels — botTokenMasked** — `GET /api/instances/:slug/config` retourne désormais `botTokenMasked: "•••...XXXX"` (4 derniers chars) si un token est présent dans `.env`, `null` sinon
- **Channels — Route PATCH telegram/token** — `PATCH /api/instances/:slug/config/telegram/token` écrit ou supprime le bot token dans `<stateDir>/.env` sans exposer la valeur en clair
- **Channels — PATCH config channels.telegram** — `PATCH /api/instances/:slug/config` accepte désormais `channels.telegram` (enabled, botTokenEnvVar, pollingIntervalMs, allowedUserIds) ; retourne `requiresRestart: true` si la config Telegram change
- **Sessions — Badge channel** — la liste des sessions dans `cp-runtime-chat` affiche un badge coloré par channel : `TG` (bleu Telegram), `WEB` (accent), `API` / `CLI` (gris), `INT` (discret)
- **i18n** — 22 nouvelles clés `channels-*` et `status-telegram-*` traduites en 6 langues (en, fr, de, es, it, pt)

---

## [0.27.1-beta] — 2026-03-15

### Fixed

- **Runtime chat — UNIQUE constraint on session_key** — `createSession()` générait une clé déterministe `"<slug>:<agent>:api:unknown"` pour toutes les sessions sans `peerId`, provoquant un `UNIQUE constraint failed` dès la 2ème session créée depuis le dashboard (erreur 500 sur `POST /runtime/chat`). La clé utilise désormais le `id` nanoid de la session quand `peerId` est absent, garantissant l'unicité de chaque session racine.

---

## [0.27.0-beta.0] — 2026-03-15

### Added

- **Dashboard UX v2 — Permissions interactives** — overlay `cp-permission-request-overlay` monté au niveau racine ; écoute le stream SSE pour les événements `permission.asked` ; file FIFO avec countdown 60s ; boutons Refuser / Refuser+feedback / Autoriser ; toggle persist "cette fois / toujours"
- **Dashboard UX v2 — Panneau MCP** — nouvelle section "MCP" dans Settings Instance ; affiche les serveurs connectés/déconnectés avec type, nombre d'outils et expand inline de la liste ; polling 30s
- **Dashboard UX v2 — Sessions avec métriques** — sélecteur de sessions enrichi dans Runtime Chat avec coût USD, nombre de messages, tokens ; barre de stats inline au-dessus du chat
- **Dashboard UX v2 — Panneau Permissions** — nouvelle section "Permissions" dans Settings Instance ; liste les règles persistées avec révocation ; demandes en attente ; badge rouge si permissions en attente
- **Dashboard UX v2 — Onglet Heartbeat** — onglet "Heartbeat" dans l'Agent Detail Panel ; formulaire complet (intervalle, heures actives, fuseau, modèle, prompt) ; historique des ticks avec statut ok/alert
- **Dashboard UX v2 — Onglet Config agent** — onglet "Config" dans l'Agent Detail Panel ; profil d'outils, température, max steps, extended thinking, spawn, timeouts, URLs d'instructions, globs workspace
- **Dashboard UX v2 — Panneau Config runtime** — nouvelle section "Config" dans Settings Instance ; sous-onglets Modèles (alias), Compaction (seuil, tokens réservés), Sub-agents (profondeur max, max enfants)
- **Dashboard UX v2 — Session tree** — composant `cp-session-tree` affichant la hiérarchie parent/enfant des sessions avec coût, canal, date relative
- **Dashboard UX v2 — Bus alerts** — composant `cp-bus-alerts` avec toasts pour doom-loop, heartbeat alert, provider failover, auth failed, agent timeout
- **Dashboard UX v2 — Badges card enrichis** — badge `⚠ PERM` sur les cards instances si permission en attente

### Backend

- **Routes API permissions** — `GET/DELETE /runtime/permissions`, `POST /runtime/permission/reply` (réponse interactive aux demandes `permission.asked`)
- **Route heartbeat history** — `GET /runtime/heartbeat/history?agentId=<id>` retourne les ticks heartbeat d'un agent (sessions `channel=internal` avec statut ok/alert)
- **Extension WS health_update** — payload enrichi avec `pendingPermissions`, `heartbeatAgents`, `heartbeatAlerts`, `mcpConnected`
- **Sessions enrichies** — `GET /runtime/sessions` agrège `cost_usd`, `message_count`, `total_tokens` depuis `rt_messages`

---

## [0.26.0-beta.0] — 2026-03-15

### Added

- **Pattern Sentinel** — template `HEARTBEAT.md` enrichi avec exemple complet d'agent de surveillance ; `docs/_work/ClawPilot/examples/sentinel-runtime.json` avec configuration de référence (agents main/sentinel/deploy-agent)

---

## [0.25.0] — 2026-03-15

### Added

- **Session enrichie** — `session_key` métier `<slug>:<agentId>:<channel>:<peerId>`, `spawn_depth`, `label`, `metadata` JSON ; lookup O(1) sans scan de table (migration DB v11)
- **Limites de spawn configurables** — `subagents.maxSpawnDepth` et `maxChildrenPerSession` dans `runtime.json` ; erreurs descriptives si dépassement
- **File d'attente des sessions** — `ChannelRouter` sérialise les messages concurrents par session (plus de race condition)
- **Fork de session avec historique** — `forkSession()` copie les messages jusqu'à un point précis
- **PromptMode minimal** — les sous-agents chargent un subset réduit de DISCOVERY_FILES (économie 2 000–5 000 tokens/appel)
- **extraSystemPrompt per-run** — contexte parent injecté dans le sous-agent au spawn (qui l'a spawné, profondeur, mission)
- **Max-steps reminder** — injection d'un `<system-reminder>` au dernier step pour que l'agent conclue proprement
- **Instructions depuis URLs HTTP** — `instructionUrls` dans `AgentConfigSchema` ; fetch avec timeout 5s, échecs silencieux
- **Rapport de composition du prompt** — `buildSystemPrompt()` retourne `{ prompt, report }` avec fichiers chargés/skippés, skills injectés, taille totale
- **Contexte parent A2A** — bloc `## Subagent Context` injecté dans le system prompt du sous-agent
- **Modes lifecycle A2A** — `lifecycle: "run" | "session"` dans le Task tool ; `"session"` conserve la sous-session active
- **Mode async A2A** — `mode: "async"` dans le Task tool ; spawn non-bloquant, résultat injecté via `SubagentCompleted` bus event
- **Double gate de permission A2A** — filtre des agents visibles + vérification à l'exécution
- **Abort cascade A2A** — annulation du parent propage l'abort au sous-agent
- **Héritage du modèle parent** — fallback sur le modèle du parent si le sous-agent n'en a pas
- **Retour enrichi Task tool** — `steps_used`, `tokens_used`, `model` dans la réponse
- **toolProfile réellement appliqué** — `TOOL_PROFILES` (minimal/messaging/coding/full) filtre les outils built-in
- **Outils ownerOnly** — `BashTool` et `WriteTool` marqués `ownerOnly: true` ; non disponibles pour les sous-agents internes
- **Normalisation schémas Gemini** — suppression `anyOf`/`oneOf` pour les providers Google
- **Doom-loop detection** — 3 appels identiques consécutifs → `DoomLoopDetected` bus event + erreur descriptive
- **MultiEditTool** — éditions multiples sur un même fichier en un seul appel LLM
- **Réparation tool calls invalides** — outil `invalid` (hidden) redirige les appels vers des outils inexistants
- **HeartbeatRunner actif** — scheduler `setInterval` par agent ; `heartbeat.every`, `activeHours`, `model`, `ackMaxChars` dans `AgentConfigSchema`
- **Pattern Sentinel** — agent de surveillance dédié (toolProfile messaging, heartbeat 1h)
- **SSE keepalive** — `server.heartbeat` toutes les 10s sur le flux SSE `/runtime/stream`
- **Watchdog agent timeout** — `timeoutMs` par agent ; abort + `AgentTimeout` bus event si dépassé
- **Compaction auto-déclenchée** — `shouldCompact()` + `compact()` appelés depuis `runPromptLoop()` après chaque step
- **Mémoire thématique** — `memory/*.md` chargés en plus de `MEMORY.md` (ordre alphabétique)
- **Pruning des tool outputs anciens** — outputs > seuil remplacés par `[output pruned]` dans le contexte LLM
- **Héritage workspace A2A** — `inheritWorkspace` dans `AgentConfigSchema` ; sous-agent hérite du `workDir` parent par défaut
- **bootstrapFiles** — fichiers additionnels injectés dans le system prompt (glob patterns relatifs au workspace)
- **BOOTSTRAP.md one-shot** — fichier chargé une seule fois à la première session, puis archivé
- **Skills injection proactive** — `SkillTool` détecte les skills éligibles et les injecte automatiquement dans le prompt
- **Skills distants** — `skillUrls` dans `AgentConfigSchema` ; index JSON téléchargé et mis en cache
- **MCP reconnexion automatique** — backoff exponentiel (1s → 30s max) sur déconnexion
- **MCP kill tree** — `SIGTERM` sur le process group complet à la fermeture
- **MCP ToolListChanged** — rechargement dynamique des outils sans redémarrage
- **Modèles nommés (aliases)** — `models[]` dans `RuntimeConfigSchema` ; agents référencent par alias (`"fast"`, `"smart"`)
- **defaultInternalModel** — modèle léger pour compaction/title/summary
- **Extended thinking** — `thinking.enabled` + `budgetTokens` par agent (Anthropic uniquement)
- **Prompt caching Anthropic** — marquage `cacheControl: ephemeral` sur system prompt + 2 derniers messages
- **Normalisation tokens** — calcul de coût cohérent entre Anthropic (exclut cache) et OpenAI (inclut tout)
- **SSE chunk timeout** — `chunkTimeoutMs` par agent ; abort + `LLMChunkTimeout` si aucun chunk reçu
- **Persistence des approbations en DB** — `rt_permissions` enfin utilisée ; `recordApproval("always")` survit aux redémarrages
- **Politique agentToAgent** — `agentToAgent.enabled` + `allowList` dans `AgentConfigSchema` ; contrôle déclaratif des spawns
- **external_directory** — `BashTool` bloque les sous-agents accédant à des chemins hors `workDir`
- **Feedback textuel sur refus** — `PermissionReplied.feedback` injecté comme message user pour que l'agent corrige son approche
- **5 hooks plugin manquants** — `agent.beforeStart`, `agent.end`, `tool.beforeCall`, `tool.afterCall`, `message.sending` désormais wirés
- **Plugin tools** — `PluginHooks.tools()` permet aux plugins d'enregistrer des outils
- **Plugin routes HTTP** — `PluginHooks.routes(app)` permet aux plugins d'ajouter des routes Hono
- **Hook tool.definition** — enrichissement dynamique des descriptions d'outils par les plugins

### Changed

- **claw-runtime only** — suppression complète du support OpenClaw tiers (v0.20.0)
- **Task tool** — retour enrichi avec `steps_used`, `tokens_used`, `model`
- **PermissionReplied** — champ `feedback?: string` ajouté (rétrocompatible)
- **HEARTBEAT.md template** — mis à jour pour le HeartbeatRunner actif

### Fixed

- **Compaction** — `shouldCompact()` et `compact()` n'étaient jamais appelés en V1
- **toolProfile** — défini dans le schema mais non appliqué en V1
- **5 hooks plugin** — wirés sur le bus mais jamais déclenchés en V1
- **MCP** — connexions non fermées proprement à l'arrêt du daemon

---

## [0.19.0] — 2026-03-12

### Added
- **Skills par agent** — filtrage allowlist des skills OpenClaw par agent, visible et éditable dans le dashboard
  - Section Skills en lecture dans le panel Info (badges All / None / liste)
  - Section Skills en édition : toggle All / None / Custom + grille de checkboxes si l'instance est running (via gateway RPC `skills.status`), fallback saisie CSV si offline
  - Endpoint `GET /api/instances/:slug/skills` — interroge le gateway OpenClaw en JSON-RPC avec timeout 5s et fallback gracieux
  - `PATCH /api/instances/:slug/agents/:agentId/meta` accepte désormais `skills`
  - `PATCH /api/blueprints/:id/agents/:agentId/meta` — nouvelle route (skills + role/tags/notes)
  - Migration DB v7 : colonne `agents.skills TEXT` (nullable, même convention que `tags`)
  - Skills persistées en DB pour les blueprints (import/export `.team.yaml` inclus)
  - i18n : 7 nouvelles clés × 6 langues (EN/FR/DE/ES/IT/PT)

---

## [0.18.1] — 2026-03-12

### Fixed
- Fix spellcheck CI failure: rename test fixture hash `oldhash` → `abc123def456` in `routes.test.ts`

---

## [0.18.0] — 2026-03-12

### Added
- `exactOptionalPropertyTypes: true` activé dans `tsconfig.json` et `ui/tsconfig.json` — typage strict des propriétés optionnelles (34 erreurs corrigées dans 16 fichiers)
- `src/core/registry-types.ts` — types purs extraits de `registry.ts` (élimine 4 cycles circulaires)
- `src/core/agent-workspace.ts` — `resolveAgentWorkspacePath` extrait de `discovery.ts` (élimine le 5e cycle)
- Snapshot tests pour `systemd-generator.ts`, `launchd-generator.ts`, `config-generator.ts`
- Nouveaux tests unitaires : `poll.test.ts`, `validate.test.ts`, `launchd-generator.test.ts`
- `.github/workflows/deps-check.yml` — cron hebdomadaire `pnpm outdated` (warn-only)
- Middleware `onError` centralisé dans `server.ts` — `ClawPilotError` → réponse HTTP structurée

### Changed
- **0 cycles circulaires** (était 5) — `check:circular` désormais bloquant en CI
- **500 tests** (était 414) — 86 nouveaux tests, 33 fichiers, 0 échec
- Coverage lignes **60.36%** (était 52.48%) — seuils CI relevés : `lines/statements 60`, `functions 80`
- Coverage fonctions **86.14%** (était 79.77%)
- Version lue depuis `package.json` dans `server.ts` (était hardcodée `"0.16.3"`)
- 4 repositories (`agent-repository`, `blueprint-repository`, `instance-repository`, `server-repository`) importent depuis `registry-types.ts` au lieu de `registry.ts`

### Fixed
- Pattern `prop: value ?? undefined` remplacé par spread conditionnel `...(value != null && { prop: value })` dans tout le codebase pour conformité `exactOptionalPropertyTypes`

---

## [0.17.0] — 2026-03-11

### Added
- **Prettier** — formatage automatique du code (CLI + UI) ; scripts `format` / `format:check` ; step CI bloquant
- **lefthook** — pre-commit hooks locaux : format-check + lint + typecheck avant chaque commit, tests avant chaque push
- **commitlint** — validation des messages de commit (Conventional Commits) via hook `commit-msg`
- **knip** — détection du dead code (exports inutilisés, dépendances fantômes) ; step CI bloquant ; `OpenClawNotFoundError` supprimé (jamais utilisé)
- **madge** — détection des imports circulaires (`check:circular`) ; 5 cycles pré-existants identifiés dans `core/registry.ts` et `core/agent-sync.ts`
- **cspell** — vérification orthographique sur 170 fichiers TypeScript (dictionnaires EN + FR) ; step CI bloquant
- **`pnpm audit`** — vérification des vulnérabilités connues (`--audit-level=high`) dans le pipeline CI
- **Typecheck + lint du code UI** — `typecheck:ui` et `lint:ui` couvrent désormais les 40 fichiers Lit dans `ui/src/` ; intégrés dans `typecheck:all` / `lint:all` et dans le CI
- **`@vitest/coverage-v8`** — provider de coverage explicitement déclaré en devDependency
- **`/api/health` enrichi** — retourne `version`, `uptime`, `instances.total/running`, `db.sizeBytes`
- **`/health` public enrichi** — retourne `version` et `uptime`
- **Request ID middleware** — `X-Request-Id` injecté sur toutes les requêtes Hono (`src/dashboard/request-id.ts`)
- **Schéma Zod `openclaw.json`** — `OpenClawConfigSchema` dans `src/core/openclaw-config.schema.ts` ; toute la couche de lecture/écriture de config est désormais typée
- **`instanceGuard()`** — guard centralisé dans `src/lib/guards.ts` pour la résolution d'instance dans les routes
- **`src/lib/providers.ts`** — URLs de base des providers centralisées
- **Tests lifecycle + health** — `src/core/__tests__/lifecycle.test.ts` et `health.test.ts` (modules les plus critiques, précédemment sans tests)
- **Tests config reader/writer** — `src/core/__tests__/config-reader.test.ts` et `config-writer.test.ts`
- **i18n `instance-devices`** — 11 chaînes extraites vers `msg()` dans `ui/src/components/instance-devices.ts`

### Changed
- **CI pipeline** — renommé "Quality · Test · Build" ; ordre : security audit → format check → typecheck (CLI+UI) → lint (CLI+UI) → spell check → tests + coverage → dead code (knip) → circular deps → build
- **Seuils de coverage** — ajustés aux chiffres réels : `lines: 50`, `statements: 50`, `functions: 75`, `branches: 70`
- **oxlint** — 8 règles supplémentaires activées : `no-var`, `eqeqeq`, `no-implicit-coercion`, `no-return-assign`, `no-throw-literal` + env `node/es2022`
- **`noFallthroughCasesInSwitch: true`** — ajouté dans `tsconfig.json`
- **Versions épinglées** — `oxlint` et `tsdown` passent de `"latest"` à `"^1.49.0"` / `"^0.20.3"`
- **`static override styles`** — 21 composants Lit corrigés pour satisfaire `noImplicitOverride`
- **`agent-detail-panel.ts`** — CSS extrait dans `ui/src/styles/agent-detail-panel.styles.ts` (1537 → 830 lignes, −46%)
- **`instance-settings.ts`** — CSS extrait dans `ui/src/styles/instance-settings.styles.ts` (1942 → 1357 lignes, −30%)
- **`registerAgentRoutes`** — découpé en 6 sous-fichiers dans `src/dashboard/routes/instances/agents/`
- **`applyConfigPatch`** — refactorisée en 7 fonctions de section dans `src/core/config-writer.ts`
- **Graceful shutdown** — `SIGTERM`/`SIGINT` gérés proprement dans le dashboard Hono
- **`CliError`** — remplace les `process.exit(1)` dans les callbacks `withContext()` (28 occurrences corrigées)
- **Catch vides** — 74 blocs `catch {}` vides remplacés par des logs ou re-throws appropriés

### Fixed
- **`hono` mis à jour en 4.12.7** — corrige 2 CVEs high (GHSA-xh87-mx6m-69f3, GHSA-q5qw-h33p-qvwr)
- **`@hono/node-server` mis à jour en 1.19.11** — corrige 1 CVE high (GHSA-wc8c-qw6v-h7f6)
- **`localization.ts`** — erreur TS2322 corrigée (`Promise<unknown>` → `Promise<LocaleModule>`)
- **Imports inutilisés UI** — `importInstanceTeam`, `importBlueprintTeam`, `TeamImportResult`, `BuilderData` supprimés
- **`ui/src/api.ts`** — spread inutile `?? {}` supprimé

---

## [0.16.3] — 2026-03-11

### Added
- **Docs intégrées au repo** : `main-doc.md` (architecture fonctionnelle), `ux-design.md`, `design-rules.md`, `i18n.md` déplacés dans `docs/` — plus de dépendance au monorepo parent

### Changed
- **CLAUDE.md enrichi** : section UI development avec arbre `ui/src/`, table de référence docs internes, version trackée, suppression des références externes au monorepo

### Fixed
- **`LocalConnection.writeFile()` — fallback sudo sur EACCES/EPERM** : sur Linux, si `fs.writeFile` échoue avec `EACCES` ou `EPERM`, retente automatiquement via `sudo tee` avec contenu base64-encodé — même pattern que `readFile()` (v0.16.0)

---

## [0.16.3] — 2026-03-11

### Fixed
- **`LocalConnection.writeFile()` — fallback `sudo tee` sur EACCES** : sur Linux, si `fs.writeFile` échoue avec `EACCES`/`EPERM` (fichier owned par un autre user, ex. `openclaw.json` owned by `openclaw`), retente automatiquement via `printf | base64 -d | sudo tee`. Corrige le bug où le bouton "Save" dans le builder d'agents ne persistait pas les liens de délégation sur les instances dont les configs sont owned by un user différent.
- **UI — erreur visible dans la save bar** : quand la sauvegarde des liens d'agents échoue (erreur réseau, permission, etc.), le message d'erreur est maintenant affiché directement dans la barre de sauvegarde (à la place du compteur "N change(s) pending") au lieu d'être silencieusement ignoré. L'erreur est effacée dès que l'utilisateur modifie sa sélection ou annule.

---

## [0.16.2] — 2026-03-11

### Fixed
- **Self-updater — fallback sudo sur EACCES** : le self-updater (`claw-pilot update`) détecte maintenant si `dist/` ou `node_modules/` ne sont pas accessibles en écriture par le process courant (cas typique : déploiement initial fait avec `sudo pnpm build`). Si c'est le cas, il retente automatiquement avec `sudo -E env PATH=$PATH pnpm build` / `pnpm install` au lieu d'échouer avec `EACCES: permission denied, rmdir dist/ui/assets`.

---

## [0.16.1] — 2026-03-11

### Changed
- **UI — liens inter-agents : suppression du concept A2A, renommage spawn → delegate** : les liens `a2a` (`sessions_send`) n'ont pas de sens dans une architecture BMAD où seul `main` initie les conversations. L'UI reflète désormais le modèle réel :
  - Badge `A2A` et bordure bleue sur les cards supprimés
  - Badge `SA` renommé `Sub` avec tooltip "Specialized agent, delegated tasks by the orchestrator."
  - Section "A2A links (bidirectional)" supprimée du panel Info agent
  - Label "Can spawn" → **"Delegates to"**, "Spawned by" → **"Delegated by"**
  - Bouton "Add agent" → **"Add delegate"**
  - Markers SVG renommés `arrow-delegate-*` + aria-labels ajoutés
  - Toutes les traductions mises à jour (EN, FR, DE, ES, IT, PT)

---

## [0.16.0] — 2026-03-11

### Changed
- **Découverte d'instances — nouvelle stratégie `find`-based (Linux)** : remplace le scan de répertoire + `systemctl --user` (qui ne fonctionnaient pas cross-user) par :
  1. `sudo find /opt /home /root /var -maxdepth 8 -name "openclaw.json"` — trouve tous les configs quelle que soit la propriété des fichiers
  2. Filtre les chemins valides (`/.openclaw(-slug)?/openclaw.json`) — exclut backups et repos git
  3. Enrichit chaque instance avec l'état systemd live via `sudo -u openclaw systemctl --user is-active` — les instances sans service actif/inactif/failed sont exclues (dead/backup)
- **`LocalConnection.readFile()` — fallback `sudo cat`** : sur Linux, si `fs.readFile` échoue avec `EACCES`/`EPERM`, retente automatiquement avec `sudo cat <path>` — transparent pour tous les appelants

### Fixed
- **Instances `chronos` et `demo1` non découvertes sur WCASLDSPV54L** : `claw-pilot` tournant sous `stephane` ne pouvait ni lire les fichiers de `/opt/openclaw/.openclaw-*/` (chmod 700, owner `openclaw`) ni interroger le bus systemd du user `openclaw`

---

## [0.15.9] — 2026-03-11

### Fixed
- **OpenClaw non détecté / mauvaise instance détectée** : `OpenClawCLI.detect()` cherchait `$HOME/.npm-global/bin/openclaw` en premier — sur un serveur avec un user dédié `openclaw`, il trouvait la copie parasite du user courant. Réécriture complète avec 3 passes :
  1. **Process actif** : lit `HOME` depuis `/proc/<pid>/environ` des process `openclaw-gateway`
  2. **Fichiers `.service` systemd** : parse `ExecStart` dans `openclaw-*.service`
  3. **Chemins hardcodés** : `/opt/openclaw/.npm-global/bin/openclaw` en priorité sur Linux
- **`detect()` retourne maintenant `{ bin, version, home }`** : `home` = répertoire home du user openclaw (ex: `/opt/openclaw`), utilisé pour localiser les stateDirs des instances
- **`claw-pilot init` et `discover`** : utilisent `openclaw.home` pour `upsertLocalServer` et `InstanceDiscovery` — les instances existantes sous `/opt/openclaw/.openclaw-*/` sont maintenant correctement découvertes
- **`getOpenClawHome()`** : lit `openclaw_home` depuis la DB en priorité (setté à l'init), fallback sur `OPENCLAW_HOME` env ou `os.homedir()`

---

## [0.15.8] — 2026-03-11

### Fixed
- **`install.sh` — OpenClaw non détecté si installé sous un autre user** : `_find_openclaw` utilisait un pipe `while IFS= read` qui tourne dans un subshell — `OPENCLAW_BIN` assigné dans le subshell ne remontait pas au shell parent. Réécriture complète en 3 passes sans subshell :
  1. **Process actif** : lit `HOME` depuis `/proc/<pid>/environ` des process `openclaw-gateway` → déduit `$HOME/.npm-global/bin/openclaw`
  2. **Fichiers `.service` systemd** : `find /home /opt /root -name "openclaw-*.service"` + parse `ExecStart` (sed ancré sur espace pour éviter la capture partielle du path)
  3. **Chemins hardcodés** : boucle `for` POSIX sans pipe, inclut nvm/volta

---

## [0.15.7] — 2026-03-11

### Fixed
- **`install.sh` — `set -e` tue le script silencieusement dans `_reload_pnpm_path`** : la dernière instruction de la fonction était `[ -n "$_pnpm_global_bin" ] && prepend_path_dir ...` — quand `_pnpm_global_bin` est vide (cas normal avec le shim corepack), `[ -n "" ]` retourne exit 1, la fonction retourne exit 1, et `set -e` tue le script sans message d'erreur. Fix : `|| true` sur cette ligne + `return 0` explicite en fin de fonction.

---

## [0.15.6] — 2026-03-11

### Fixed
- **`install.sh` — PATH corrompu par `npm bin -g`** : sur npm v10+, `npm bin -g` est supprimé et affiche un message d'erreur multi-ligne sur **stdout** (pas stderr) avec exit 0. Ce texte était capturé dans `_npm_global_bin` et passé à `prepend_path_dir()`, corrompant `PATH` avec du texte arbitraire. Fix : suppression complète de `npm bin -g` — utilisation exclusive de `npm prefix -g` (stable, toutes versions npm).
- **`install.sh` — `pnpm bin --global` sans `COREPACK_ENABLE_STRICT=0`** : appel manquant à la ligne du wrapper fallback (ligne ~559).

---

## [0.15.5] — 2026-03-11

### Fixed
- **`install.sh` — hang infini sur corepack shim en session non-interactive** : quand `corepack enable --install-directory ~/.local/bin` crée un shim pnpm, ce shim intercepte tous les appels `pnpm` suivants et tente de télécharger la version demandée depuis npmjs.org en attendant une confirmation interactive → blocage infini dans `curl | sh`. Fix : export `COREPACK_ENABLE_STRICT=0` en début de script (corepack passe en mode transparent, sans prompt) + `COREPACK_ENABLE_STRICT=0` explicite sur tous les appels `pnpm bin --global`, `pnpm setup`, `pnpm --version`.

---

## [0.15.4] — 2026-03-11

### Fixed
- **`install.sh` — `unterminated 's' command` (sed crash)** : `npm prefix -g` retourne un chemin avec un newline final ; `sed 's|$|/bin|'` ajoutait `/bin` après ce newline, produisant un path multi-ligne passé à `prepend_path_dir()` qui cassait le `sed` interne. Fix : `tr -d '\n'` sur la sortie de `npm prefix -g` avant d'ajouter `/bin`.
- **`install.sh` — défense en profondeur dans `prepend_path_dir()`** : strip des newlines sur l'argument d'entrée via `tr -d '\n'` pour éviter tout crash sed si un path multi-ligne est passé depuis un autre endroit.

---

## [0.15.3] — 2026-03-11

### Fixed
- **`install.sh` — corepack EACCES** : `corepack enable` utilisait le répertoire système (`/usr/bin`) → remplacé par `corepack enable --install-directory ~/.local/bin` (user-local, sans sudo)
- **`install.sh` — get.pnpm.io SHELL non défini** : le script pnpm ne supporte pas `sh` comme valeur de `$SHELL` en session non-interactive. Détection automatique de `bash` ou `zsh` disponibles ; skip propre si aucun n'est trouvé
- **`install.sh` — pnpm non détecté après npm install** : `~/.npm-global/bin` et `~/.local/bin` ajoutés à `_reload_pnpm_path()` pour que pnpm soit trouvable immédiatement après installation via npm

---

## [0.15.2] — 2026-03-11

### Fixed
- **`install.sh`** : robustesse pnpm — cascade d'installation en 3 méthodes (corepack → get.pnpm.io → npm) avec `fix_npm_permissions()` pour éviter EACCES sur les installations Node système (Linux)
- **`install.sh`** : compatibilité POSIX sh/dash — remplacement de `${//}` bash-only par `sed`, validé sur dash (Ubuntu/Debian) et `/bin/sh` macOS
- **`install.sh`** : persistance du PATH — écriture dans `~/.bashrc`/`~/.zshrc`/`~/.profile` après installation du wrapper ; `warn_path_missing()` émet un hint ciblé si le répertoire est absent du PATH original
- **`install.sh`** : correction word-splitting sur `CLAW_PILOT_BIN` (variable composée `"node /path"` utilisée comme commande)
- **`install.sh`** : itération POSIX dans `_find_openclaw` — `while IFS= read -r` remplace `for p in $var` (safe avec les chemins contenant des espaces)
- **`install.sh`** : `run_quiet_step` appelle désormais `error()` en cas d'échec (compatible `set -e`) et affiche les 40 dernières lignes du log

---

## [0.15.1] — 2026-03-10

### Fixed
- **Login page** : affichage du numéro de version (`v0.15.1`) en bas de la carte de login
- **`claw-pilot auth setup/reset`** : suppression de l'INSERT dans `events` incompatible avec les DB existantes (ancien schéma `instance_slug/event_type/detail`)

---

## [0.15.0] — 2026-03-10

### Added
- **Authentification dashboard** : écran de login obligatoire avec sessions SQLite et cookie HttpOnly `__cp_sid`. Quiconque atteint le port 19000 doit désormais s'authentifier avant d'accéder au dashboard.
- **Commande `claw-pilot auth`** : sous-commandes `setup` (crée/réinitialise le compte admin, affiche le mot de passe une seule fois), `reset` (alias de `setup`), `check` (exit 0/1 silencieux — utilisé par `install.sh`).
- **Middleware dual auth** : cookie de session en priorité, Bearer token en fallback (compatibilité accès programmatique).
- **Composant `<cp-login-view>`** : page de login Lit avec autofocus, gestion d'erreurs, bannière d'expiration de session.
- **Gate d'auth dans `app.ts`** : boot sequence async — vérifie la session via `/api/auth/me` avant d'initialiser le WebSocket et le polling. Bouton "Sign out" dans le header.
- **Intercepteur 401 global** dans `api.ts` : dispatch `cp:session-expired` → retour automatique à la page de login.
- **i18n** : 9 nouvelles clés auth (`login-*`, `app-btn-logout`) dans les 6 langues (EN, FR, DE, ES, IT, PT).
- **`install.sh`** : étape `auth setup` automatique à l'installation ; détection de migration (pas d'admin existant) lors des mises à jour.

### Changed
- `window.__CP_TOKEN__` n'est plus injecté dans le HTML servi — le token est désormais retourné par `/api/auth/me` après authentification.
- Schéma DB migré en version 6 : tables `users` et `sessions` ajoutées.

### Security
- Remplacement du token statique injecté dans le HTML par un système de sessions SQLite avec TTL 24h et sliding window.
- Hachage des mots de passe via `node:crypto` scrypt (N=16384, r=8, p=1, keylen=64).
- Rate limiting sur `/api/auth/login` : 5 tentatives par minute par IP.
- Cookie `__cp_sid` : HttpOnly, SameSite=Strict, Secure si HTTPS détecté via `X-Forwarded-Proto`.

---

## [0.14.6] — 2026-03-10

### Changed
- **Anthropic catalog** : ajout de `claude-opus-4-6` (DEFAULT_MODEL OpenClaw) et `claude-sonnet-4-6` — modèles non encore dans le catalog pi-ai statique mais acceptés par le runtime Anthropic via forward-compat

---

## [0.14.5] — 2026-03-10

### Changed
- **OpenClaw compat** : alignement sur `v2026.3.8` — nouveaux modèles Google (`gemini-3-pro`, `gemini-3-pro-high`, `gemini-3-pro-low`, `gemini-3-flash`, `gemini-flash-latest`, `gemini-flash-lite-latest`), nouveaux modèles OpenAI (`gpt-5.2-chat-latest`, `gpt-5-pro`, `gpt-5-nano`), nouveaux champs optionnels documentés (`talk.silenceTimeoutMs`, `browser.relayBindHost`, `agents.defaults.compaction.model`)

---

## [0.14.4] — 2026-03-10

### Fixed
- **Health check — source de vérité unique** : la dérivation du state (`running` / `stopped` / `error`) était dupliquée en 3 endroits (backend `health.ts`, WebSocket handler `app.ts`, CLI `list.ts`), chacun avec sa propre logique. Le state est désormais calculé une seule fois dans `HealthChecker.check()`, exposé dans `HealthStatus.state`, et consommé directement par tous les appelants. Corrige le faux statut `ERROR` affiché sur le dashboard web pour les instances stoppées après un crash (le WebSocket handler re-dérivait le state avec l'ancienne logique buggée).

---

## [0.14.3] — 2026-03-10

### Fixed
- **Health check** : une instance dont le service systemd est en état `failed` (crash passé, process terminé) était incorrectement affichée en statut `ERROR` sur le dashboard. Le statut `ERROR` est désormais réservé aux cas où systemd rapporte `active` mais la gateway ne répond pas (process bloqué/zombie). Un service `failed` ou `inactive` sans gateway joignable est maintenant affiché comme `STOPPED`.

---

## [0.14.2] — 2026-03-10

### Fixed
- **Instance Card** : suppression du double `⎋` dans l'item UI du menu popover (icône dans `.menu-icon` + label de la clé i18n `btn-open-ui`). Le `⎋` reste dans l'icône, le label affiche désormais "UI" seul.

---

## [0.14.1] — 2026-03-10

### Changed
- **Instance Card** : bouton Start/Stop déplacé du header vers le menu popover `···` (en première position, coloré vert pour Start / rouge pour Stop). Le header n'affiche plus que le badge d'état et le bouton menu.

---

## [0.14.0] — 2026-03-10

### Changed
- **Instance Card — refonte UX complète** : nouvelle hiérarchie visuelle (display_name en focal 16px/700, slug en secondaire monospace), status bar compacte entre header et meta (gateway health, statut Telegram live, agent count, pending devices cliquable), actions regroupées dans un menu popover `···` (UI, Agents, Settings, Restart, Delete). Le modèle passe en zone meta principale, port et version OpenClaw en ligne technique secondaire.
- **Instance Card — action Restart** : le bouton Restart est désormais accessible depuis le menu popover (appel `POST /api/instances/:slug/restart`). Était absent de la card, disponible uniquement dans la vue détail.
- **Instance Card — statut Telegram live** : la pill Telegram affiche l'état de connexion en temps réel (`connected` = bleu, `disconnected` = ambre avec ⚠). Le champ `telegram` est désormais propagé dans `InstanceInfo` et mis à jour via le WebSocket `health_update`.
- **Instance Card — gateway health distincte** : distinction visuelle entre `running + gateway healthy` (◉ vert) et `running + gateway unhealthy` (◎ rouge). Auparavant, les deux états affichaient le même badge RUNNING.
- **`InstanceInfo` type** : ajout du champ `telegram?: "connected" | "disconnected" | "not_configured"` (propagé depuis `HealthStatus`).
- **WebSocket handler (`app.ts`)** : le handler `health_update` propage désormais le champ `telegram` vers les instances en mémoire.

---

## [0.13.0] — 2026-03-10

### Fixed
- **Workspace files incomplets** : les instances creees sans blueprint manquaient `IDENTITY.md` et `HEARTBEAT.md` (5 fichiers au lieu de 7). Le provisioner utilise desormais `TEMPLATE_FILES` (7 fichiers).
- **Blueprint deployer — fallback minimalFiles** : les agents secondaires sans fichiers en DB recevaient 6 fichiers placeholder au lieu de 7. Aligne sur `TEMPLATE_FILES`.
- **Team import — fichiers manquants non combles** : l'import d'un `.team.yaml` avec des agents incomplets (ex: seulement AGENTS.md + SOUL.md + USER.md) ne completait pas les fichiers manquants. L'import detecte desormais les `EXPORTABLE_FILES` absents et les seed depuis les templates (DB + filesystem).

### Added
- **`workspace-templates.ts`** : helper partage pour charger et appliquer les templates workspace (`loadWorkspaceTemplate`, `applyTemplateVars`). Elimine la duplication de la logique de template entre provisioner, blueprint routes et team import.
- **Constantes unifiees** : `constants.ts` est desormais la source de verite unique pour les listes de fichiers workspace (`DISCOVERABLE_FILES`, `EDITABLE_FILES`, `TEMPLATE_FILES`, `EXPORTABLE_FILES`). Les 7 listes hardcodees reparties dans le code importent desormais depuis constants.
- 5 nouveaux tests team-import (gap-fill blueprint, pas d'ecrasement des fichiers YAML, zero gap-fill si complet, gap-fill instance disque + DB)

### Changed
- `importBlueprintTeam()` est desormais async (necessaire pour le chargement des templates). Les 2 appelants (`commands/team.ts`, `dashboard/routes/teams.ts`) ont ete mis a jour.

---

## [0.12.9] — 2026-03-09

### Fixed
- **Agent positions wiped by sync** : `AgentSync.sync()` appelait `upsertAgent()` sans passer `position_x`/`position_y`, ecrasant les positions copiees depuis le blueprint (ou definies par drag) avec `null`. La sync preserve desormais les positions existantes lors de la mise a jour d'un agent.
- **Defense en profondeur SQL** : le SQL de `upsertAgent()` utilise desormais `COALESCE(excluded.position_x, agents.position_x)` pour ne jamais ecraser une position non-null avec null, meme si un appelant oublie de passer les positions.

### Added
- 2 nouveaux tests agent-sync (positions preservees apres sync, COALESCE SQL)

---

## [0.12.8] — 2026-03-09

### Fixed
- **Blueprint deploy — positions des cartes Agent non copiees** : lors de l'instanciation depuis un blueprint, les coordonnees canvas (`position_x`, `position_y`) des agents n'etaient pas transferees vers l'instance. Les agents se retrouvaient avec la disposition par defaut (cercle autour du main) au lieu du layout concu dans l'editeur de blueprint. Le deployer copie desormais les positions via `upsertAgent()`.

### Added
- 2 nouveaux tests blueprint-deployer (positions copiees, positions null si absentes)

---

## [0.12.7] — 2026-03-09

### Fixed
- **Blueprint deploy — double-wrapping model** : le champ `model` des agents en DB etait deja un objet JSON serialise (`{"primary":"opencode/claude-sonnet-4-5"}`), mais le deployer le wrappait une seconde fois dans `{ primary: ... }`, produisant une string non parseable par OpenClaw. Le deployer parse desormais le model avec `JSON.parse()` (fallback sur `{ primary: string }` pour les identifiants bruts).
- **Blueprint deploy — spawn links de main ignores** : les liens `spawn` de l'agent principal (main → lead-tech, lead-product, lead-marketing) n'etaient pas ecrits dans `agents.list[]` car le code les excluait avec `if (!isDefault)`. Les spawn links sont desormais appliques a tous les agents, y compris main.

### Added
- 2 nouveaux tests blueprint-deployer (model JSON-serialized, main spawn links)

---

## [0.12.6] — 2026-03-09

### Fixed
- **Blueprint deploy — regression v0.12.5** : l'agent principal (main) n'apparaissait plus dans la liste des agents du dashboard, et l'agent par defaut dans OpenClaw etait le premier agent secondaire au lieu de main. Trois corrections :
  - `blueprint-deployer.ts` : main est remis dans `agents.list[]` avec `default: true` pour que OpenClaw le reconnaisse comme agent par defaut
  - `blueprint-deployer.ts` : le champ `model` est desormais wrappe dans `{ primary: "..." }` pour tous les agents (format requis par OpenClaw v2026.2.24+)
  - `config-reader.ts` : synthetise main depuis `agents.defaults` si absent de `agents.list[]` (retrocompatibilite avec les configs pre-v0.12.6)

### Added
- **Tests** : 2 nouveaux tests blueprint-deployer (model wrapping, secondary agents sans `default: true`)

---

## [0.12.5] — 2026-03-08

### Fixed
- **Blueprint deploy** : les données du blueprint (prompts, SOUL.md, AGENTS.md…) n'étaient pas appliquées lors de la création d'une instance. Trois bugs corrigés dans `blueprint-deployer.ts` :
  - Les workspaces des agents étaient créés au mauvais chemin (`stateDir/workspace-<id>` au lieu de `stateDir/workspaces/workspace-<id>`)
  - L'agent principal (main) du blueprint était ajouté dans `agents.list[]` au lieu d'écraser les templates génériques dans le workspace par défaut (`workspaces/workspace/`)
  - Les chemins workspace dans `openclaw.json` étaient absolus au lieu de relatifs

### Added
- **Tests** : couverture complète du `BlueprintDeployer` (12 tests)

---

## [0.12.4] — 2026-03-08

### Fixed
- **Self-update — reload automatique** : corrige la race condition où `systemctl restart` tuait le process Node avant que le poll frontend (3s) puisse lire `status: "done"`, empêchant le `location.reload()` automatique. Le reload est maintenant déclenché sur la reconnexion WebSocket : quand le WS se reconnecte alors qu'un job `running` était en cours, c'est la preuve que le serveur a redémarré → reload immédiat du bundle.

---

## [0.12.3] — 2026-03-08

### Changed
- **UI — bandeaux de mise à jour** : refactorisation vers un composant partagé `cp-update-banner-base` (factorisation du CSS et de la structure HTML dupliqués entre `cp-update-banner` et `cp-self-update-banner`)
- **UX — bandeau claw-pilot** : ajout d'un bouton × de dismiss manuel sur l'état `done` (sécurité si le `location.reload()` automatique n'arrive pas après le restart systemd)
- **Cohérence** : titre d'erreur OpenClaw aligné sur le pattern contextuel (`"OpenClaw update failed"` au lieu de `"Update failed"` générique)
- **Événements** : renommage `cp-update-start` → `cp-update-action` et `cp-self-update-start` → `cp-update-action` (nom unifié pour les deux bandeaux)

---

## [0.12.2] — 2026-03-08

### Changed
- **OpenClaw compat** : alignement sur `v2026.3.7` — Google default model renommé `gemini-3.1-pro-preview`, ajout `gemini-3.1-flash-lite-preview`, ajout `gpt-5.2-codex` et `gpt-5.2-pro` (OpenAI), nouveaux champs optionnels documentés dans `OPENCLAW-COMPAT.md`

---

## [0.12.1] — 2026-03-06

### Fixed
- **Self-update** : le navigateur se recharge automatiquement après la fin d'une mise à jour (`status === "done"`), sans intervention manuelle.

---

## [0.12.0] — 2026-03-06

### Added
- **Tests** : 296 tests couvrant provisioner, agent-sync, team-import et routes dashboard (22 fichiers de test)

### Changed
- **Architecture routes** : `src/dashboard/routes/instances.ts` (1036 lignes) découpé en 6 modules spécialisés (`lifecycle`, `config`, `agents`, `devices`, `discover`, `index`)
- **Team import** : refactoring DRY — logique dupliquée entre `team.ts` et `instances.ts` centralisée dans `core/team-import.ts`
- **Build** : `treeshake: false` dans tsdown pour éviter que rolldown élimine les property assignments sérialisés dynamiquement via `c.json()`

### Fixed
- **Device pairing banner** : `pendingDevices` n'était pas propagé via WebSocket ni retourné par `/api/instances` — corrigé à deux niveaux : parsing `pending.json` (objet keyed vs array), propagation WS dans `_handleWsMessage`
- **Navigation directe Devices** : le champ `section` était perdu dans la chaîne `instance-card → cluster-view → app → instance-settings` — corrigé end-to-end (`Route` type, `_navigate`, `_onNavigate`, `connectedCallback`)
- **Boutons Approve** : spinner + disabled pendant l'appel API pour éviter les double-clics
- **Sécurité** : suppression de tokens exposés dans les logs, validation des entrées renforcée
- **DB** : incohérences de schéma corrigées, migrations additives uniquement

---

## [0.11.2] — 2026-03-06

### Fixed
- **Self-update** : correction du PATH manquant en session non-interactive — `pnpm` et `node` (via nvm) n'étaient pas trouvés lors de l'exécution de `pnpm install` et `pnpm build` depuis le dashboard. Toutes les commandes d'update préfixent désormais le PATH avec `~/.nvm/versions/node/v24.14.0/bin`.

---

## [0.11.1] — 2026-03-06

### Fixed
- **Discover / Agent sync** : correction du chemin workspace pour les instances OpenClaw installées manuellement (layout natif). L'agent "main" d'une instance sans `agents.list` ni `agents.defaults.workspace` pointe désormais sur `<stateDir>/workspace/` (singulier, convention OpenClaw) au lieu de `<stateDir>/workspaces/main/` (layout claw-pilot). Les fichiers AGENTS.md, SOUL.md, etc. sont correctement lus et affichés dans le dashboard.

---

## [0.11.0] — 2026-03-06

### Added
- **Self-update** : claw-pilot peut désormais se mettre à jour lui-même via GitHub Releases. Le dashboard affiche une bannière dès qu'une nouvelle version est disponible, et la commande CLI `claw-pilot update [--check] [--yes]` permet de déclencher la mise à jour (git fetch + checkout tag + pnpm build + redémarrage systemd automatique).

### Fixed
- **Self-update checker** : correction du chemin `require()` vers `package.json` après bundling tsdown (`../package.json` au lieu de `../../package.json`), qui causait `currentVersion: "0.0.0"`.

---

## [0.10.2] — 2026-03-05

### Fixed
- **Adopt** : patch automatique de `gateway.mode=local` dans `openclaw.json` lors de l'adoption d'une instance installée manuellement (sans ce champ, OpenClaw refuse de démarrer). Le service systemd est redémarré automatiquement après le patch.
- **Adopt** : token gateway désormais lu depuis `openclaw.json → gateway.auth.token` en fallback si `<stateDir>/.env` est absent (instances manuelles). Le bouton "UI" de la carte instance injecte maintenant correctement `#token=` dans l'URL.
- **Lifecycle errors** : en cas d'échec de démarrage/redémarrage, le message d'erreur affiché inclut désormais la dernière ligne d'erreur de `<stateDir>/logs/gateway.err.log` (ex: "Gateway start blocked: set gateway.mode=local") au lieu du générique "Action échouée. Vérifiez les logs serveur."

---

## [0.10.1] — 2026-03-05

### Fixed
- **Discover instances** : détection des instances OpenClaw en layout single-instance (service `openclaw-gateway.service` sans `OPENCLAW_STATE_DIR`). Le port est désormais extrait depuis `OPENCLAW_GATEWAY_PORT` dans les variables d'env du unit systemd, et `~/.openclaw/` est utilisé comme stateDir de fallback.

---

## [0.10.0] — 2026-03-05

### Added
- **Discover instances** : bouton "Discover instances" dans l'état vide de la vue Instances (0 instances en DB). Lance un scan du système (directory, systemd/launchd, port scan) via le nouveau dialog `cp-discover-dialog`, affiche les instances trouvées avec leur état (running/stopped, port, Telegram bot, modèle, nombre d'agents), et les adopte en un clic dans la DB.
- **API** : 2 nouvelles routes — `POST /api/instances/discover` (scan sans écriture DB) et `POST /api/instances/discover/adopt` (adoption des slugs sélectionnés). Déclarées avant les routes paramétriques pour éviter la collision Hono `/:slug`.
- **i18n** : 9 nouvelles strings dans les 6 locales (EN, FR, DE, ES, IT, PT) pour le dialog discover.

---

## [0.9.0] — 2026-03-03

### Added
- **Agent Detail Panel — mode édition** : bouton crayon (✏ SVG) dans le header du panel pour éditer les champs principaux d'un agent — `name`, `model` (via selects Provider/Model), `role`, `tags` (CSV), `notes`. Sauvegarde double-source en parallèle : `openclaw.json` via `PATCH /config` pour name/model, SQLite via le nouvel endpoint `PATCH /agents/:id/meta` pour role/tags/notes.
- **Settings — bouton d'accès au panel agent** : colonne "Actions" dans la table agents de la page Settings avec un bouton crayon par ligne. Ouvre le panel complet en drawer latéral fixe (420px) avec backdrop semi-transparent. Après sauvegarde, la table et le panel se rechargent automatiquement.
- **API** : nouvel endpoint `PATCH /api/instances/:slug/agents/:agentId/meta` — persiste `role`, `tags`, `notes` en SQLite (validation Zod, sans redémarrage du daemon).

### Changed
- **Agent Detail Panel — boutons header** : expand et close remplacés par des SVG 18×18 (chevron et croix) — plus lisibles. Bouton crayon fichiers (AGENTS.md, SOUL.md…) aligné sur le même SVG.
- **Agent Detail Panel — expand depuis Settings** : le drawer Settings écoute l'événement `panel-expand-changed` et passe en `width: 100vw` pour un expand plein écran fonctionnel.

---

## [0.8.3] — 2026-03-03

### Added
- **Settings Telegram — formulaire d'initialisation** : quand Telegram n'est pas encore configuré, un bouton "Configure Telegram" révèle un formulaire inline (botToken, dmPolicy, groupPolicy, streamMode) avec lien direct vers BotFather. Le backend crée le bloc `channels.telegram` depuis zéro sans modification nécessaire.
- **Settings Telegram — gestion du pairing DM** : panneau "Pairing Requests" visible quand `dmPolicy === "pairing"`. Affiche les demandes en attente (username, ID, code 8 chars, âge) avec bouton [Approve] par requête. Polling automatique toutes les 10s si des demandes sont en attente. Badge rouge sur l'item Telegram de la sidebar. Compteur des senders approuvés.
- **API** : 2 nouvelles routes — `GET /api/instances/:slug/telegram/pairing` et `POST .../approve`.
- **Core** : `TelegramPairingManager` — lit `credentials/telegram-pairing.json` + `telegram-allowFrom.json`, wrappe `openclaw pairing approve telegram <CODE>`.

### Fixed
- **Settings Telegram — valeurs dmPolicy/groupPolicy** : `"closed"` remplacé par `"disabled"` (valeur correcte du schéma OpenClaw). dmPolicy expose désormais `pairing / open / allowlist / disabled`, groupPolicy expose `allowlist / open / disabled`.
- **Settings Telegram — boutons** : classes `btn-secondary`/`btn-primary` corrigées en `btn btn-ghost`/`btn btn-primary` conformément au design system.

---

## [0.8.2] — 2026-03-03

### Changed
- **Settings — navigation par panneau** : chaque section (General, Agents, Telegram, Plugins, Gateway, Devices) est désormais un panneau exclusif — clic sidebar remplace le contenu au lieu de scroller. Cohérence UX avec le comportement déjà en place pour la section Devices.
- **Settings — Save/Cancel** : masqués quand la section Devices est active (pas de champs éditables dans ce panneau).
- **Settings — sidebar** : item "Devices" intégré dans la liste standard (plus de bouton séparé).

---

## [0.8.1] — 2026-03-03

### Added
- **API REST devices** : 3 nouvelles routes sur le dashboard :
  - `GET /api/instances/:slug/devices` — retourne `{ pending, paired }`
  - `POST /api/instances/:slug/devices/approve` — approuve une demande (`{ requestId }`)
  - `DELETE /api/instances/:slug/devices/:deviceId` — révoque un device
- **Composant `cp-instance-devices`** (`ui/src/components/instance-devices.ts`) :
  - Section Pending avec fond ambre, bouton [Approve] par device, [Approve all] si plusieurs
  - Section Paired avec badge `cli` (non révocable), confirmation inline avant révocation
  - Polling automatique toutes les 5s si des demandes sont en attente
  - Event `pending-count-changed` pour synchroniser le badge de l'onglet parent
- **Onglet Devices dans Settings** (`cp-instance-settings`) :
  - Nouvel onglet "Devices" dans la sidebar, visible pour toutes les instances
  - Badge rouge sur l'onglet si des demandes sont en attente
  - Toast ambre si `pairingWarning` est retourné après un changement de port
- **Bannière pending devices sur les cards** (`cp-instance-card`) :
  - Bannière ambre sous la card si `pendingDevices > 0` avec bouton "Go to Devices"
- **`pendingDevices` dans le health check** (`src/core/health.ts`) :
  - Lecture best-effort de `<stateDir>/devices/pending.json` à chaque health check
  - Propagé dans les `health_update` WebSocket → cards mises à jour en temps réel

---

## [0.8.0] — 2026-03-03

### Added
- **`claw-pilot devices` CLI** — nouvelle commande avec 3 sous-commandes pour gérer le pairing OpenClaw sans SSH manuel :
  - `claw-pilot devices list <slug>` — affiche les demandes en attente (en jaune) et les devices pairés avec timestamps relatifs
  - `claw-pilot devices approve <slug> [requestId]` — approuve une ou toutes les demandes en attente
  - `claw-pilot devices revoke <slug> <deviceId>` — révoque un device pairé (avec vérification préalable dans la liste)
- `src/core/devices.ts` — types `PendingDevice`, `PairedDevice`, `DeviceList`
- `src/core/device-manager.ts` — `DeviceManager` : lit `<stateDir>/devices/pending.json` + `paired.json` via `ServerConnection`, wraps `openclaw devices approve/revoke`
- `src/core/__tests__/device-manager.test.ts` — 8 tests (list vide, pending, paired, approve, revoke, erreurs)

---

## [0.7.6] — 2026-03-03

### Added
- **Blueprints badge in nav**: the Blueprints tab in the top navigation bar now shows a numeric badge with the blueprint count (same style as the Instances badge). The badge updates dynamically on create/delete and is hidden when no blueprints exist or the view hasn't been visited yet.
- **Pairing warning on port change**: changing `gateway.port` via `PATCH /api/instances/:slug/config` now returns `pairingWarning: true` in the response. The browser's localStorage is origin-scoped (`localhost:PORT`), so a port change invalidates the existing device pairing — the user must re-approve from the Devices tab (Phase 3) or via `claw-pilot devices approve <slug>` (Phase 2).
- `gateway.port` is now an accepted field in `ConfigPatch` / `ConfigPatchSchema` (previously only `reloadMode` and `reloadDebounceMs` were exposed). Changing the port also syncs the new value to the registry DB.
- `port` field added to `InstanceRepository.updateInstance()` for DB consistency on port changes.

---

## [0.7.5] — 2026-03-03

### Changed
- OpenClaw compatibility bumped to **2026.3.2**: updated `lastTouchedVersion` in generated configs, provider catalog version reference, and `OPENCLAW-COMPAT.md` with new optional keys (`cli.banner.taglineMode`, `browser.cdpPortRangeStart`, `sessions.retry`, `sessions.webhookToken` SecretRef support, `acp`, `tools.media.audio.*`, `tools.sessions_spawn.attachments`) and breaking changes (`tools.profile` default → `"messaging"`, `acp.dispatch.enabled` → `true` by default)

---

## [0.7.4] — 2026-03-03

### Fixed
- Control UI now works through SSH tunnels: generated configs include `gateway.controlUi.allowedOrigins: ["*"]` so the browser's `Origin: http://localhost:<local-port>` header is accepted by the gateway. Existing instances on VM01 patched in-place.

---

## [0.7.3] — 2026-03-03

### Changed
- Instance card: OpenClaw version moved from footer to meta section — displayed inline with the port on the same row (`PORT :18789   openclaw v2026.3.1`), footer now shows agent count only

---

## [0.7.2] — 2026-03-02

### Changed
- `registry.ts` (729 lines) split into 7 focused sub-repositories under `src/core/repositories/`: `AgentRepository`, `BlueprintRepository`, `ConfigRepository`, `EventRepository`, `InstanceRepository`, `PortRepository`, `ServerRepository`. `Registry` is now a thin facade — all callers unchanged.

### Fixed
- **Critical migration bug**: `PRAGMA foreign_keys = OFF` was silently ignored inside `better-sqlite3` transactions (SQLite restriction). Migration v4 (`DROP TABLE instances`) was therefore running with FK enforcement ON, triggering `ON DELETE CASCADE` and wiping all agents rows on first open of a v1–v3 database. Fixed by setting the pragma before the transaction starts (`disableFk` flag on `Migration` interface).

---

## [0.7.1] — 2026-03-02

### Added
- Hash-based URL routing: browser back/forward, refresh persistence (`#/`, `#/instances/:slug/builder`, `#/instances/:slug/settings`, `#/blueprints`, `#/blueprints/:id/builder`)
- Public `GET /health` endpoint (no auth) for systemd/monitoring/load balancers
- Dialog accessibility: focus trap, Escape key, `aria-modal="true"` on all 5 dialogs via `DialogMixin`
- Gateway token cache (`TokenCache`) eliminates N disk reads per API call

### Changed
- `server.ts` split from 1522 lines into 5 route modules (`instances`, `blueprints`, `teams`, `system`) + `route-deps.ts`
- `config-updater.ts` split from 848 lines into `config-types.ts`, `config-helpers.ts`, `config-reader.ts`, `config-writer.ts` (barrel re-export preserves all imports)
- `console.log/error` in dashboard routes migrated to structured `logger`

### Fixed
- Shell injection risk in `config-updater.ts`: `conn.exec("mv ...")` → `conn.execFile("mv", [...])`
- Timing-safe token comparison (`crypto.timingSafeEqual`) for HTTP and WebSocket auth
- HTTP security headers: CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy
- `ConfigPatch` API body validated at runtime with Zod `.strict()` schema
- OpenClaw install URL validated before shell interpolation
- Rate limiting on API routes (60 req/min) and expensive operations
- Blueprint file upload size capped at 1 MB
- WCAG AA color contrast fix: `--text-muted` raised from #4a5568 (~2.8:1) to #64748b (~4.6:1)
- Token URL leak: `#token=` hash cleaned from address bar after login

### Tests
- 55 new tests: 38 API route integration tests + 17 `classifyChanges` unit tests (total: 184 tests)

---

## [0.7.0] — 2026-03-02

### Added
- OpenClaw update management from the dashboard: global banner in cluster view shows when a new version is available (e.g. "OpenClaw v2026.3.1 available")
- "Update all instances" button triggers `npm install -g openclaw@latest` on the server then restarts all running instances automatically
- Async polling: update job runs in background, UI polls every 2s and shows spinner during install, success/error state on completion
- OpenClaw version displayed in each instance card footer (e.g. `openclaw v2026.3.1`)
- New API routes: `GET /api/openclaw/update-status` and `POST /api/openclaw/update`

---

## [0.6.7] — 2026-03-02

### Added
- Instance Settings view: manage multiple AI providers per instance (add, remove, update API keys) directly from the dashboard
- Heartbeat model selector: `<select>` with `<optgroup>` per configured provider, dynamically updated as providers are added/removed
- i18n: `btn-settings` translated in all 6 locales (en/fr/de/es/it/pt)

### Changed
- `maskSecret()`: new format `8chars***4chars` (e.g. `sk-ant-a***SQAA`) for better readability
- Instance card footer: added `gap` to prevent crowding between agent count and action buttons across all locales

### Fixed
- `OPENCODE_API_KEY` env var was incorrectly set to `""` in config-generator — now correctly resolved; provisioner handles optional-key providers gracefully

---

## [0.6.6] — 2026-03-01

### Added
- `uninstall.sh` — script de désinstallation complet : arrête tous les services (systemd/launchd), supprime les fichiers de service, les données des instances (`~/.openclaw-*/`), les données claw-pilot (`~/.claw-pilot/`), le symlink binaire et le répertoire d'installation
- Modes `--dry-run` (affiche ce qui serait supprimé), `--yes` (non-interactif), `--keep-data` (garde les données instances et claw-pilot)
- Détection automatique du répertoire d'installation via le symlink `claw-pilot` (fallback `CLAW_PILOT_INSTALL_DIR` ou `/opt/claw-pilot`)
- Fallback sudo pour les suppressions nécessitant des droits élevés (symlink dans `/usr/local/bin`, repo dans `/opt/`)

---

## [0.6.5] — 2026-02-28

### Fixed
- Provisioner now rolls back all created artefacts on failure — if `claw-pilot create` fails mid-provisioning (after directories or service files were created), it automatically removes the state dir, service file, and registry entries instead of leaving orphaned state

---

## [0.6.4] — 2026-02-28

### Fixed
- `claw-pilot init` now shows a clear actionable message when OpenClaw installation fails — includes the manual install command and instructs the user to re-run `claw-pilot init` afterward

---

## [0.6.3] — 2026-02-28

### Fixed
- `install.sh` now sources `~/.zshrc` after `pnpm setup` (in addition to `.bashrc`/`.profile`) — fixes silent PATH failure on macOS where zsh is the default shell since Catalina
- `install.sh` OpenClaw detection now includes `/opt/homebrew/bin/openclaw` and `/usr/local/bin/openclaw` — aligns with the paths checked by `openclaw-cli.ts` on macOS
- `install.sh` now checks for required build tools (`cc`, `make`, `python3`) before `pnpm install` and prints a clear hint if any are missing (needed to compile `better-sqlite3` native bindings)

---

## [0.6.2] — 2026-02-28

### Fixed
- `claw-pilot create` now detects missing OpenClaw before entering the wizard and offers to install it automatically — instead of throwing an opaque `OPENCLAW_NOT_FOUND` error mid-provisioning

---

## [0.6.1] — 2026-02-27

### Fixed
- Google provider now writes `GEMINI_API_KEY` in `.env` instead of `GOOGLE_API_KEY` — instances created with Google Gemini were failing to start because OpenClaw expects `GEMINI_API_KEY`
- `openclaw.json` `meta.lastTouchedVersion` bumped to `2026.2.27` to match current OpenClaw release
- Anthropic model catalog corrected — removed non-existent `claude-opus-4-6` / `claude-sonnet-4-6` model IDs, replaced with real catalog (`claude-opus-4-5`, `claude-opus-4-1`, `claude-sonnet-4-5`, `claude-haiku-4-5`)

---

## [0.6.0] — 2026-02-27

### Added
- Agent team export/import via `.team.yaml` files — snapshot and restore a full agent team (agents, prompts, spawn links) across instances
- Export button in the agents builder — generates a `.team.yaml` with all agents, their workspace files, and spawn relationships
- Import dialog in the agents builder — validates and applies a `.team.yaml` into any instance, creating agents, writing workspace files, and wiring spawn links
- Verbose import validation — detailed error messages when the YAML schema is invalid or agents are misconfigured

### Fixed
- Import now correctly restores spawn links in `openclaw.json` (`list[].subagents.allowAgents`) — previously links were lost after sync
- Workspace files (AGENTS.md, SOUL.md, etc.) are now written to the correct path (`workspaces/workspace-{id}/`) matching the convention used by agent-sync and discovery
- `main` spawn links are now written to a dedicated `list[]` entry instead of `defaults.subagents`, which was rejected by OpenClaw and caused the instance to become unhealthy

---

## [0.5.0] — 2026-02-26

### Added
- macOS support — claw-pilot now runs natively on macOS using launchd (LaunchAgents)
- `launchd-generator.ts` — generates `.plist` files for OpenClaw instances and the dashboard service
- `getServiceManager()` in `platform.ts` — abstracts systemd vs launchd dispatch
- launchd helpers: `getLaunchdDir()`, `getLaunchdLabel()`, `getLaunchdPlistPath()`, `getDashboardLaunchdPlistPath()`
- macOS OpenClaw detection paths: `~/.npm-global/bin`, `/opt/homebrew/bin`, `/usr/local/bin`
- macOS-aware PATH in `openclaw-cli.ts` (includes `/opt/homebrew/bin`)
- `xdg.ts` guard — returns empty string on macOS (XDG_RUNTIME_DIR is Linux-only)

### Changed
- `lifecycle.ts`, `provisioner.ts`, `destroyer.ts`, `health.ts`, `discovery.ts`, `dashboard-service.ts` — all dispatch on `getServiceManager()` (systemd on Linux, launchd on macOS)
- `systemd_unit` field stores launchd label (`ai.openclaw.<slug>`) on macOS
- `status.ts` — renamed "Systemd" label to "Service" for platform-neutral display

### Removed
- Nginx support — fully removed from code, wizard, DB schema, types, tests, and docs
- `nginx-generator.ts` deleted
- DB migration v4 removes `nginx_domain` column from `instances` table

---

## [0.4.0] — 2026-02-26

### Added
- Real-time instance monitoring via WebSocket change-detection (push on state change only)
- Live instance detail panel — auto-refreshes health, logs, and status without polling
- Batched health checks — parallel port scan reduces dashboard load time

### Changed
- Dashboard service migrated to `ServerConnection` abstraction (no more raw `child_process` calls)
- `execFile` migration complete — all shell ops go through `conn.execFile` for future SSH compatibility
- `detect()` in `openclaw-cli` uses `conn.exists()` instead of `--version` subprocess (no TTY required)
- Extended PATH in `detect()` and `run()` for systemd non-interactive context

### Fixed
- `/api/instances` response now merges DB fields (state, telegram_bot, etc.) into instance objects
- `state: undefined` no longer returned when DB row exists but runtime state is unknown

---

## [0.3.3] — 2026-02-26 — First public release

> This is the first official public release of claw-pilot.

### Added
- Delete instance directly from the dashboard card (no need to open the detail panel)
- CONTRIBUTING.md and GitHub issue/PR templates
- GitHub Discussions enabled (Q&A, Ideas, Show and tell, Announcements)

### Changed
- Instance card layout redesigned — cleaner action area, consistent with blueprint cards
- Blueprint card delete button replaced with compact X icon

---

## [0.3.2] — 2026-02-22

### Added
- Structured API error codes across all routes (consistent JSON error shape)
- i18n for all error messages (6 languages: EN, FR, DE, ES, IT, PT)
- Contextual error codes split by domain (instance, agent, blueprint, auth)

---

## [0.3.1] — 2026-02-21

### Added
- Team Blueprints v0.3.1 — save and reuse agent team configurations
- Default `main` agent seeded automatically on blueprint creation
- Unified agent detail panel shared between instances and blueprints

### Fixed
- Template path resolution for new blueprint agents
- Seed files correctly applied to new blueprint agents

---

## [0.3.0] — 2026-02-20

### Added
- Team Blueprints v0.3.0 — initial implementation
- Blueprint creation, listing, and deployment to instances
- SQLite schema reference (`docs/registry-db.md`)
- Inline Markdown editor for agent workspace files (SOUL.md, AGENTS.md, TOOLS.md, …)

---

## [0.2.4] — 2026-02-18

### Added
- Delete agent from the builder canvas
- SA (sub-agent) badge and tooltips on agent cards
- Agent role displayed in the detail panel header

### Fixed
- Agent card layout — name on top, slug and files on the same row
- Delete button UX — click conflict, visual design, layout

---

## [0.2.3] — 2026-02-17

### Added
- Create agent directly from the builder canvas (popup form, workspace provisioning, green highlight on creation)

### Fixed
- New agent card positioned correctly (was appearing top-left instead of top-right)
- Absolute workspace path resolution after agent creation
- File sync after agent creation

---

## [0.2.0] — 2026-02-15

### Added
- Agent Builder — visual canvas with concentric layout, agent detail panel, live sync
- Drag & drop agent cards with SQLite position persistence
- Design system overhaul — Geist font, indigo accent, CSS design tokens
- i18n support — 6 languages (EN, FR, DE, ES, IT, PT) via `@lit/localize`
- Language switcher in the dashboard footer

---

## [0.1.3] — 2026-02-14

### Added
- Gateway token injection in Control UI links — zero-friction login via `#token=` URL hash
- `claw-pilot token <slug>` command — `--url` and `--open` flags
- Control UI button on instance cards (opens `localhost:<port>` directly)

### Fixed
- Gateway token correctly injected in `GET /api/instances` response
- Telegram status detection via `openclaw.json` channels config and JSONL logs

---

## [0.1.2] — 2026-02-13

### Added
- Footer with version number, GitHub link, and MIT license credit
- Multi-provider support — Anthropic, Google, xAI (provider↔model coupling in dashboard)
- `DELETE /api/instances/:slug` endpoint
- Dashboard systemd service (auto-start at install)

### Fixed
- Constants import restored in `health.ts` and `lifecycle.ts`
- Error handling added to start/stop/restart routes
- `openclaw.json` template updated to v2026.2.14 schema
- OpenClaw absolute path and dynamic `XDG_RUNTIME_DIR` resolution in systemd service
- Provisioner uses `getOpenClawHome()` instead of hardcoded `/opt/openclaw`
- Port check accepts any HTTP response (401 = server up)
- `getOpenClawHome()` uses `os.homedir()` by default

---

## [0.1.0] — 2026-02-12 — MVP

### Added
- CLI + web dashboard for OpenClaw multi-instance orchestration
- Instance lifecycle management — `init`, `create`, `start`, `stop`, `restart`, `destroy`, `list`, `status`, `logs`
- Interactive creation wizard with Nginx + SSL config generation
- Lit/Vite web dashboard UI — real-time status via WebSocket (port 19000)
- Instance creation dialog web component
- SQLite registry (`~/.claw-pilot/registry.db`) — instances, agents, ports, config, events
- `better-sqlite3` auto-compile via `pnpm.onlyBuiltDependencies`
- Install script (`install.sh`) — clones to `/opt/claw-pilot`, builds, links binary
