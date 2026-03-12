# claw-pilot — Architecture fonctionnelle

> **Version** : 0.19.0
> **Stack** : TypeScript / Node.js ESM, Lit web components, SQLite, Hono, systemd
> **Repo** : https://github.com/swoelffel/claw-pilot
> **Références détaillées** : [ux-design.md](./ux-design.md) · [i18n.md](./i18n.md) · [design-rules.md](./design-rules.md) · `CLAUDE.md`

---

## Vue d'ensemble

claw-pilot est un **orchestrateur local** pour clusters d'instances multi-agents. Il expose deux interfaces complémentaires :

- **CLI** (`claw-pilot <commande>`) — opérations scriptables, administration système
- **Dashboard web** (`http://localhost:19000`) — interface graphique complète, temps réel

Les deux interfaces partagent la même couche métier (`src/core/`) et la même base de données SQLite (`~/.claw-pilot/registry.db`).

Depuis v0.19.0, claw-pilot gère **deux types d'instances en cohabitation** :

| Type | Moteur | Config | Lifecycle |
|---|---|---|---|
| `openclaw` | OpenClaw (tiers) | `openclaw.json` | systemd / launchd |
| `claw-runtime` | Moteur natif Node.js | `runtime.json` | PID file (daemon) |

```
┌─────────────────────────────────────────────────────────────────┐
│                        claw-pilot                               │
│                                                                 │
│   CLI (Commander.js)          Dashboard (Hono + Lit UI)         │
│   16 commandes                HTTP/WS port 19000                │
│         │                              │                        │
│         └──────────────┬───────────────┘                        │
│                        │                                        │
│              Core (src/core/)                                   │
│   Provisioner · Lifecycle · Health · Discovery · AgentSync      │
│                        │                                        │
│              Registry (façade) → 7 Repositories                 │
│                        │                                        │
│              ServerConnection (abstraction)                     │
│              LocalConnection (shell/fs local)                   │
│                        │                                        │
│              SQLite Registry (~/.claw-pilot/registry.db)        │
└─────────────────────────────────────────────────────────────────┘
          │                              │
          ▼                              ▼
  Instances OpenClaw             Instances claw-runtime
  (systemd --user)               (daemon PID file)
  ~/.openclaw-<slug>/            ~/.openclaw-<slug>/runtime.json
```

---

## Modèle de données (SQLite)

| Table | Migration | Rôle |
|---|---|---|
| `servers` | base | Serveur physique (V1 : toujours 1 ligne locale) |
| `instances` | base + v8 | Instances — slug, port, state, config_path, **instance_type** |
| `agents` | base → v3 | Agents par instance ou par blueprint (FK polymorphe depuis v3) |
| `ports` | base | Registre de réservation de ports (anti-conflit) |
| `config` | base | Config globale clé-valeur |
| `events` | base | Journal d'audit par instance |
| `agent_files` | v2 | Fichiers workspace par agent — contenu + hash |
| `agent_links` | v2 → v3 | Liens entre agents (`a2a` ou `spawn`) |
| `blueprints` | v3 | Templates d'équipes réutilisables |
| `rt_sessions` | v8 | Sessions claw-runtime |
| `rt_messages` | v8 | Messages par session |
| `rt_parts` | v8 | Parties de message (text, tool-call, tool-result) |
| `rt_pairing_codes` | v9 | Codes de pairing device 8-char |

**Version courante des migrations : 9**

**Plage de ports par défaut** : 18789–18799 (11 instances max). Dashboard : 19000.

**Règle migrations** : toujours additif (ADD COLUMN nullable, CREATE TABLE IF NOT EXISTS). Ne jamais utiliser DROP COLUMN / DROP TABLE sans recréation de table — les migrations sont irréversibles sur VM01.

---

## Structure du code

### CLI (`src/commands/`)

