# Agents — Architecture et référence

> **Version** : 0.41.24
> **Références** : `src/runtime/agent/` · `src/runtime/tool/registry.ts` · `src/runtime/permission/` · `src/core/discovery.ts` · `src/core/agent-sync.ts` · `ui/src/components/agent-detail-panel.ts`

---

## Vue d'ensemble

Un **agent** dans ClawPilot est une identité LLM associée à un workspace de fichiers, un jeu d'outils, un ensemble de permissions et un cycle de vie de session. Plusieurs agents coexistent au sein d'une même instance claw-runtime et peuvent collaborer via des mécanismes de spawn ou de délégation A2A.

Chaque agent est décrit par deux axes orthogonaux :

| Axe | Champ | Valeurs |
|---|---|---|
| Rôle fonctionnel | `kind` | `"primary"` · `"subagent"` |
| Visibilité/disponibilité | `mode` | `"primary"` · `"subagent"` · `"all"` |

---

## Les deux kinds d'agents

### `kind: "primary"` — Agent user-facing

- Session **permanente** partagée entre tous les canaux (web, Telegram, CLI)
- Clé de session : `<slug>:<agentId>` (sans channel ni peerId)
- Workspace complet sur disque : `<stateDir>/workspaces/<agentId>/`
- Peut spawner des sous-agents via le tool `task` (si `toolProfile: "full"`)
- Visible et accessible par l'utilisateur
- promptMode par défaut : `"full"` (tous les fichiers workspace injectés)

### `kind: "subagent"` — Agent outil éphémère

- Session **éphémère**, scoped par `parentSessionId`
- Spawné dynamiquement par un agent primary via le tool `task`
- Ne peut **jamais** re-spawner (le tool `task` lui est toujours retiré, peu importe le `toolProfile`)
- Contexte minimal — promptMode `"subagent"` (AGENTS.md + TOOLS.md uniquement)
- Archivé après complétion de la tâche

---

## Les deux modes de disponibilité

| `mode` | Accessible via |
|---|---|
| `"primary"` | Canaux user-facing uniquement |
| `"subagent"` | Tool `task` uniquement |
| `"all"` | Les deux — défaut pour les agents user-defined |

---

## L'agent Pilot — agent par défaut user-defined

Le **Pilot** est l'agent créé automatiquement lors du provisioning d'une nouvelle instance par `createDefaultRuntimeConfig()`.

```json
{
  "id": "pilot",
  "name": "Pilot",
  "kind": "primary",
  "mode": "all",
  "isDefault": true,
  "toolProfile": "full",
  "persistence": "permanent",
  "maxSteps": 20,
  "allowSubAgents": true,
  "permissions": [
    { "permission": "*",    "pattern": "**",           "action": "allow" },
    { "permission": "read", "pattern": "*.env",        "action": "ask"   },
    { "permission": "read", "pattern": "*.env.*",      "action": "ask"   },
    { "permission": "read", "pattern": "*.env.example","action": "allow" },
    { "permission": "question", "pattern": "**",       "action": "allow" }
  ]
}
```

**Agent Pilot synthétique** : si une instance ne déclare aucun agent dans son `runtime.json`, `discovery.ts` et `agent-sync.ts` génèrent automatiquement un agent Pilot virtuel (sans écrire dans le fichier). Condition : `agentId === "pilot"` est toujours considéré `isDefault: true`.

---

## Agents built-in (natifs)

Les agents built-in sont définis dans `src/runtime/agent/defaults.ts`. Ils ont tous `native: true` et `kind: "subagent"`.

### Agents visibles (affichés dans le `task` tool)

| Agent | `name` | Description |
|---|---|---|
| **Explore** | `"explore"` | Spécialiste de recherche dans les codebases. Utilise Glob, Grep et Read. Supporte les niveaux de profondeur : `"quick"`, `"medium"`, `"very thorough"`. Read-only. |
| **General** | `"general"` | Agent généraliste pour la recherche et l'exécution multi-étapes en parallèle. |

### Agents techniques (hidden — non affichés dans le picker UI)

| Agent | `name` | Rôle |
|---|---|---|
| **Build** | `"build"` | Codage technique. Exécute des outils selon les permissions configurées. Utilise les workspace files (SOUL.md, IDENTITY.md) comme prompt. |
| **Plan** | `"plan"` | Planification read-only. Lit le codebase, produit des plans sans éditer de fichiers. Utilise les workspace files comme prompt. |

