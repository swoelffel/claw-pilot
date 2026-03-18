# claw-pilot — Architecture fonctionnelle

> **Version** : 0.41.24
> **Stack** : TypeScript / Node.js ESM, Lit web components, SQLite, Hono
> **Repo** : https://github.com/swoelffel/claw-pilot
> **Références détaillées** : [ux-design.md](./ux-design.md) · [agents.md](./agents.md) · [registry-db.md](./registry-db.md) · [i18n.md](./i18n.md) · [design-rules.md](./design-rules.md) · `CLAUDE.md`

---

## Vue d'ensemble

claw-pilot est un **orchestrateur local** pour clusters d'instances multi-agents. Il expose deux interfaces complémentaires :

- **CLI** (`claw-pilot <commande>`) — opérations scriptables, administration système
- **Dashboard web** (`http://localhost:19000`) — interface graphique complète, temps réel

Les deux interfaces partagent la même couche métier (`src/core/`) et la même base de données SQLite (`~/.claw-pilot/registry.db`).

Toutes les instances utilisent le moteur **claw-runtime** — un moteur natif Node.js géré via PID file (daemon).

```
┌─────────────────────────────────────────────────────────────────┐
│                        claw-pilot                               │
│                                                                 │
│   CLI (Commander.js)          Dashboard (Hono + Lit UI)         │
│   commandes                   HTTP/WS port 19000                │
│         │                              │                        │
│         └──────────────┬───────────────┘                        │
│                        │                                        │
│              Core (src/core/)                                   │
│   Provisioner · Lifecycle · Health · Discovery · AgentSync      │
│   BlueprintDeployer · AgentProvisioner · TeamExport/Import      │
│                        │                                        │
│              Registry (façade) → 8 Repositories                 │
│                        │                                        │
│              ServerConnection (abstraction)                     │
│              LocalConnection (shell/fs local)                   │
│                        │                                        │
│              SQLite Registry (~/.claw-pilot/registry.db)        │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼
               Instances claw-runtime
               (daemon PID file)
               <stateDir>/runtime.json
               <stateDir>/workspaces/<agentId>/
```

---

## Modèle de données (SQLite)

| Table | Migration | Rôle |
|---|---|---|
| `servers` | base | Serveur physique (V1 : toujours 1 ligne locale) |
| `instances` | base + v4 + v8 + v10 | Instances — slug, port, state, config_path, state_dir |
| `agents` | base → v3 + v7 + v13 | Agents par instance ou par blueprint (FK polymorphe depuis v3) |
| `ports` | base | Registre de réservation de ports (anti-conflit) |
| `config` | base | Config globale clé-valeur |
| `events` | base | Journal d'audit par instance |
| `agent_files` | v2 | Fichiers workspace par agent — contenu + hash |
| `agent_links` | v2 → v3 | Liens entre agents (`a2a` ou `spawn`) |
| `blueprints` | v3 | Templates d'équipes réutilisables |
| `users` | v6 | Auth dashboard — admin/operator/viewer |
| `sessions` | v6 | Sessions serveur avec TTL et sliding window |
| `rt_sessions` | v8 + v11 + v13 + v14 | Sessions claw-runtime — permanentes (1 par agent, cross-canal) ou éphémères. Clé : `<slug>:<agentId>` (permanent) ou `<slug>:<agentId>:<channel>:<peerId>` (éphémère) |
| `rt_messages` | v8 + v14 | Messages par session (index composite `session_id, role` en v14) |
| `rt_parts` | v8 | Parties de message (text, tool-call, tool-result, reasoning, subtask, compaction) |
| `rt_permissions` | v8 | Règles de permission persistées (allow/deny/ask par scope+pattern) |
| `rt_auth_profiles` | v8 | Rotation de clés API par provider (priorité, cooldown, tracking échecs) |
| `rt_pairing_codes` | v9 + v12 | Codes de pairing device (legacy, table conservée) |