```
_context.ts       withContext() — ouvre DB + registry, garantit close
auth.ts           gestion des auth-profiles providers
create.ts         wizard création instance (openclaw ou claw-runtime)
dashboard.ts      démarrage/arrêt dashboard
destroy.ts        suppression instance
devices.ts        gestion device pairing
doctor.ts         diagnostic environnement
init.ts           initialisation premier démarrage
list.ts           liste instances
logs.ts           logs systemd
migrate.ts        migration openclaw → claw-runtime (clone ou in-place)
restart.ts        redémarrage instance
runtime.ts        commandes claw-runtime (start/stop/restart/status/chat/config)
service.ts        service systemd du dashboard
start.ts          démarrage instance
status.ts         état détaillé instance
stop.ts           arrêt instance
team.ts           export/import équipe
token.ts          gateway token
update.ts         mise à jour OpenClaw
```

### Core (`src/core/`)

```
lifecycle.ts          start/stop/restart — branche openclaw (systemd) vs claw-runtime (PID)
health.ts             check santé — branche openclaw (gateway HTTP) vs claw-runtime (PID file)
provisioner.ts        création instance — branche openclaw vs claw-runtime
migrator.ts           buildRuntimeConfig() — convertit openclaw.json → RuntimeConfig + MigrationReport
registry.ts           façade sur 7 repositories (+ updateInstanceType())
registry-types.ts     types InstanceRecord, AgentRecord, etc.
repositories/         7 repositories SQLite
config-reader.ts      lecture openclaw.json + .env
config-writer.ts      écriture + classification hot-reload / restart
agent-sync.ts         synchronisation agents depuis disque
blueprint-deployer.ts déploiement blueprint lors de la création
```

### Runtime (`src/runtime/`) — moteur claw-runtime

```
bus/          getBus(slug), disposeBus(), events Zod types
provider/     resolveModel(providerId, modelId), 5 providers, auth-profiles rotation
permission/   ruleset last-match-wins, allow/deny/ask
config/       RuntimeConfig schema Zod, parseRuntimeConfig(), createDefaultRuntimeConfig()
session/      createSession(), runPromptLoop() → {text,tokens,costUsd,steps,messageId}
              compaction auto, system-prompt builder
tool/         Tool.define() factory, registry (11 built-ins + MCP)
              built-in: read,write,edit,bash,glob,grep,web-fetch,question,todo,skill,task
agent/        7 built-ins (build,plan,explore,general,compaction,title,summary)
              initAgentRegistry(config.agents), getAgent(), defaultAgentName()
plugin/       8 hooks V1 (agent.before/end, tool.before/after, message.recv/send, session.start/end)
mcp/          stdio + HTTP remote, sanitize tool IDs
channel/      Channel interface, router, web-chat WS, pairing codes 8-char
              telegram: polling + MarkdownV2 formatter
engine/       ClawRuntime state machine, channel-factory, plugin-wiring
              config-loader: loadRuntimeConfig(), saveRuntimeConfig(), ensureRuntimeConfig()
```

### Dashboard (`src/dashboard/`)

```
server.ts          Point d'entrée Hono — middleware auth, rate limiting, headers sécurité
monitor.ts         WebSocket monitor (health_update toutes les 10s)
rate-limit.ts      Rate limiter par IP
route-deps.ts      Interface RouteDeps + helper apiError
token-cache.ts     Cache des gateway tokens
routes/
  instances/
    index.ts       Orchestrateur routes instances
    lifecycle.ts   POST start/stop/restart → Lifecycle
    runtime.ts     GET/POST runtime status/sessions/chat
    config.ts      GET/PATCH config OpenClaw
    devices.ts     Gestion devices
    agents/        CRUD agents + fichiers + liens
  blueprints.ts
  teams.ts
  system.ts
```

### Lib (`src/lib/`)

```
platform.ts    getStateDir(), getRuntimePidPath(), getRuntimePid(), isRuntimeRunning()
               getServiceManager(), isDocker(), getLaunchdPlistPath()
constants.ts   ports, timeouts, chemins
errors.ts      InstanceNotFoundError, GatewayUnhealthyError, etc.
logger.ts      logger.info/warn/error/success/step/dim
poll.ts        pollUntilReady()
shell.ts       shellEscape()
xdg.ts         résolution XDG_RUNTIME_DIR
```

---

## Fonctionnalités

### 1. Initialisation (`init`)

Vérifie les prérequis, crée `~/.claw-pilot/`, initialise la DB, génère le dashboard token, enregistre le serveur local.