### Agents internes (hidden — infrastructure système)

| Agent | `name` | Rôle | Température |
|---|---|---|---|
| **Compaction** | `"compaction"` | Résumé structuré de conversation pour la compaction de contexte (5 sections : Active Goals, Key Constraints, Current State, Open Items, Working Context). | — |
| **Title** | `"title"` | Génère un titre court (≤ 50 caractères) pour la conversation, dans la langue de la conversation. | 0.5 |
| **Summary** | `"summary"` | Résumé style PR description de ce qui a été fait (2-3 phrases, à la première personne). | — |

> **Note** : `build` et `plan` n'ont pas de prompt inline — ils chargent leurs workspace files (SOUL.md, IDENTITY.md) depuis `<stateDir>/workspaces/<agentId>/`. Les agents `compaction`, `title`, `summary`, `explore` et `general` ont des prompts inline non modifiables par l'utilisateur.

---

## Tool profiles

Le `toolProfile` d'un agent détermine l'ensemble des outils disponibles. Défini dans `src/runtime/tool/registry.ts`.

| Profile | Outils disponibles | Usage typique |
|---|---|---|
| `minimal` | `question` | Agents conversationnels purs, sans accès aux fichiers |
| `messaging` | `question`, `webfetch` | Agents de communication ou de veille web |
| `coding` | `read`, `write`, `edit`, `multiedit`, `bash`, `glob`, `grep`, `webfetch`, `question`, `todowrite`, `todoread`, `skill` | Agents de développement (défaut pour les built-in) |
| `full` | Tout `coding` + `task` | Orchestrateurs — peuvent spawner des sous-agents |

**Règle absolue** : le tool `task` est **toujours retiré** pour les agents `kind: "subagent"`, quelle que soit la valeur du `toolProfile`. Un sous-agent ne peut jamais en spawner d'autres.

---

## Permissions et rulesets

Les permissions contrôlent quelles opérations un agent peut effectuer. La règle d'évaluation est **last-match-wins** — si aucune règle ne correspond, l'action par défaut est `"ask"`.

### Rulesets prédéfinis

**`DEFAULT_RULESET`** — utilisé pour le Pilot et les agents `build` et `general` :
```
*       **             allow   (tout autorisé par défaut)
read    *.env          ask     (fichiers .env : demander)
read    *.env.*        ask
read    *.env.example  allow   (exemples : autoriser)
```

**`EXPLORE_AGENT_RULESET`** — read-only avec bash sous condition :
```
read    **   allow
glob    **   allow
grep    **   allow
bash    **   ask
write   **   deny
edit    **   deny
task    **   deny
```

**`PLAN_AGENT_RULESET`** — read-only, pas d'exécution :
```
read    **   allow
glob    **   allow
grep    **   allow
write   **   deny
edit    **   deny
bash    **   ask
```

**`INTERNAL_AGENT_RULESET`** — aucun outil (compaction, title, summary) :
```
*       **   deny
```

### Structure d'une règle de permission

```typescript
{
  permission: string;   // "read" | "write" | "edit" | "bash" | "glob" | "grep" | "task" | "*"
  pattern:    string;   // glob pattern (ex: "**", "*.env", "src/**/*.ts")
  action:     "allow" | "deny" | "ask";
}
```

---

## Persistance de session

La persistance est résolue par `resolveEffectivePersistence()` selon l'ordre de priorité suivant :

| Priorité | Règle |
|---|---|
| 1 | Valeur explicite `persistence` dans `runtime.json` (override absolu) |
| 2 | Inférée depuis `kind` : `"primary"` → `"permanent"`, `"subagent"` → `"ephemeral"` |
| 3 | Défaut sécurisé : `"ephemeral"` |

| Valeur | Comportement |
|---|---|
| `"permanent"` | Une session par agent, partagée cross-canal. Clé : `<slug>:<agentId>` |
| `"ephemeral"` | Une session par tâche/conversation. Clé : `<slug>:<agentId>:<channel>:<peerId>` |

---

## promptMode — injection du workspace

Le `promptMode` contrôle quels fichiers workspace sont chargés dans le system prompt. Il est inféré automatiquement depuis `kind` si non spécifié.

| Mode | Fichiers chargés |
|---|---|
| `"full"` | SOUL, BOOTSTRAP, AGENTS, TOOLS, IDENTITY, USER, HEARTBEAT + `memory/*.md` |
| `"minimal"` | SOUL, AGENTS, TOOLS, IDENTITY, USER (sans HEARTBEAT ni memory) |
| `"subagent"` | AGENTS.md et TOOLS.md uniquement |