**Version courante des migrations : 15**

**Plage de ports par défaut** : 18789–18838 (50 ports, 10 instances à pas de 5). Dashboard : 19000.

**Règle migrations** : toujours additif (ADD COLUMN nullable, CREATE TABLE IF NOT EXISTS). Ne jamais utiliser DROP COLUMN / DROP TABLE sans recréation de table — les migrations sont irréversibles sur VM01.

Référence complète : [registry-db.md](./registry-db.md)

---

## Structure du code

### CLI (`src/commands/`)

```
_context.ts       withContext() — ouvre DB + registry, garantit close
auth.ts           gestion des auth-profiles providers
create.ts         wizard création instance
dashboard.ts      démarrage/arrêt dashboard
destroy.ts        suppression instance
doctor.ts         diagnostic environnement
init.ts           initialisation premier démarrage
list.ts           liste instances
logs.ts           logs runtime
restart.ts        redémarrage instance
runtime.ts        commandes claw-runtime (start/stop/restart/status/chat/config/mcp)
service.ts        service systemd/launchd du dashboard
start.ts          démarrage instance
status.ts         état détaillé instance
stop.ts           arrêt instance
team.ts           export/import équipe YAML
token.ts          token instance
update.ts         auto-update depuis GitHub
```

### Core (`src/core/`)

```
lifecycle.ts          start/stop/restart — PID file daemon
health.ts             check santé — PID file
provisioner.ts        création instance (wizard)
agent-provisioner.ts  ajout d'agents à une instance existante
registry.ts           façade sur 8 repositories
registry-types.ts     types InstanceRecord, AgentRecord, BlueprintRecord, etc.
repositories/         8 repositories SQLite (server, instance, agent, port, config, event, blueprint, runtime-session)
agent-sync.ts         synchronisation agents depuis runtime.json
agent-workspace.ts    résolution chemins workspace agents
blueprint-deployer.ts déploiement blueprint lors de la création
config-generator.ts   génération .env avec clés provider
config-helpers.ts     manipulation runtime.json
dashboard-service.ts  install/uninstall service systemd/launchd
destroyer.ts          suppression instance (ports, DB, fichiers)
discovery.ts          découverte instances existantes sur le système
secrets.ts            génération tokens dashboard (64 chars hex)
self-update-checker.ts  check GitHub releases
self-updater.ts       git pull + pnpm install + pnpm build
team-export.ts        export .team.yaml
team-import.ts        import .team.yaml
team-schema.ts        schéma Zod .team.yaml (version "1")
workspace-state.ts    état workspace
launchd-generator.ts  génération plist macOS
systemd-generator.ts  génération unit systemd Linux
```

### Runtime (`src/runtime/`) — moteur claw-runtime