### 2. Création d'instance (`create`)

Wizard interactif — choisit d'abord le type (`openclaw` ou `claw-runtime`), puis :

**Pour openclaw :**
1. Slug, display name, port, provider AI, API key, agents initiaux, blueprint optionnel
2. Génération `openclaw.json` + `.env` dans `~/.openclaw-<slug>/`
3. Génération service systemd `~/.config/systemd/user/openclaw-<slug>.service`
4. Démarrage + poll santé gateway (timeout 30s)
5. Device pairing + déploiement blueprint

**Pour claw-runtime :**
1. Slug, display name, port, provider AI, API key
2. Génération `runtime.json` dans `~/.openclaw-<slug>/`
3. Pas de service systemd — lifecycle par PID file

### 3. Cycle de vie (`start`, `stop`, `restart`, `destroy`)

Le `Lifecycle` branche automatiquement selon `instance_type` :

| instance_type | start | stop | restart |
|---|---|---|---|
| `openclaw` | systemctl start + poll gateway | systemctl stop | systemctl restart + poll |
| `claw-runtime` | spawn daemon + poll PID file | SIGTERM + poll | stop + start |

```bash
claw-pilot start default
claw-pilot stop default
claw-pilot restart default
claw-pilot destroy default
```

### 4. Santé (`status`, `list`)

Le `HealthChecker` branche selon `instance_type` :