---

## Liens entre agents

Les agents peuvent être reliés via deux types de liens (`AgentLinkRecord`) :

| `link_type` | Sémantique | Direction |
|---|---|---|
| `"spawn"` | L'agent source peut spawner la cible via le tool `task` | Hiérarchique (parent → enfant) |
| `"a2a"` | Délégation peer-to-peer entre agents primary | Bidirectionnel ou directionnel |

Les liens `spawn` sont extraits automatiquement depuis `agents[].subagents.allowAgents[]` dans `runtime.json` lors de la synchronisation (`agent-sync.ts`). Les liens `a2a` sont déclarés explicitement.

La politique A2A est également contrôlée par `agentToAgent.allowList` dans la config de l'agent source.

---

## Blueprint agent vs Instance agent

| Type | Table DB | Lié à | Rôle |
|---|---|---|---|
| **Blueprint agent** | `agents` (`blueprint_id != null`, `instance_id = null`) | Un blueprint | Template réutilisable. Les fichiers workspace sont stockés dans la DB (`agent_files`). |
| **Instance agent** | `agents` (`instance_id != null`, `blueprint_id = null`) | Une instance active | Agent concret avec workspace physique sur disque. Synchronisé depuis `runtime.json` par `AgentSync`. |

Le `BlueprintDeployer` matérialise les blueprint agents en instance agents : il copie les fichiers workspace depuis la DB vers le disque et met à jour `runtime.json`.

---

## Cycle de vie d'un agent

```
Provisioning d'une nouvelle instance
  └─> createDefaultRuntimeConfig()        → runtime.json avec agent Pilot par défaut

InstanceDiscovery.scan()
  └─> parse runtime.json agents[]         → si vide → synthetic Pilot agent
  └─> adopt()                             → registry.createAgent() + AgentSync.sync()

AgentSync.sync() (à chaque démarrage d'instance)
  └─> 1. Lit runtime.json
  └─> 2. Construit la liste des agents attendus (avec fallback synthetic pilot)
  └─> 3. Réconcilie avec la DB (add/update/remove selon config_hash SHA-256)
  └─> 4. Synce les workspace files (DISCOVERABLE_FILES)
  └─> 5. Extrait et remplace les liens agent-to-agent (replaceAgentLinks())

AgentProvisioner.createAgent()            → ajout d'un agent à une instance existante
  └─> mkdir workspaces/<agentId>/
  └─> write template files
       - primary : SOUL, BOOTSTRAP, AGENTS, TOOLS, IDENTITY, USER, HEARTBEAT + memory/*.md
       - subagent : AGENTS.md + TOOLS.md uniquement
  └─> update runtime.json agents[]
  └─> registry.upsertAgent()

BlueprintDeployer.deploy()                → déployer un blueprint sur une instance
  └─> copy workspace files from DB
  └─> update runtime.json agents[]
  └─> registry.upsertAgent()
```

---

## Card Agent — Onglets de configuration (Dashboard UI)

Le composant `cp-agent-detail-panel` (`ui/src/components/agent-detail-panel.ts`) expose la configuration d'un agent via trois onglets.

---

### Onglet Info

Affiche les métadonnées de l'agent et les liens de délégation. Les champs suivants sont éditables via le formulaire (icône crayon) sur les instances uniquement.

| Champ UI | Stockage | Clé | Notes |
|---|---|---|---|
| **Name** | `runtime.json` | `agents[].name` | Nom affiché dans l'UI |
| **Provider / Model** | `runtime.json` | `agents[].model` | Sélection en deux temps : provider → modèle. Stocké au format `"provider/model"` |
| **Role** | DB uniquement | `agents.role` | Libre, non synchronisé vers `runtime.json` |
| **Tags** | DB uniquement | `agents.tags` | CSV, non synchronisé vers `runtime.json` |
| **Notes** | DB uniquement | `agents.notes` | Texte libre, non synchronisé vers `runtime.json` |
| **Skills** | DB + `runtime.json` | `agents.skills` / `agents[].skills` | `null` = tous les skills disponibles ; `[]` = aucun ; array = liste explicite. Sur instance running : toggle All/None/Custom + checkboxes |
| **Delegates to** | DB (`agent_links`) | `link_type: "spawn"`, `source_agent_id` | Badges + dropdown pour ajouter/retirer des cibles de spawn |
| **Delegated by** | DB (`agent_links`) | `link_type: "spawn"`, `target_agent_id` | Lecture seule — agents qui peuvent spawner cet agent |