```
engine/       ClawRuntime(config, db, slug, workDir?) — state machine, channel-factory
              config-loader: loadRuntimeConfig(), saveRuntimeConfig(), ensureRuntimeConfig()
              plugin-wiring: wirePluginsToBus()
bus/          getBus(slug), disposeBus(), 25 event types Zod
provider/     resolveModel(providerId, modelId), 5 providers, auth-profiles rotation
              MODEL_CATALOG : 10 modèles (Anthropic, OpenAI, Google, Ollama)
permission/   ruleset last-match-wins, allow/deny/ask, wildcard glob matching
config/       RuntimeConfig schema Zod, parseRuntimeConfig(), createDefaultRuntimeConfig()
session/      createSession(), getOrCreatePermanentSession(), runPromptLoop()
              permanent session key: <slug>:<agentId> (cross-channel, no peerId)
              compaction auto, system-prompt builder, workspace-cache
              message-builder: convertit DB messages → ModelMessage[] (AI SDK v6)
              usage-tracker: suivi coûts et tokens
              cleanup: nettoyage sessions éphémères (rétention configurable)
tool/         Tool.define() factory, registry (12 built-ins + MCP + plugin tools)
              built-in: read, write, edit, multiedit, bash, glob, grep, webfetch, question, todowrite, todoread, skill
              task: sous-agent spawning (ajouté dynamiquement au profil "full")
              profiles: minimal, messaging, coding, full
agent/        7 built-ins (build, plan, explore, general, compaction, title, summary)
              build/plan: workspace-only (no inline prompt) — use SOUL.md, IDENTITY.md
              initAgentRegistry(config.agents), getAgent(), defaultAgentName()
              resolveEffectivePersistence(): kind="primary" → "permanent"
plugin/       8 hooks V1 (agent.before/end, tool.before/after, message.recv/send, session.start/end)
              tools(), routes(), tool.definition transform
mcp/          stdio + HTTP remote, McpRegistry, McpClient, sanitize tool IDs
channel/      Channel interface, ChannelRouter (per-session serialization queue), web-chat WS
              telegram: polling + webhook + MarkdownV2 formatter, pairing flow
memory/       FTS5 full-text search index (memory-index.db), decay scoring
              search-tool: memory_search pour agents, writer: écriture fichiers mémoire
heartbeat/    HeartbeatRunner, intervalles 5m-24h, active hours (timezone-aware)
              HeartbeatTick, HeartbeatAlert, ack pattern "HEARTBEAT_OK"
```

### Dashboard (`src/dashboard/`)

```
server.ts          Point d'entrée Hono — middleware auth (session cookie + Bearer token),
                   rate limiting, headers sécurité, SPA fallback, WebSocket
monitor.ts         WebSocket monitor (health_update toutes les 10s, delta-compressed)
                   enrichit avec: pendingPermissions, heartbeat agents/alerts, MCP count
rate-limit.ts      Rate limiter par IP (60/min API, 10/min instances, 1/5min self-update)
request-id.ts      Middleware X-Request-Id
route-deps.ts      Interface RouteDeps + helper apiError
session-store.ts   Session store serveur (TTL, sliding window, periodic cleanup)
token-cache.ts     Cache des tokens en mémoire
routes/
  auth.ts          POST login/logout, GET me
  system.ts        GET health, GET/POST self-update
  teams.ts         GET/POST export/import instances et blueprints
  blueprints.ts    CRUD blueprints + agents + fichiers + spawn-links
  instances/
    index.ts       Orchestrateur routes instances
    lifecycle.ts   CRUD instances + start/stop/restart + discover/adopt
    config.ts      GET/PATCH config + providers catalog + telegram token
    runtime.ts     GET runtime status/sessions/messages/context, POST chat, GET stream SSE, GET heartbeat history
    mcp.ts         GET mcp tools/status
    permissions.ts GET permissions, DELETE rule, POST reply
    telegram.ts    GET pairing, POST approve, DELETE reject
    discover.ts    POST discover + adopt
    agents/        CRUD agents + fichiers + sync + skills + spawn-links (8 sous-modules)
```

### Lib (`src/lib/`)

```
platform.ts        getDataDir(), getStateDir(), getRuntimePidPath(), getRuntimePid(),
                   isRuntimeRunning(), getServiceManager(), isDocker(), getLaunchdPlistPath()
constants.ts       PORT_RANGE_START(18789), PORT_RANGE_END(18838), DASHBOARD_PORT(19000),
                   timeouts, chemins, DISCOVERABLE_FILES
errors.ts          ClawPilotError, CliError, InstanceNotFoundError, PortConflictError,
                   GatewayUnhealthyError
logger.ts          logger.info/warn/error/success/step/dim (chalk-based)
poll.ts            pollUntilReady()
shell.ts           shellEscape()
xdg.ts             résolution XDG_RUNTIME_DIR
dotenv.ts          parseur .env
env-reader.ts      lecture .env depuis state dirs
validate.ts        validation d'entrées
guards.ts          instanceGuard pour routes
date.ts            formatage dates
process.ts         utilitaires process
model-helpers.ts   normalisation chaînes modèle
provider-catalog.ts catalogue metadata providers
providers.ts       utilitaires providers
workspace-templates.ts rendu templates workspace (Handlebars-style)
```

