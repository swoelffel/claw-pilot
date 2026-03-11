# claw-pilot — Architecture fonctionnelle

> **Version** : 0.7.2  
> **Stack** : TypeScript / Node.js ESM, Lit web components, SQLite, Hono, systemd  
> **Repo** : https://github.com/swoelffel/claw-pilot  
> **Références détaillées** : [ux-design.md](./ux-design.md) · [i18n.md](./i18n.md) · [design-rules.md](./design-rules.md) · `CLAUDE.md`

---

## Vue d'ensemble

claw-pilot est un **orchestrateur local** pour clusters d'instances OpenClaw. Il expose deux interfaces complémentaires :

- **CLI** (`claw-pilot <commande>`) — opérations scriptables, administration système
- **Dashboard web** (`http://localhost:19000`) — interface graphique complète, temps réel

Les deux interfaces partagent la même couche métier (`src/core/`) et la même base de données SQLite (`~/.claw-pilot/registry.db`).

```
┌─────────────────────────────────────────────────────────────────┐
│                        claw-pilot                               │
│                                                                 │
│   CLI (Commander.js)          Dashboard (Hono + Lit UI)         │
│   15 commandes                HTTP/WS port 19000                │
│         │                              │                        │
│         └──────────────┬───────────────┘                        │
│                        │                                        │
│              Core (src/core/)                                   │
│   Provisioner · Lifecycle · Discovery · AgentSync · ...         │
│                        │                                        │
│              Registry (façade) → 7 Repositories                 │
│   AgentRepo · BlueprintRepo · ConfigRepo · EventRepo            │
│   InstanceRepo · PortRepo · ServerRepo                          │
│                        │                                        │
│              ServerConnection (abstraction)                     │
│              LocalConnection (shell/fs local)                   │
│                        │                                        │
│              SQLite Registry (~/.claw-pilot/registry.db)        │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼
              Instances OpenClaw (systemd --user)
              ~/.openclaw-<slug>/  ×N
```

### Structure du dashboard (src/dashboard/)

Le serveur HTTP/WS est organisé en modules depuis v0.7.1 :

```
src/dashboard/
  server.ts          # Point d'entrée Hono — middleware auth, rate limiting, headers sécurité
  monitor.ts         # WebSocket monitor (health_update toutes les 10s)
  rate-limit.ts      # Rate limiter par IP
  route-deps.ts      # Interface RouteDeps + helper apiError
  token-cache.ts     # Cache des gateway tokens (évite N lectures disque par appel API)
  routes/
    instances.ts     # Routes /api/instances/*
    blueprints.ts    # Routes /api/blueprints/*
    teams.ts         # Routes /api/*/team
    system.ts        # Routes /api/openclaw/*, /api/providers, /api/port
```

### Structure du core (src/core/)

`registry.ts` est une **façade mince** sur 7 repositories depuis v0.7.2 :

```
src/core/repositories/
  agent-repository.ts
  blueprint-repository.ts
  config-repository.ts
  event-repository.ts
  instance-repository.ts
  port-repository.ts
  server-repository.ts
```

`config-updater.ts` est un barrel re-export depuis v0.7.1 — la logique est répartie en :

```
src/core/
  config-types.ts    # Types et interfaces
  config-helpers.ts  # Helpers partagés
  config-reader.ts   # Lecture openclaw.json + .env
  config-writer.ts   # Écriture + classification hot-reload / restart
```

---

## Modèle de données (SQLite)

| Table | Migration | Rôle |
|---|---|---|
| `servers` | base | Serveur physique (V1 : toujours 1 ligne locale) |
| `instances` | base | Instances OpenClaw — slug, port, state, config_path, state_dir |
| `agents` | base → v3 | Agents par instance ou par blueprint (FK polymorphe depuis v3) |
| `ports` | base | Registre de réservation de ports (anti-conflit) |
| `config` | base | Config globale clé-valeur |
| `events` | base | Journal d'audit par instance |
| `agent_files` | v2 | Fichiers workspace par agent (AGENTS.md, SOUL.md, etc.) — contenu + hash |
| `agent_links` | v2 → v3 | Liens entre agents (`a2a` ou `spawn`) — FK polymorphe depuis v3 |
| `blueprints` | v3 | Templates d'équipes réutilisables |