> **Role, Tags, Notes** sont des champs purement UI (table `agents` en DB). Ils ne sont pas écrits dans `runtime.json` et ne sont pas lus par le moteur claw-runtime.

---

### Onglet Heartbeat

Configure les tâches autonomes périodiques de l'agent. Tout le bloc est absent de `runtime.json` si le heartbeat est désactivé (`null`).

| Champ UI | Label | Clé `runtime.json` | Type | Valeurs / Contraintes |
|---|---|---|---|---|
| **Enable heartbeat** | "Enable heartbeat" | présence de `heartbeat` | toggle | Si désactivé → `heartbeat: null` dans le JSON |
| **Interval** | "Interval" | `heartbeat.every` | `string` (enum) | `"5m"`, `"10m"`, `"15m"`, `"30m"`, `"1h"`, `"2h"`, `"4h"`, `"6h"`, `"12h"`, `"24h"` |
| **Active hours start** | "Active hours" | `heartbeat.activeHours.start` | `string` HH:MM | Format 24h. Nécessite aussi `end` et `tz` |
| **Active hours end** | "Active hours" | `heartbeat.activeHours.end` | `string` HH:MM | Format 24h |
| **Max response chars** | "Max response chars" | `heartbeat.ackMaxChars` | `number` | min 100, max 5000. Défaut : `500` |
| **Prompt source** | "Use HEARTBEAT.md" / "Custom prompt" | présence de `heartbeat.prompt` | radio | `"file"` → pas de champ `prompt` dans le JSON ; `"custom"` → `heartbeat.prompt` = texte |
| **Custom prompt** | — | `heartbeat.prompt` | `string` | Affiché uniquement si prompt source = "Custom prompt" |
| **Tick history** | "Tick history" | lecture seule via API | — | 20 derniers ticks. Instance uniquement, read-only |

