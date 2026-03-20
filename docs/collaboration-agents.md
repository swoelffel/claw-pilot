# Collaboration des agents claw-pilot — Vue fonctionnelle

> **Audience** : profils fonctionnels (PM, architectes, ops)
> **Version** : claw-pilot v0.41.x
> **Date** : 2026-03-19

---

## 1. Vue d'ensemble

claw-pilot orchestre des **equipes d'agents IA** qui collaborent pour accomplir des taches
complexes. Chaque instance heberge un ou plusieurs agents qui communiquent entre eux
selon des mecanismes precis.

Ce document decrit les **schemas de collaboration** entre agents, independamment du code.

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         Instance claw-runtime                             │
│                                                                           │
│   ┌─────────┐    delegation    ┌─────────┐    delegation    ┌─────────┐  │
│   │ Agent A ├─────────────────>│ Agent B ├─────────────────>│ Agent C │  │
│   │ primary │<─────────────────│ primary │<─────────────────│ primary │  │
│   └────┬────┘    resultat      └────┬────┘    resultat      └─────────┘  │
│        │                            │                                     │
│        │ spawn                      │ spawn                               │
│        v                            v                                     │
│   ┌─────────┐                  ┌─────────┐                                │
│   │ explore │                  │  build  │   sous-agents ephemeres        │
│   │ (outil) │                  │ (outil) │   (session jetable)            │
│   └─────────┘                  └─────────┘                                │
│                                                                           │
│   Bus d'evenements (communication temps reel interne)                     │
└────────────────────────────────────────────────────────────────────────────┘
        ^               ^               ^
        │               │               │
   ┌────┴────┐    ┌─────┴─────┐   ┌────┴────┐
   │   Web   │    │ Telegram  │   │   CLI   │    Canaux utilisateur
   │  Chat   │    │   Bot     │   │  REPL   │    (entrees/sorties)
   └─────────┘    └───────────┘   └─────────┘
```

---

## 2. Les deux familles d'agents

Tous les agents se classent selon deux axes orthogonaux :

### Axe 1 — Role fonctionnel (`kind`)

| Kind | Role | Session | Peut deleguer ? |
|------|------|---------|-----------------|
| **primary** | Agent principal, interagit avec l'utilisateur | Permanente (vit indefiniment, cross-canal) | Oui — via l'outil `task` |
| **subagent** | Agent outil, execute une tache precise | Ephemere (detruite apres usage) | Non — jamais |

### Axe 2 — Categorie (`category`)

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│   AGENTS USER              AGENTS OUTIL           AGENTS SYSTEME │
│   (crees par               (built-in,             (internes,     │
│    l'utilisateur)           delegataires)          invisibles)    │
│                                                                  │
│   ┌────────────┐           ┌────────────┐        ┌────────────┐ │
│   │   Pilot    │           │  explore   │        │ compaction │ │
│   │ (defaut)   │           │  general   │        │   title    │ │
│   │            │           │   build    │        │  summary   │ │
│   │  Agent A   │           │   plan     │        │            │ │
│   │  Agent B   │           │            │        │            │ │
│   │  ...       │           │            │        │            │ │
│   └────────────┘           └────────────┘        └────────────┘ │
│                                                                  │
│   Configurable             Non configurable       Invisible      │
│   Visible UI               Visible dans task      Automatique    │
│   Session permanente       Session ephemere       Pas de session │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Agents outil built-in** :

| Agent | Specialite | Acces |
|-------|-----------|-------|
| **explore** | Recherche rapide dans le code (glob, grep, lecture) | Lecture seule |
| **general** | Recherche multi-etapes, execution parallele | Lecture + ecriture |
| **build** | Codage technique, execution de taches dev | Lecture + ecriture + bash |
| **plan** | Planification, analyse, recommendations | Lecture seule |

---

## 3. Les trois patterns de collaboration

### Pattern A — Spawn hierarchique (primary -> subagent)

C'est le pattern le plus courant. Un agent primary delegue une tache ponctuelle a un
sous-agent outil (built-in ou custom).

```
                                     SPAWN HIERARCHIQUE
                                     ==================

   Utilisateur                Agent Pilot                    Agent explore
       │                     (primary, permanent)            (subagent, ephemere)
       │                          │                               │
       │  "Trouve les fichiers    │                               │
       │   qui gerent les users"  │                               │
       │─────────────────────────>│                               │
       │                          │                               │
       │                          │  task(explore, "quick",       │
       │                          │  "Trouve les fichiers users") │
       │                          │──────────────────────────────>│
       │                          │                               │
       │                          │         Session ephemere      │
       │                          │         creee (isolee)        │
       │                          │                               │
       │                          │   [explore cherche, lit,      │
       │                          │    analyse le code...]        │
       │                          │                               │
       │                          │  Resultat :                   │
       │                          │  "src/auth/users.ts:12,       │
       │                          │   src/models/user.ts:1"       │
       │                          │<──────────────────────────────│
       │                          │                               │
       │                          │         Session ephemere      │
       │                          │         archivee              │
       │                          │                             [FIN]
       │                          │
       │  "Les fichiers users     │
       │   sont dans src/auth/    │
       │   et src/models/"        │
       │<─────────────────────────│
       │                          │