**Plage de ports par défaut** : 18789–18799 (11 instances max). Dashboard : 19000.

**Migrations** : 4 migrations appliquées automatiquement à l'ouverture de la DB. Les migrations additives (ADD COLUMN nullable, CREATE TABLE IF NOT EXISTS) sont irréversibles sur VM01 — ne jamais utiliser DROP COLUMN ou DROP TABLE sans `disableFk: true` et recréation de table.

---

## Fonctionnalités

### 1. Initialisation (`init`)

Commande de premier démarrage. Vérifie les prérequis (Node, OpenClaw installé), crée la structure `~/.claw-pilot/`, initialise la DB, génère le dashboard token, enregistre le serveur local.

```bash
claw-pilot init
```

### 2. Création d'instance (`create`)

Provisionne une nouvelle instance OpenClaw de A à Z :

1. **Wizard interactif** — slug, display name, port (auto-suggéré), provider AI, API key, agents initiaux, blueprint optionnel
2. **Génération de config** — `openclaw.json` + `.env` (API key) dans `~/.openclaw-<slug>/`
3. **Génération du service systemd** — `~/.config/systemd/user/openclaw-<slug>.service`
4. **Démarrage** — `systemctl --user start`, poll santé gateway (timeout 30s)
5. **Device pairing** — connexion automatique au gateway + auto-approbation
6. **Déploiement blueprint** — si blueprint sélectionné, déploie les agents du template
7. **Enregistrement DB** — instance, agents, port réservé, événement `created`

```bash
claw-pilot create          # wizard interactif
```

**Rollback** : en cas d'échec partiel, les artefacts créés (fichiers, service, entrée DB) sont supprimés.

### 3. Découverte (`status`, `list`)

Scan du système pour détecter les instances existantes non encore enregistrées :

- Scan des répertoires `~/.openclaw-<slug>/` (présence de `openclaw.json`)
- Scan des unités systemd actives (`openclaw-*.service`)
- Réconciliation avec le registre : nouvelles / supprimées / inchangées
- Mise à jour de l'état (`running` / `stopped` / `error` / `unknown`)

```bash
claw-pilot list            # liste toutes les instances
claw-pilot status [slug]   # état détaillé
```

### 4. Cycle de vie (`start`, `stop`, `restart`, `destroy`)

Opérations sur les services systemd (ou launchd sur macOS) :

| Commande | Action |
|---|---|
| `start <slug>` | `systemctl start` + poll santé + mise à jour DB |
| `stop <slug>` | `systemctl stop` + mise à jour DB |
| `restart <slug>` | stop + start |
| `destroy <slug>` | stop + disable + suppression fichiers + libération port + suppression DB |

```bash
claw-pilot start default
claw-pilot stop default
claw-pilot restart default
claw-pilot destroy default
```

### 5. Logs (`logs`)

Affiche les logs systemd de l'instance via `journalctl --user -u openclaw-<slug>.service`.

```bash
claw-pilot logs default
claw-pilot logs default --follow
```

### 6. Token gateway (`token`)

Lit le gateway token depuis `<stateDir>/.env` et l'expose pour un login zero-friction dans le Control UI OpenClaw.

```bash
claw-pilot token default          # token brut
claw-pilot token default --url    # URL avec #token= (hash fragment)
claw-pilot token default --open   # ouvre le navigateur
```

### 7. Export / Import d'équipe (`team`)

Sérialise la configuration d'une équipe d'agents (identités, fichiers workspace, liens spawn/A2A) dans un fichier `.team.yaml` portable.

```bash
claw-pilot team export default --output team.yaml
claw-pilot team import default --file team.yaml
```

**Format** : YAML versionné (`version: "1"`). Inclut pour chaque agent : `agent_id`, `name`, `model`, `role`, fichiers workspace (AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, USER.md, HEARTBEAT.md), liens spawn.

### 8. Diagnostic (`doctor`)

Vérifie l'environnement : Node.js, OpenClaw installé, systemd disponible, DB accessible, instances en état cohérent.

```bash
claw-pilot doctor
```

### 9. Service systemd du dashboard (`service`)

Gère le service systemd du dashboard claw-pilot lui-même.