**Champs fantômes (gérés en backend uniquement, non exposés dans l'UI) :**

| Champ | Clé `runtime.json` | Notes |
|---|---|---|
| Timezone | `heartbeat.activeHours.tz` | Chargé et préservé à la sauvegarde, mais **aucun champ UI**. Requis par le schéma si `activeHours` est défini. Doit être configuré manuellement dans `runtime.json`. |
| Model | `heartbeat.model` | Modèle dédié pour les ticks heartbeat. Chargé et préservé, mais **non éditable via l'UI**. |

---

### Onglet Config

Configure le comportement LLM et les timeouts de l'agent. Tous ces champs sont écrits dans `runtime.json`.

#### Section LLM

| Champ UI | Label | Clé `runtime.json` | Type | Valeurs / Contraintes |
|---|---|---|---|---|
| **Tool profile** | "Tool profile" | `agents[].toolProfile` | `string` (enum) | `"minimal"`, `"messaging"`, `"coding"`, `"full"`. Défaut : `"coding"` |
| **Prompt mode** | "Prompt mode" | `agents[].promptMode` | `string` (enum) | `"full"`, `"minimal"` (UI). Le schéma backend accepte aussi `"subagent"`, non exposé dans l'UI |
| **Max steps** | "Max steps" | `agents[].maxSteps` | `number` entier | min 1, max 100. Défaut : `20` |
| **Temperature** | "Temperature" | `agents[].temperature` | `number` | min 0, max 2, step 0.1. Laisser vide = modèle par défaut |

#### Section Extended thinking (Anthropic)

| Champ UI | Label | Clé `runtime.json` | Type | Valeurs / Contraintes |
|---|---|---|---|---|
| **Enable** | "Enable" | `agents[].thinking.enabled` | `boolean` | toggle |
| **Budget tokens** | "Budget tokens" | `agents[].thinking.budgetTokens` | `number` entier | min 1000, max 100000. Défaut : `15000`. Affiché uniquement si thinking activé |

#### Section Spawn

| Champ UI | Label | Clé `runtime.json` | Type | Notes |
|---|---|---|---|---|
| **Allow sub-agents** | "Allow sub-agents" | `agents[].allowSubAgents` | `boolean` | Défaut : `true`. Contrôle globalement la capacité à spawner |

#### Section Timeouts

| Champ UI | Label | Clé `runtime.json` | Type | Valeurs / Contraintes |
|---|---|---|---|---|
| **Session timeout** | "Session timeout (ms)" | `agents[].timeoutMs` | `number` entier | min 1000. Défaut : `300000` (5 min). Timeout global de la session |
| **LLM inter-chunk timeout** | "LLM inter-chunk timeout (ms)" | `agents[].chunkTimeoutMs` | `number` entier | min 5000. Défaut : `120000` (2 min). Timeout entre deux chunks LLM consécutifs |

#### Section Instructions

| Champ UI | Label | Clé `runtime.json` | Type | Notes |
|---|---|---|---|---|
| **Remote instruction URLs** | "Remote instruction URLs" | `agents[].instructionUrls` | `string[]` | URLs fetchées au démarrage de session et ajoutées au system prompt. Bouton `+ URL` pour en ajouter |
| **Additional workspace files (globs)** | "Additional workspace files (globs)" | `agents[].bootstrapFiles` | `string[]` | Glob patterns. Les fichiers correspondants sont injectés dans le system prompt en plus des workspace files standards. Bouton `+ Glob` pour en ajouter |

> **Note sur `bootstrapFiles`** : côté UI ce champ est nommé `workspaceGlobs` en interne. Le mapping vers `bootstrapFiles` (nom du schéma backend) est effectué lors de la sauvegarde.

---

## Référence rapide des champs `runtime.json`

Champs de configuration d'un agent dans `runtime.json` (type `RuntimeAgentConfig`) :

| Champ | Type | Défaut | Description |
|---|---|---|---|
| `id` | `string` | requis | Identifiant unique de l'agent |
| `name` | `string` | requis | Nom affiché |
| `model` | `string` | requis | Format `"provider/model"` ou alias |
| `isDefault` | `boolean` | `false` | Agent par défaut pour les nouvelles sessions |
| `toolProfile` | `"minimal"\|"coding"\|"messaging"\|"full"` | `"coding"` | Jeu d'outils disponibles |
| `permissions` | `PermissionRule[]` | `[]` | Ruleset de permissions |
| `persistence` | `"permanent"\|"ephemeral"` | inféré | Override de persistance de session |
| `promptMode` | `"full"\|"minimal"\|"subagent"` | inféré | Fichiers workspace injectés (`"subagent"` non exposé dans l'UI) |
| `maxSteps` | `number` (1–100) | `20` | Nombre maximum de tool-call steps |
| `temperature` | `number` (0–2) | — | Température LLM |
| `systemPrompt` | `string` | — | Override du system prompt inline |
| `systemPromptFile` | `string` | — | Chemin vers un fichier de system prompt |
| `allowSubAgents` | `boolean` | `true` | Autorise le spawn de sous-agents |
| `agentToAgent` | `{ enabled, allowList }` | — | Politique de délégation A2A |
| `thinking.enabled` | `boolean` | `false` | Active l'extended thinking (Anthropic) |
| `thinking.budgetTokens` | `number` (1000–100000) | `15000` | Budget de tokens de réflexion |
| `bootstrapFiles` | `string[]` | — | Glob patterns injectés dans le prompt (nommé `workspaceGlobs` dans l'UI) |
| `instructionUrls` | `string[]` | — | URLs fetchées et ajoutées au prompt |
| `skillUrls` | `string[]` | — | Index JSON de skills distants |
| `timeoutMs` | `number` | `300000` | Timeout global par session (5 min) |
| `chunkTimeoutMs` | `number` | `120000` | Timeout entre chunks LLM (2 min) |
| `inheritWorkspace` | `boolean` | — | Sous-agents héritent du workDir parent |
| `heartbeat.every` | `string` (enum) | — | Intervalle : `"5m"` à `"24h"` |
| `heartbeat.activeHours.start` | `string` HH:MM | — | Début de la plage horaire active |
| `heartbeat.activeHours.end` | `string` HH:MM | — | Fin de la plage horaire active |
| `heartbeat.activeHours.tz` | `string` | — | Timezone IANA (ex: `"Europe/Paris"`). **Requis** si `activeHours` est défini. Non éditable via l'UI |
| `heartbeat.ackMaxChars` | `number` (100–5000) | `500` | Longueur max de la réponse de tick |
| `heartbeat.prompt` | `string` | — | Prompt personnalisé pour les ticks. Absent = utilise HEARTBEAT.md |
| `heartbeat.model` | `string` | — | Modèle dédié pour les ticks. Non éditable via l'UI |