---

## Fonctionnalités

### 1. Initialisation (`init`)

Vérifie les prérequis, crée `~/.claw-pilot/`, initialise la DB, génère le dashboard token, crée l'utilisateur admin, enregistre le serveur local.

### 2. Création d'instance (`create`)

Wizard interactif :

1. Slug, display name, port, provider AI, API key, agents initiaux, blueprint optionnel
2. Génération `runtime.json` dans le répertoire d'état (`~/.claw-pilot/instances/<slug>/`)
3. Lifecycle par PID file

### 3. Cycle de vie (`start`, `stop`, `restart`, `destroy`)

Le `Lifecycle` gère les instances claw-runtime via PID file daemon :

| Action | Comportement |
|---|---|
| start | spawn daemon + poll PID file |
| stop | SIGTERM + poll disparition process |
| restart | stop + start |

```bash
claw-pilot start default
claw-pilot stop default
claw-pilot restart default
claw-pilot destroy default
```

### 4. Santé (`status`, `list`)

Le `HealthChecker` vérifie l'état via PID file — l'instance est `running` si le process PID est vivant.

### 5. Commandes claw-runtime (`runtime`)

```bash
claw-pilot runtime start <slug>              # foreground (SIGTERM pour arrêter)
claw-pilot runtime start <slug> --daemon     # daemon détaché (écrit PID file)
claw-pilot runtime stop <slug>               # SIGTERM + poll arrêt
claw-pilot runtime restart <slug>            # stop + start --daemon
claw-pilot runtime status <slug>             # état + config
claw-pilot runtime chat <slug>               # REPL interactif
claw-pilot runtime chat <slug> --once "msg"  # mode non-interactif (CI/scripts)
claw-pilot runtime config init <slug>        # crée runtime.json avec defaults
claw-pilot runtime config show <slug>        # affiche runtime.json
claw-pilot runtime config edit <slug>        # édite runtime.json
claw-pilot runtime mcp add <slug>            # ajoute un serveur MCP
claw-pilot runtime mcp remove <slug>         # retire un serveur MCP
claw-pilot runtime mcp list <slug>           # liste les serveurs MCP
```

### 6. Token instance (`token`)

```bash
claw-pilot token default          # token brut
claw-pilot token default --url    # URL avec #token=
claw-pilot token default --open   # ouvre le navigateur
```

### 7. Export / Import d'équipe (`team`)

```bash
claw-pilot team export default --output team.yaml
claw-pilot team import default --file team.yaml
```

### 8. Diagnostic (`doctor`)

Vérifie Node.js, systemd/launchd, DB, instances en état cohérent.

### 9. Service dashboard (`service`)

```bash
claw-pilot service install
claw-pilot service uninstall
claw-pilot service status
```

### 10. Auto-update (`update`)

```bash
claw-pilot update              # met à jour depuis GitHub (git pull + build)
```

---

## Dashboard web

Serveur HTTP/WS Hono sur le port 19000. Auth duale : session cookie (priorité) ou Bearer token (fallback).

### Sécurité

| Mécanisme | Détail |
|---|---|
| **Auth session** | `POST /api/auth/login` → cookie HttpOnly, session store serveur avec TTL |
| **Auth token** | `Authorization: Bearer <token>` — comparaison timing-safe |
| **Auth WebSocket** | Premier message authentifié via token |
| **Rate limiting** | 60 req/min par IP sur `/api/*` · 10 req/min sur `POST /api/instances` · 1/5min self-update |
| **Headers sécurité** | CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` |
| **Validation** | Zod `.strict()` sur les patches config |
| **TokenCache** | Cache tokens en mémoire |
| **Healthcheck public** | `GET /health` sans auth |

### Routing côté client (hash-based)

| Hash URL | Vue | Composant |
|---|---|---|
| `#/` ou `#/instances` | Vue Instances | `cp-cluster-view` |
| `#/instances/:slug/builder` | Constructeur d'agents | `cp-agents-builder` |
| `#/instances/:slug/settings` | Settings instance | `cp-instance-settings` |
| `#/instances/:slug/pilot` | Chat interactif + panneau contexte LLM | `cp-runtime-pilot` |
| `#/blueprints` | Vue Blueprints | `cp-blueprints-view` |
| `#/blueprints/:id/builder` | Blueprint Builder | `cp-blueprint-builder` |