```bash
claw-pilot service install    # installe et active le service
claw-pilot service uninstall  # désinstalle
claw-pilot service status     # état du service
```

---

## Dashboard web

Serveur HTTP/WS Hono sur le port 19000. Authentification par token Bearer (`__CP_TOKEN__`, 64 chars hex, stocké dans `~/.claw-pilot/dashboard-token`).

### Sécurité

| Mécanisme | Détail |
|---|---|
| **Auth HTTP** | `Authorization: Bearer <token>` — comparaison timing-safe (`crypto.timingSafeEqual`) |
| **Auth WebSocket** | `?token=<token>` en query param — même comparaison timing-safe |
| **Rate limiting** | 60 req/min par IP sur `/api/*` · 10 req/min sur `POST /api/instances` · 1 req/5min sur `POST /api/openclaw/update` |
| **Headers sécurité** | CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` |
| **Validation** | `ConfigPatch` validé avec Zod `.strict()` · taille upload blueprint limitée à 1 MB |
| **TokenCache** | Cache des gateway tokens en mémoire — évite N lectures disque par appel API |
| **Healthcheck public** | `GET /health` sans auth — pour systemd, load balancers, monitoring |

### Routing côté client

Navigation hash-based depuis v0.7.1 — le browser back/forward et le refresh fonctionnent :

| Hash URL | Vue |
|---|---|
| `#/` ou `#/instances` | Vue Instances (accueil) |
| `#/instances/:slug/builder` | Constructeur d'agents |
| `#/instances/:slug/settings` | Settings instance |
| `#/blueprints` | Vue Blueprints |
| `#/blueprints/:id/builder` | Blueprint Builder |

### Vues

| Vue | Composant | Description |
|---|---|---|
| **Instances** | `cp-cluster-view` | Grille de cards. Bannière update OpenClaw. Création d'instance. |
| **Détail instance** | `cp-instance-detail` | Infos complètes, actions (start/stop/restart/delete), agents, conversations récentes. |
| **Settings instance** | `cp-instance-settings` | Édition de la config OpenClaw (General, Providers, Agents, Telegram, Plugins, Gateway). |
| **Agents Builder** | `cp-agents-builder` | Canvas drag & drop des agents, liens spawn/A2A, panneau détail + édition fichiers. |
| **Blueprints** | `cp-blueprints-view` | Grille de templates d'équipes. |
| **Blueprint Builder** | `cp-blueprint-builder` | Même canvas que Agents Builder, contexte blueprint. |

Voir [ux-design.md](./ux-design.md) pour le détail visuel et comportemental de chaque vue.