| instance_type | systemd | gateway | state |
|---|---|---|---|
| `openclaw` | is-active | HTTP /health | running si gateway healthy |
| `claw-runtime` | unknown | unknown | running si PID vivant |

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
```

### 6. Token gateway (`token`)

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

### 8. Migration OpenClaw → claw-runtime (`migrate`)

Convertit une instance `openclaw` existante en instance `claw-runtime` :

```bash
claw-pilot migrate <slug>                        # clone → <slug>-rt (défaut)
claw-pilot migrate <slug> --new-slug <new>       # clone avec slug personnalisé
claw-pilot migrate <slug> --mode in-place        # conversion sur place
claw-pilot migrate <slug> --yes                  # sans confirmation interactive
```

**Mode clone** (défaut) : crée une nouvelle instance `claw-runtime` avec le slug `<slug>-rt`, convertit `openclaw.json` → `runtime.json`, laisse l'instance originale intacte.

**Mode in-place** : arrête et désactive le service systemd, écrit `runtime.json` dans le répertoire d'état existant, met à jour `instance_type` en DB. L'`openclaw.json` original est conservé mais n'est plus utilisé.

Le rapport de migration liste les champs non mappables (avertissements) et les entrées `.env` à écrire (clés API, token Telegram).

### 9. Diagnostic (`doctor`)

Vérifie Node.js, OpenClaw installé, systemd, DB, instances en état cohérent.

### 10. Service systemd du dashboard (`service`)

```bash
claw-pilot service install
claw-pilot service uninstall
claw-pilot service status
```

---

## Dashboard web

Serveur HTTP/WS Hono sur le port 19000. Auth par token Bearer (`__CP_TOKEN__`, 64 chars hex).

### Sécurité

| Mécanisme | Détail |
|---|---|
| **Auth HTTP** | `Authorization: Bearer <token>` — comparaison timing-safe |
| **Auth WebSocket** | `?token=<token>` en query param |
| **Rate limiting** | 60 req/min par IP sur `/api/*` · 10 req/min sur `POST /api/instances` |
| **Headers sécurité** | CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` |
| **Validation** | Zod `.strict()` sur les patches config |
| **TokenCache** | Cache gateway tokens en mémoire |
| **Healthcheck public** | `GET /health` sans auth |

### Routing côté client (hash-based)

| Hash URL | Vue |
|---|---|
| `#/` ou `#/instances` | Vue Instances |
| `#/instances/:slug/builder` | Constructeur d'agents |
| `#/instances/:slug/settings` | Settings instance |
| `#/blueprints` | Vue Blueprints |
| `#/blueprints/:id/builder` | Blueprint Builder |

### API REST (principales routes)

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/api/instances` | Liste instances avec état santé |
| `POST` | `/api/instances` | Créer une instance |
| `POST` | `/api/instances/:slug/start` | Démarrer |
| `POST` | `/api/instances/:slug/stop` | Arrêter |
| `POST` | `/api/instances/:slug/restart` | Redémarrer |
| `DELETE` | `/api/instances/:slug` | Détruire |
| `GET` | `/api/instances/:slug/config` | Lire config OpenClaw |
| `PATCH` | `/api/instances/:slug/config` | Modifier config |
| `GET` | `/api/instances/:slug/agents` | Agents de l'instance |
| `POST` | `/api/instances/:slug/agents` | Créer un agent |
| `GET/PUT` | `/api/instances/:slug/agents/:id/files/:filename` | Fichiers workspace |
| `GET/POST` | `/api/instances/:slug/team` | Export/import équipe |
| `GET` | `/api/instances/:slug/runtime/status` | État runtime claw-runtime |
| `GET` | `/api/instances/:slug/runtime/sessions` | Sessions actives |
| `GET` | `/api/instances/:slug/runtime/sessions/:id/messages` | Messages d'une session |
| `POST` | `/api/instances/:slug/runtime/chat` | Envoyer un message |
| `GET` | `/api/blueprints` | Liste blueprints |
| `POST` | `/api/blueprints` | Créer blueprint |
| `GET` | `/api/providers` | Catalogue providers AI |
| `GET` | `/api/port/suggest` | Suggérer un port libre |
| `GET` | `/health` | Healthcheck public |

### WebSocket Monitor

Connexion WS sur `/ws`. Diffuse des `health_update` toutes les 10s avec l'état de chaque instance.

Pour les instances `claw-runtime`, le `state` est dérivé du PID file (pas de gateway HTTP).

---

## Moteur claw-runtime

### Config (`runtime.json`)

Stockée dans `<stateDir>/runtime.json`. Schéma Zod `RuntimeConfig` :

```typescript
{
  defaultModel: "anthropic/claude-sonnet-4-5",  // "provider/model"
  agents: RuntimeAgentConfig[],
  mcpEnabled: boolean,
  mcpServers: RuntimeMcpServerConfig[],
  webChat: { enabled: boolean, port: number },
  telegram: { enabled: boolean, botToken?: string, ... },
  permissions: PermissionRule[],
}
```

### Providers supportés

| Provider | ID | Modèles |
|---|---|---|
| Anthropic | `anthropic` | claude-* |
| OpenAI | `openai` | gpt-*, o1-*, o3-* |
| Google | `google` | gemini-* |
| Ollama | `ollama` | llama3, mistral, etc. |
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
| Device pairing | Codes 8-char | `rt_pairing_codes` en DB |

### Outils built-in (11)

`read`, `write`, `edit`, `bash`, `glob`, `grep`, `web-fetch`, `question`, `todo`, `skill`, `task` (sub-agent spawning)

---

## Architecture tokens

| Token | Nom | Taille | Stockage | Rôle |
|---|---|---|---|---|
| **Gateway token** (openclaw) | `OPENCLAW_GW_AUTH_TOKEN` | 48 chars hex | `<stateDir>/.env` | Authentifie Control UI WebSocket |
| **Dashboard token** | `__CP_TOKEN__` | 64 chars hex | `~/.claw-pilot/dashboard-token` | Authentifie API REST dashboard |

---

## Compatibilité plateforme

| Gestionnaire | Plateforme | Instances openclaw | Instances claw-runtime |
|---|---|---|---|
| **systemd --user** | Linux (VM01) | `systemctl --user start/stop/...` | PID file |
| **launchd** | macOS (dev local) | `launchctl load/unload` | PID file |
| **Docker** | Container | no-op (supervisord externe) | PID file |

---

## Internationalisation

6 langues : anglais, français, allemand, espagnol, italien, portugais. Via `@lit/localize` (runtime, chargement dynamique). Voir [i18n.md](./i18n.md).

---

*Mis à jour : 2026-03-12 - v0.19.0 : claw-runtime phases 0–10 complètes (moteur natif, lifecycle daemon, cohabitation, chat web, migration openclaw → claw-runtime)*