### API REST (57 endpoints)

#### Auth

| Méthode | Route | Rôle |
|---|---|---|
| `POST` | `/api/auth/login` | Authentification, crée session |
| `POST` | `/api/auth/logout` | Invalide session |
| `GET` | `/api/auth/me` | Info utilisateur courant + token WS |

#### Système

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/api/health` | Healthcheck (version, uptime, DB size) |
| `GET` | `/api/self/update-status` | Check mise à jour |
| `POST` | `/api/self/update` | Lancer auto-update |

#### Instances — CRUD & Lifecycle

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/api/instances` | Liste avec état santé |
| `POST` | `/api/instances` | Provisionner nouvelle instance |
| `GET` | `/api/instances/:slug` | Détail + santé + token |
| `GET` | `/api/instances/:slug/health` | Santé |
| `POST` | `/api/instances/:slug/start` | Démarrer |
| `POST` | `/api/instances/:slug/stop` | Arrêter |
| `POST` | `/api/instances/:slug/restart` | Redémarrer |
| `DELETE` | `/api/instances/:slug` | Détruire |
| `GET` | `/api/next-port` | Prochain port libre |
| `POST` | `/api/instances/discover` | Scanner le système |
| `POST` | `/api/instances/discover/adopt` | Adopter instances découvertes |

#### Instances — Config

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/api/instances/:slug/config` | Lire config structurée |
| `PATCH` | `/api/instances/:slug/config` | Modifier config (hot reload) |
| `PATCH` | `/api/instances/:slug/config/telegram/token` | Modifier token Telegram |
| `GET` | `/api/providers` | Catalogue providers AI |

#### Instances — Agents (10 endpoints)

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/api/instances/:slug/agents` | Liste agents |
| `GET` | `/api/instances/:slug/agents/builder` | Données builder (agents + liens) |
| `POST` | `/api/instances/:slug/agents` | Créer agent |
| `DELETE` | `/api/instances/:slug/agents/:agentId` | Supprimer agent |
| `PATCH` | `/api/instances/:slug/agents/:agentId/meta` | Mettre à jour métadonnées |
| `PATCH` | `/api/instances/:slug/agents/:agentId/position` | Position canvas |
| `PATCH` | `/api/instances/:slug/agents/:agentId/spawn-links` | Liens de spawn |
| `GET/PUT` | `/api/instances/:slug/agents/:agentId/files/:filename` | Fichiers workspace |
| `GET` | `/api/instances/:slug/skills` | Skills disponibles |
| `POST` | `/api/instances/:slug/agents/sync` | Sync depuis disque |

#### Instances — Runtime

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/api/instances/:slug/runtime/status` | État runtime |
| `GET` | `/api/instances/:slug/runtime/sessions` | Liste sessions |
| `GET` | `/api/instances/:slug/runtime/sessions/:id/messages` | Messages + parts |
| `GET` | `/api/instances/:slug/runtime/sessions/:id/context` | Contexte LLM |
| `POST` | `/api/instances/:slug/runtime/chat` | Envoyer un message |
| `GET` | `/api/instances/:slug/runtime/chat/stream` | SSE streaming temps réel |
| `GET` | `/api/instances/:slug/runtime/heartbeat/history` | Historique heartbeat |

#### Instances — MCP & Permissions

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/api/instances/:slug/mcp/tools` | Outils MCP |
| `GET` | `/api/instances/:slug/mcp/status` | Statut serveurs MCP |
| `GET` | `/api/instances/:slug/runtime/permissions` | Règles permissions |
| `DELETE` | `/api/instances/:slug/runtime/permissions/:id` | Supprimer règle |
| `POST` | `/api/instances/:slug/runtime/permission/reply` | Répondre demande |