```

**Proprietes cles :**
- Le sous-agent a une session **ephemere** et **isolee** (200k tokens vierges)
- Le sous-agent ne peut **jamais** re-deleguer (pas d'outil `task`)
- Le resultat est injecte dans la conversation du parent
- Profondeur max : 3 niveaux (configurable)
- Max 5 sous-agents actifs par session (configurable)

---

### Pattern B — Delegation peer-to-peer (primary -> primary)

Quand une instance contient plusieurs agents primary, ils peuvent se deleguer
mutuellement du travail. Chacun garde sa **session permanente** et son **contexte
propre**.

```
                              DELEGATION PEER-TO-PEER
                              =======================

   Utilisateur             Agent Pilot                    Agent Researcher
       │                  (primary)                       (primary)
       │                       │                               │
       │  "Analyse le marche   │                               │
       │   des ERP en 2026"    │                               │
       │──────────────────────>│                               │
       │                       │                               │
       │                       │  task(researcher,             │
       │                       │  "Analyse marche ERP 2026")   │
       │                       │──────────────────────────────>│
       │                       │                               │
       │                       │     Le Researcher utilise     │
       │                       │     SA session permanente     │
       │                       │     (conserve son historique, │
       │                       │      sa memoire, son contexte)│
       │                       │                               │
       │                       │  Resultat de l'analyse        │
       │                       │<──────────────────────────────│
       │                       │                               │
       │  "Voici l'analyse     │                               │
       │   du marche ERP..."   │                               │
       │<──────────────────────│                               │
       │                       │                               │
```

**Proprietes cles :**
- L'agent cible utilise sa **propre session permanente** (pas de session ephemere)
- L'agent cible conserve **sa memoire long terme** et son **contexte accumule**
- La delegation peut se faire par **nom d'agent** ou par **competence** (`expertIn`)
- L'agent cible utilise **son propre modele LLM** (peut etre different du delegataire)
- Politique A2A configurable (liste blanche d'agents autorises)

---

### Pattern C — Delegation asynchrone

Les deux patterns precedents (A et B) peuvent s'executer en mode **asynchrone** :
l'agent delegataire n'attend pas la reponse et continue son travail.

```
                              DELEGATION ASYNCHRONE
                              =====================

   Utilisateur             Agent Pilot                    Agent build
       │                  (primary)                       (subagent)
       │                       │                               │
       │  "Lance les tests     │                               │
       │   et corrige s'il     │                               │
       │   y a des erreurs"    │                               │
       │──────────────────────>│                               │
       │                       │                               │
       │                       │  task(build, async,           │
       │                       │  "Lance tests + fix")         │
       │                       │────────────────────────> (demarre en fond)
       │                       │                               │
       │  "C'est lance,        │  Pas de blocage —             │
       │   je te dis quand     │  le Pilot continue            │
       │   c'est fini"         │                               │
       │<──────────────────────│                               │
       │                       │                    [build travaille...]
       │                       │                               │
       │                       │                               │
       │                       │  ┌──────────────────────────┐ │
       │                       │  │ Evenement bus :           │ │
       │                       │  │ subagent.completed        │ │
       │                       │  │ (resultat injecte dans    │ │
       │                       │  │  la session du Pilot)     │ │
       │                       │  └──────────────────────────┘ │
       │                       │<──────────────────────────────│
       │                       │                               │
       │  "Les tests passent,  │                               │
       │   j'ai corrige 3      │                               │
       │   erreurs de types"   │                               │
       │<──────────────────────│                               │
       │                       │                               │
