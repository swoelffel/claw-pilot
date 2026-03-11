# Changelog

All notable changes to claw-pilot are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

---

## [0.16.3] — 2026-03-11

### Added
- **Docs intégrées au repo** : `main-doc.md` (architecture fonctionnelle), `ux-design.md`, `design-rules.md`, `i18n.md` déplacés dans `docs/` — plus de dépendance au monorepo parent

### Changed
- **CLAUDE.md enrichi** : section UI development avec arbre `ui/src/`, table de référence docs internes, version trackée, suppression des références externes au monorepo

### Fixed
- **`LocalConnection.writeFile()` — fallback sudo sur EACCES/EPERM** : sur Linux, si `fs.writeFile` échoue avec `EACCES` ou `EPERM`, retente automatiquement via `sudo tee` avec contenu base64-encodé — même pattern que `readFile()` (v0.16.0)

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