### API REST (principales routes)

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/api/instances` | Liste des instances avec état santé |
| `POST` | `/api/instances` | Créer une instance (provisioning complet) |
| `POST` | `/api/instances/:slug/start` | Démarrer |
| `POST` | `/api/instances/:slug/stop` | Arrêter |
| `POST` | `/api/instances/:slug/restart` | Redémarrer |
| `DELETE` | `/api/instances/:slug` | Détruire |
| `GET` | `/api/instances/:slug/config` | Lire la config OpenClaw structurée |
| `PATCH` | `/api/instances/:slug/config` | Modifier la config (hot-reload ou restart) |
| `GET` | `/api/instances/:slug/agents` | Agents de l'instance (builder) |
| `POST` | `/api/instances/:slug/agents` | Créer un agent |
| `DELETE` | `/api/instances/:slug/agents/:id` | Supprimer un agent |
| `POST` | `/api/instances/:slug/sync` | Resynchroniser agents depuis le disque |
| `GET/PUT` | `/api/instances/:slug/agents/:id/files/:filename` | Lire/écrire un fichier workspace |
| `GET/PUT` | `/api/instances/:slug/agents/:id/spawn-links` | Liens spawn |
| `GET/POST` | `/api/instances/:slug/team` | Export/import équipe |
| `GET` | `/api/blueprints` | Liste des blueprints |
| `POST` | `/api/blueprints` | Créer un blueprint |
| `DELETE` | `/api/blueprints/:id` | Supprimer un blueprint |
| `GET` | `/api/openclaw/update-status` | État update OpenClaw (version courante + registry) |
| `POST` | `/api/openclaw/update` | Déclencher la mise à jour OpenClaw |
| `GET` | `/api/providers` | Catalogue des providers AI disponibles |
| `GET` | `/api/port/suggest` | Suggérer un port libre |
| `GET` | `/health` | Healthcheck public (sans auth) — `{ ok: true, service: "claw-pilot" }` |

### WebSocket Monitor

Connexion WS sur `/ws`. Diffuse des `health_update` toutes les 10s avec l'état de chaque instance (systemd + gateway + agentCount + telegram).

---

## Gestion de la configuration OpenClaw

La vue Settings (`cp-instance-settings`) permet d'éditer `openclaw.json` et `.env` sans SSH. Le backend (`config-updater.ts`) :

1. Lit `openclaw.json` + `.env` de l'instance
2. Applique le patch (PATCH partiel, seuls les champs modifiés)
3. Classifie les changements : **hot-reload** (Telegram bot token, certains paramètres) vs **restart requis** (plugins, gateway, providers)
4. Redémarre l'instance si nécessaire, sinon envoie un signal de reload

**Champs éditables** : display name, default model, tools profile, providers (add/remove/update key), agent defaults (workspace, subagents, compaction, heartbeat), Telegram (enabled, bot token, policies, stream mode), mem0 (enabled, URLs), gateway (reload mode, debounce).

---

## Gestion des agents

### Agents Builder (canvas)

- Cards d'agents positionnées librement (drag & drop, position persistée en DB)
- Liens SVG entre agents (spawn normal / pending-add / pending-remove)
- Panneau détail latéral : infos, liens A2A/spawn éditables, fichiers workspace (lecture + édition Markdown)
- Sync depuis disque : relit `openclaw.json` + fichiers workspace, met à jour la DB

### Fichiers workspace éditables

AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, USER.md, HEARTBEAT.md. Écriture directe dans `<stateDir>/workspaces/<workspace>/`.

### Blueprints

Templates d'équipes réutilisables (sans instance live). Même canvas que Agents Builder. Déployables lors de la création d'une instance.

---

## Mise à jour OpenClaw

Détection automatique de version disponible (npm registry) + mise à jour en un clic depuis le dashboard.

1. **Détection** : `openclaw --version` (version courante) + `GET https://registry.npmjs.org/openclaw/latest` (dernière version)
2. **Bannière** : affichée dans la vue Instances si `latestVersion > currentVersion`
3. **Mise à jour** : `npm install -g openclaw@latest --omit=optional` (timeout 300s, shell exec pour résolution PATH)
4. **Restart** : toutes les instances `running` sont redémarrées après l'install
5. **Polling** : pendant l'update, le dashboard poll toutes les 2s pour mettre à jour la bannière

---

## Architecture tokens

Deux tokens distincts, rôles différents :

| Token | Nom | Taille | Stockage | Rôle |
|---|---|---|---|---|
| **Gateway token** | `OPENCLAW_GW_AUTH_TOKEN` | 48 chars hex | `<stateDir>/.env` | Authentifie les connexions Control UI WebSocket (par instance) |
| **Dashboard token** | `__CP_TOKEN__` | 64 chars hex | `~/.claw-pilot/dashboard-token` | Authentifie l'API REST du dashboard claw-pilot (global) |

Le dashboard injecte automatiquement le gateway token dans les liens Control UI (`#token=<token>` en hash fragment).

---

## Internationalisation

6 langues supportées : anglais, français, allemand, espagnol, italien, portugais. Implémentation via `@lit/localize` (runtime, chargement dynamique par chunk). Voir [i18n.md](./i18n.md).

---

## Compatibilité plateforme

| Gestionnaire de services | Plateforme | Implémentation |
|---|---|---|
| **systemd --user** | Linux (VM01) | `systemctl --user start/stop/...` |
| **launchd** | macOS (dev local) | `launchctl load/unload` + plists |

L'abstraction `ServerConnection` isole toutes les opérations shell/fs. Prévu pour une future implémentation SSH (multi-serveur).

---

*Mis à jour : 2026-03-03 - v0.7.2 : architecture repositories, route modules, sécurité dashboard, routing hash-based, modèle de données complet*