#### Instances — Telegram

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/api/instances/:slug/telegram/pairing` | Statut pairing |
| `POST` | `/api/instances/:slug/telegram/pairing/approve` | Approuver |
| `DELETE` | `/api/instances/:slug/telegram/pairing/:code` | Rejeter |

#### Blueprints (13 endpoints)

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/api/blueprints` | Liste blueprints |
| `POST` | `/api/blueprints` | Créer blueprint |
| `GET` | `/api/blueprints/:id` | Détail blueprint |
| `PUT` | `/api/blueprints/:id` | Modifier blueprint |
| `DELETE` | `/api/blueprints/:id` | Supprimer blueprint |
| `GET` | `/api/blueprints/:id/builder` | Données builder complètes |
| `POST` | `/api/blueprints/:id/agents` | Ajouter agent |
| `PATCH` | `/api/blueprints/:id/agents/:agentId/meta` | Métadonnées agent |
| `DELETE` | `/api/blueprints/:id/agents/:agentId` | Supprimer agent |
| `PATCH` | `/api/blueprints/:id/agents/:agentId/position` | Position canvas |
| `GET/PUT` | `/api/blueprints/:id/agents/:agentId/files/:filename` | Fichiers workspace |
| `PATCH` | `/api/blueprints/:id/agents/:agentId/spawn-links` | Liens spawn |

#### Teams

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/api/instances/:slug/team/export` | Export YAML |
| `POST` | `/api/instances/:slug/team/import` | Import YAML (avec dry_run) |
| `GET` | `/api/blueprints/:id/team/export` | Export blueprint |
| `POST` | `/api/blueprints/:id/team/import` | Import blueprint |

### WebSocket Monitor

Connexion WS sur `/ws`. Auth via premier message. Diffuse des `health_update` toutes les 10s avec l'état de chaque instance (delta-compressed). Enrichit avec : permissions en attente, heartbeat agents/alertes, MCP count.

---

## Moteur claw-runtime

### Config (`runtime.json`)

Stockée dans `<stateDir>/runtime.json`. Schéma Zod `RuntimeConfig` :

```typescript
{
  defaultModel: "anthropic/claude-sonnet-4-5",  // "provider/model"
  defaultInternalModel?: "anthropic/claude-haiku-3-5",
  models?: { [alias]: "provider/model" },
  providers?: { [providerId]: { apiKeyEnvVar } },
  agents: RuntimeAgentConfig[],
  globalPermissions?: PermissionRule[],
  mcpEnabled: boolean,
  mcpServers: RuntimeMcpServerConfig[],
  webChat: { enabled: boolean, port: number },
  telegram: { enabled: boolean, botToken?: string, ... },
  compaction?: { threshold, reservedTokens },
  subagents?: { maxSpawnDepth, maxActiveChildren },
}
```

Référence complète des champs agent : [agents.md](./agents.md)

### Providers supportés

| Provider | ID | Modèles |
|---|---|---|
| Anthropic | `anthropic` | claude-opus-4-5, claude-sonnet-4-5, claude-haiku-3-5 |
| OpenAI | `openai` | gpt-4o, gpt-4o-mini, o3-mini |
| Google | `google` | gemini-2.0-flash, gemini-2.5-pro |
| Ollama | `ollama` | llama3.2, qwen2.5-coder (local, gratuit) |
| OpenRouter | `openrouter` | tout modèle OpenRouter |

### Lifecycle daemon

```
runtime start --daemon <slug>
  → spawn(process.execPath, ["runtime", "start", slug], { detached: true })
  → child écrit PID dans <stateDir>/runtime.pid
  → parent poll PID file (5s timeout)