```

**Proprietes cles :**
- Le delegataire recoit immediatement un `task_id` de suivi
- Le sous-agent s'execute en arriere-plan
- A la fin, un evenement `subagent.completed` injecte le resultat dans la session parent
- Le parent reprend automatiquement le dialogue avec l'utilisateur

---

## 4. Schema de routage des messages

Comment un message utilisateur arrive jusqu'au bon agent :

```
                           ROUTAGE D'UN MESSAGE
                           ====================

  ┌───────────┐    ┌───────────┐    ┌───────────┐
  │    Web    │    │ Telegram  │    │    CLI    │
  │   Chat    │    │    Bot    │    │   REPL   │
  └─────┬─────┘    └─────┬─────┘    └─────┬─────┘
        │                │                │
        └────────────────┼────────────────┘
                         │
                         v
               ┌─────────────────┐
               │ Channel Router  │
               │                 │
               │ 1. Quel agent ? │──> agent par defaut (Pilot)
               │                 │    ou agent specifie
               │                 │
               │ 2. Verification │──> subagent interdit
               │    (subagent ?) │    depuis un canal user
               │                 │
               │ 3. Session ?    │──> permanente : <slug>:<agentId>
               │                 │    ephemere : <slug>:<agentId>:<ch>:<peer>
               │                 │
               │ 4. File         │──> 1 message a la fois par session
               │    d'attente    │    (serialisation garantie)
               │                 │
               └────────┬────────┘
                        │
                        v
               ┌─────────────────┐
               │   Prompt Loop   │
               │                 │
               │ System prompt   │
               │ + historique    │
               │ + outils        │
               │ + memoire       │
               │                 │
               │ --> Appel LLM   │
               │ --> Execution   │
               │     outils      │
               │ --> Reponse     │
               └────────┬────────┘
                        │
                        v
               ┌─────────────────┐
               │   Reponse au    │
               │   canal source  │
               └─────────────────┘
```

**Point cle** : un agent primary avec session permanente recoit les messages de
**tous les canaux** dans la **meme conversation**. Un message envoye via Telegram
et la reponse consultee sur le Web Chat sont dans le meme fil.

---

## 5. Architecture d'une equipe BMAD

Le pattern **BMAD** (Business/Marketing/Architecture/Development) est un exemple reel
d'equipe multi-agents deployee en production sur claw-pilot.

```
                           EQUIPE BMAD v4
                           ==============

                        ┌──────────────┐
                        │   PILOTE     │
                        │   (main)     │
                        │              │
                        │ Orchestre    │
                        │ Valide      │
                        │ Decide      │
                        └──────┬───────┘
                               │
              ┌────────────────┼────────────────┬────────────────┐
              │                │                │                │
              v                v                v                v
     ┌────────────┐   ┌────────────┐   ┌────────────┐   ┌────────────┐
     │   JOHN     │   │   SALLY    │   │  WINSTON   │   │   OSCAR    │
     │    (pm)    │   │(ux-design) │   │(architect) │   │   (ops)    │
     │            │   │            │   │            │   │            │
     │ Team Lead  │   │ Team Lead  │   │ Team Lead  │   │ Team Lead  │
     │  Metier    │   │  Design    │   │    Dev     │   │    Ops     │
     └──────┬─────┘   └──────┬─────┘   └──────┬─────┘   └──────┬─────┘
            │                │                │                │
            v                v           ┌────┼────┐           v
     ┌────────────┐   ┌────────────┐     v    v    v    ┌────────────┐
     │   MARY     │   │   LENA     │  Amelia Clara Quinn│   FELIX    │
     │ (analyst)  │   │   (ui)     │  (back) (front)(qa)│   (dba)    │
     └────────────┘   └────────────┘                    └────────────┘
```

### Pipeline BMAD — phases de projet

```
                         PIPELINE BMAD v4
                         ================

  Phase 1            Phase 2             Phase 3             Phase 4
  ANALYSE            PLANIFICATION       SOLUTIONING         IMPLEMENTATION
  ─────────          ──────────────      ────────────        ───────────────

  ┌──────┐           ┌──────┐           ┌──────┐           ┌──────┐
  │PILOTE├──┐        │PILOTE├──┐        │PILOTE├──┐        │PILOTE├──┐
  └──────┘  │        └──────┘  │        └──────┘  │        └──────┘  │
            │                  │                  │                  │
            v                  v                  v                  v
       ┌────────┐        ┌────────┐         ┌─────────┐       ┌─────────┐
       │  JOHN  │        │  JOHN  │         │ WINSTON │       │ WINSTON │
       │  (pm)  │        │  (pm)  │         │ (arch)  │       │  (arch) │
       └────┬───┘        └────────┘         └────┬────┘       └────┬────┘
            │                  │                  │                  │
            v                  v                  │                  ├──> Amelia
       ┌────────┐        ┌────────┐              │                  ├──> Clara
       │  MARY  │        │ SALLY  │              │                  └──> Quinn
       │(analyst│        │ (ux)   │              │
       └────────┘        └────┬───┘              │            ┌─────────┐
                              │                  │            │  OSCAR  │
                              v                  │            │  (ops)  │
                         ┌────────┐              │            └────┬────┘
                         │  LENA  │              │                 │
                         │  (ui)  │              │                 v
                         └────────┘              │            ┌────────┐
                                                 │            │ FELIX  │
                                                 │            │ (dba)  │
                                                 │            └────────┘
  Livrable :             Livrable :          Livrable :       Livrable :
  - Analyse besoin       - PRD final         - Archi tech     - Code
  - Personas             - Wireframes        - Epics Jira     - Tests
  - Contexte marche      - Maquettes UI      - Specs API      - Deploiement
```

### Regles de communication BMAD

```
  REGLES DE COMMUNICATION
  =======================

    ┌──────────────────────────────────────────────────┐
    │                                                  │
    │   Le Pilote parle UNIQUEMENT aux 4 Team Leads    │
    │                                                  │
    │        PILOTE ──> JOHN    OK                     │
    │        PILOTE ──> SALLY   OK                     │
    │        PILOTE ──> WINSTON OK                     │
    │        PILOTE ──> OSCAR   OK                     │
    │                                                  │
    │        PILOTE ──> MARY    INTERDIT               │
    │        PILOTE ──> LENA    INTERDIT               │
    │        PILOTE ──> AMELIA  INTERDIT               │
    │                                                  │
    │   Chaque Lead coordonne ses propres membres      │
    │                                                  │
    │        JOHN ──> MARY      OK (interne)           │
    │        WINSTON ──> AMELIA  OK (interne)           │
    │        WINSTON ──> CLARA   OK (interne)           │
    │        WINSTON ──> QUINN   OK (interne)           │
    │        OSCAR ──> FELIX    OK (interne)           │
    │                                                  │
    │   Les membres ne se parlent JAMAIS entre eux     │
    │   sauf via leur Lead                             │
    │                                                  │
    └──────────────────────────────────────────────────┘
```

---

## 6. Session permanente cross-canal

Un agent primary maintient une **session unique** independante du canal d'acces.

```
                     SESSION PERMANENTE CROSS-CANAL
                     ==============================

   ┌──────────┐     ┌───────────┐     ┌──────────┐
   │   Web    │     │ Telegram  │     │   CLI    │
   │  Chat    │     │   Bot     │     │  REPL    │
   └────┬─────┘     └─────┬─────┘     └────┬─────┘
        │                 │                │
        │  msg #1         │  msg #2        │  msg #3
        │                 │                │
        └─────────────────┼────────────────┘
                          │
                          v
               ┌──────────────────────┐
               │  Session permanente  │
               │  cle : "demo:pilot"  │
               │                      │
               │  Message #1 (web)    │     Meme conversation,
               │  Message #2 (tg)    │     meme historique,
               │  Message #3 (cli)   │     meme memoire
               │  ...                 │
               │                      │
               │  Memoire long terme  │──> Faits, decisions,
               │  (FTS5)             │    preferences, timeline
               │                      │
               │  Auto-compaction     │──> Resume structure quand
               │                      │    le contexte se remplit
               └──────────────────────┘
```

**Mecanisme de memoire** :

Quand la fenetre de contexte se remplit (~80% du max), le systeme :

1. **Extrait** les connaissances cles (faits, decisions, preferences, timeline)
2. Les **stocke** dans des fichiers `memory/*.md` indexes en recherche plein texte
3. **Resume** la conversation en 5 sections structurees
4. **Remplace** l'historique par ce resume
5. L'agent reprend avec un contexte frais mais **ne perd aucune information importante**

---

## 7. Controle d'acces et permissions

Chaque agent a un ensemble de **permissions** qui controle ce qu'il peut faire.

```
                     MODELE DE PERMISSIONS
                     =====================

   ┌───────────────────────────────────────────────────────────┐
   │                                                           │
   │  Agent Pilot (primary, orchestrateur)                     │
   │  ─────────────────────────────────────                    │
   │  Tout autorise sauf .env (demande confirmation)           │
   │  Peut deleguer a tous les agents (task: allow)            │
   │                                                           │
   │  ┌─────────────────────────────────────────────────┐      │
   │  │  Agent explore (subagent, outil)                │      │
   │  │  ─────────────────────────────────              │      │
   │  │  Lecture seule (read, glob, grep)               │      │
   │  │  Ecriture interdite (write, edit: deny)         │      │
   │  │  Execution bash: demande confirmation           │      │
   │  │  Delegation interdite (task: deny)              │      │
   │  └─────────────────────────────────────────────────┘      │
   │                                                           │
   │  ┌─────────────────────────────────────────────────┐      │
   │  │  Agent build (subagent, outil)                  │      │
   │  │  ─────────────────────────────                  │      │
   │  │  Tout autorise (comme Pilot)                    │      │
   │  │  Mais delegation interdite (task: deny)         │      │
   │  └─────────────────────────────────────────────────┘      │
   │                                                           │
   │  ┌─────────────────────────────────────────────────┐      │
   │  │  Agent plan (subagent, outil)                   │      │
   │  │  ──────────────────────────────                 │      │
   │  │  Lecture seule (read, glob, grep)               │      │
   │  │  Ecriture interdite (write, edit: deny)         │      │
   │  │  Delegation interdite (task: deny)              │      │
   │  └─────────────────────────────────────────────────┘      │
   │                                                           │
   └───────────────────────────────────────────────────────────┘

   Regle absolue : un subagent ne peut JAMAIS deleguer,
   quelle que soit sa configuration.
```

---

## 8. Heartbeat — agents autonomes

Un agent primary peut etre configure pour s'executer **periodiquement** sans intervention
utilisateur.

```
                        HEARTBEAT AUTONOME
                        ==================

   ┌──────────────────────────────────────────────┐
   │                                              │
   │  Configuraiton heartbeat :                   │
   │  - Intervalle : 5min a 24h                   │
   │  - Plage horaire active (ex: 9h-18h CET)    │
   │  - Prompt dedie (HEARTBEAT.md ou custom)     │
   │                                              │
   └──────────────────────────────────────────────┘

        Horloge
           │
           │  toutes les N minutes
           │
           v
   ┌───────────────┐                    ┌──────────────────┐
   │  HeartbeatRunner                   │  Agent primary   │
   │               │  prompt heartbeat  │                  │
   │  Verifie :    │──────────────────> │  Execute sa      │
   │  - Plage OK ? │                    │  tache autonome  │
   │  - Instance   │                    │  (veille, check, │
   │    running ?  │                    │   rapport...)    │
   │               │   resultat         │                  │
   │               │<───────────────────│                  │
   │               │                    └──────────────────┘
   │  Si resultat  │
   │  != OK :      │
   │  --> alerte   │
   └───────────────┘

   Cas d'usage :
   - Veille technologique automatique
   - Verification periodique d'un service
   - Generation de rapports reguliers
   - Nettoyage automatise
```

---

## 9. Resume : matrice des interactions

```
                    MATRICE DES INTERACTIONS
                    =======================

   Qui peut parler a qui ?

                          CIBLE
                    ┌─────────┬──────────┬──────────┐
                    │ Primary │ Subagent │ Systeme  │
   ┌────────────────┼─────────┼──────────┼──────────┤
   │  Utilisateur   │   OUI   │   NON    │   NON    │
   │  (canaux)      │         │          │          │
   ├────────────────┼─────────┼──────────┼──────────┤
   │  Primary       │   OUI   │   OUI    │   NON    │
   │  (peer A2A)    │ (A2A)   │ (spawn)  │          │
S  ├────────────────┼─────────┼──────────┼──────────┤
O  │  Subagent      │   NON   │   NON    │   NON    │
U  │                │         │          │          │
R  ├────────────────┼─────────┼──────────┼──────────┤
C  │  Systeme       │   ---   │   ---    │   ---    │
E  │  (auto)        │         │          │          │
   └────────────────┴─────────┴──────────┴──────────┘

   Legende :
   - OUI (A2A)   = delegation peer-to-peer entre primaires
   - OUI (spawn) = creation de session ephemere
   - NON         = interdit par design
   - ---         = agents systeme (compaction, title, summary)
                   declenches automatiquement, pas de delegation
```

---

## 10. Glossaire

| Terme | Definition |
|-------|-----------|
| **Instance** | Un environnement claw-runtime hebergeant un ou plusieurs agents |
| **Agent primary** | Agent principal avec session permanente, visible par l'utilisateur |
| **Agent subagent** | Agent outil ephemere, spawn par un primary pour une tache unique |
| **Spawn** | Action de creer un sous-agent ephemere via l'outil `task` |
| **Delegation A2A** | Delegation de tache entre deux agents primary (peer-to-peer) |
| **Session permanente** | Conversation unique d'un agent primary, partagee entre tous les canaux |
| **Session ephemere** | Conversation jetable d'un sous-agent, detruite apres usage |
| **Compaction** | Mecanisme de resume automatique quand le contexte LLM se remplit |
| **Heartbeat** | Execution periodique autonome d'un agent (sans intervention utilisateur) |
| **Bus d'evenements** | Systeme de communication interne temps reel (25 types d'evenements) |
| **Tool profile** | Ensemble d'outils disponibles pour un agent (minimal/messaging/coding/full) |
| **expertIn** | Competences declarees par un agent, permettant le routage par skill |
| **BMAD** | Business/Marketing/Architecture/Development — pattern d'equipe multi-agents |
| **Workspace** | Repertoire de fichiers d'un agent (identite, instructions, memoire) |
| **runtime.json** | Fichier de configuration central d'une instance |

---

*Mis a jour : 2026-03-19 - Creation (vue fonctionnelle collaboration agents claw-pilot)*