runtime stop <slug>
  → lit PID file → process.kill(pid, "SIGTERM")
  → poll jusqu'à disparition du process (5s timeout)
  → supprime PID file si encore présent

runtime start (foreground)
  → écrit PID file au démarrage
  → supprime PID file à l'arrêt (SIGTERM/SIGINT)
```

### Channels

| Channel | Protocole | Config |
|---|---|---|
| Web Chat | WebSocket | `webChat.enabled`, `webChat.port` |
| Telegram | Polling HTTPS | `telegram.enabled`, `telegram.botToken` |

### Outils built-in (12 + 1 dynamique)

| Outil | Profils | Description |
|---|---|---|
| `read` | coding, full | Lecture de fichiers |
| `write` | coding, full | Écriture de fichiers |
| `edit` | coding, full | Édition de sections de fichiers |
| `multiedit` | coding, full | Édition multi-sections |
| `bash` | coding, full | Exécution de commandes shell |
| `glob` | coding, full | Recherche de fichiers par pattern |
| `grep` | coding, full | Recherche dans le contenu des fichiers |
| `webfetch` | messaging, coding, full | Récupération de contenu web |
| `question` | minimal, messaging, coding, full | Poser une question à l'utilisateur |
| `todowrite` | coding, full | Gestion de todo list (écriture) |
| `todoread` | coding, full | Gestion de todo list (lecture) |
| `skill` | coding, full | Exécution d'un skill nommé |
| `task` | full uniquement | Spawn de sous-agent (retiré pour les subagents) |

### Bus d'événements (25 types)

Le bus est instance-scoped (`getBus(slug)`). 25 types d'événements typés Zod :

| Catégorie | Événements |
|---|---|
| Runtime | `runtime.started`, `runtime.stopped`, `runtime.state_changed`, `runtime.error` |
| Session | `session.created`, `session.updated`, `session.ended`, `session.status` |
| Message | `message.created`, `message.updated`, `message.part.delta` |
| Permission | `permission.asked`, `permission.replied` |
| Provider | `provider.auth_failed`, `provider.failover` |
| Subagent | `subagent.completed`, `agent.timeout` |
| Heartbeat | `heartbeat.tick`, `heartbeat.alert` |
| MCP | `mcp.server.reconnected`, `mcp.tools.changed` |
| Tool | `tool.doom_loop`, `llm.chunk_timeout` |
| Channel | `channel.message.received`, `channel.message.sent` |

### Système de mémoire

Index FTS5 SQLite dans `memory-index.db` séparé. Chunks MEMORY.md et memory/*.md (500 chars, 100 overlap). Recherche BM25. Decay scoring temporel. Tool `memory_search` pour les agents.

---

## Architecture tokens

| Token | Taille | Stockage | Rôle |
|---|---|---|---|
| **Dashboard token** | 64 chars hex | `~/.claw-pilot/dashboard-token` | Authentifie API REST dashboard (Bearer) |
| **Session cookie** | UUID | Server-side session store | Auth dashboard (cookie HttpOnly) |
| **Password hash** | scrypt | Table `users` | Auth login |

---

## Compatibilité plateforme

| Gestionnaire | Plateforme | Instances claw-runtime |
|---|---|---|
| **systemd --user** | Linux (VM01) | PID file |
| **launchd** | macOS (dev local, MACMINI-INT) | PID file |
| **Docker** | Container | PID file |

---

## Internationalisation

6 langues : anglais, français, allemand, espagnol, italien, portugais. Via `@lit/localize` (runtime, chargement dynamique). Voir [i18n.md](./i18n.md).

---

*Mis à jour : 2026-03-18 - v0.41.24 : refonte complète (57 API endpoints, 12+1 outils, 25 bus events, 8 repositories, mémoire FTS5, auth session cookie)*
