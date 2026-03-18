# Runbook — Deploiement claw-pilot

## Workflow — GitHub Flow

Chaque feature = une branche dedicee. MACMINI-INT sert de serveur d'integration.
Exception : les hotfix (corrections urgentes) peuvent aller directement sur main.

```
feature branch locale
       |
       v
dev + typecheck + build local
       |
       v
VALIDATION CI/CD LOCALE OBLIGATOIRE  <-- voir section ci-dessous
       |
       v
push origin feature/xxx
       |
       v
CI/CD GitHub passe (vert)  <-- verifier avant de continuer
       |
       v
deploiement MACMINI-INT sur la branche feature
       |
       v
tests manuels sur MACMINI-INT
       |
    OK |                    KO
       v                     |
PR GitHub -> merge main      +-- fix -> re-validation locale -> re-push
       |
       v
deploiement VM01 sur main  (retest rapide obligatoire si autres commits sur main)


--- HOTFIX (correction urgente) ---

fix local sur main -> VALIDATION CI/CD LOCALE -> push origin main -> deploiement MACMINI-INT
```

---

## VALIDATION CI/CD LOCALE (obligatoire avant tout push)

**Ces commandes reproduisent exactement ce que fait la CI GitHub.**
Ne pas pusher si l'une d'elles echoue.

```bash
# Depuis claw-pilot/
cd claw-pilot

# 1. Format
pnpm format:check

# 2. Types (CLI + UI)
pnpm typecheck:all

# 3. Lint
pnpm lint:all

# 4. Orthographe
pnpm spellcheck

# 5. Tests avec coverage  <-- LE PLUS IMPORTANT : doit passer sans erreur de threshold
pnpm test:run --coverage

# 6. Dead code
pnpm knip --reporter compact

# 7. Imports circulaires
pnpm check:circular

# 8. Tests E2E (serveur HTTP reel, DB in-memory)
pnpm test:e2e

# 9. Build final (typecheck + build)
pnpm build:safe
```

### Commande tout-en-un (equivalent CI)

```bash
pnpm format:check && pnpm typecheck:all && pnpm lint:all && pnpm spellcheck && pnpm test:run --coverage && pnpm test:e2e && pnpm knip --reporter compact && pnpm check:circular && pnpm build
```

> **Note** : `pnpm build:safe` (typecheck:all + build) est une alternative plus sure que `pnpm build` seul.

Si tout est vert localement, la CI GitHub doit passer.

---

## Pieges CI/CD connus

### Coverage sous le seuil (cause la plus frequente)

**Symptome CI :**
```
ERROR: Coverage for lines (X%) does not meet global threshold (Y%)
Process completed with exit code 1.
```

**Cause :** Du nouveau code a ete ajoute sans tests correspondants, faisant chuter le
pourcentage de couverture sous le seuil defini dans `vitest.config.ts`.

**Detection locale :**
```bash
pnpm test:run --coverage
# Chercher les lignes "ERROR: Coverage for..."
```

**Correction :**
- Option 1 (preferable) : ajouter des tests pour le nouveau code
- Option 2 (acceptable si le code est difficile a tester — I/O, LLM, filesystem) :
  abaisser le seuil dans `vitest.config.ts` avec un commentaire explicatif

```typescript
// vitest.config.ts
thresholds: {
  // Lowered after <commit-ref> (<raison courte>)
  lines: 48,      // <-- ajuster a la valeur reelle - 1
  statements: 48,
  functions: 76,
  branches: 72,
},
```

### Actions GitHub avec version inexistante

**Symptome CI :**
```
Unable to find version `vX.Y`. Unable to resolve action `actions/checkout@vX.Y`
```

**Cause :** Les tags GitHub Actions de type `@vX.Y` n'existent pas — seuls les
tags majeurs (`@v4`) ou patchs exacts (`@v4.2.2`) sont valides.

**Correction :** Epingler sur SHA digest avec commentaire de version :
```yaml
- uses: actions/checkout@<SHA-40-chars> # vX.Y.Z
```

**Prevention :** Dependabot est configure (`.github/dependabot.yml`) pour proposer
automatiquement des mises a jour chaque lundi.

### Actions GitHub avec Node.js 20 deprecie

**Symptome CI :**
```
Node.js 20 actions are deprecated. Actions will be forced to run with Node.js 24...
```

**Cause :** Les actions utilisees sont basees sur node20. GitHub forcera node24
a partir du 2 juin 2026.

**Correction :** Migrer vers les versions majeures suivantes qui embarquent node24 :
- `actions/checkout` : v6+
- `actions/setup-node` : v6+
- `actions/upload-artifact` : v7+

Verifier le runtime d'une action :
```bash
gh api "repos/<owner>/<action>/contents/action.yml?ref=<tag>" --jq '.content' | base64 -d | grep "using:"
```

### Security audit echoue

**Symptome CI :**
```
X vulnerabilities found — high severity
```

**Detection locale :**
```bash
pnpm audit --audit-level=high
```

**Correction :** Mettre a jour le package vulnerabe ou ajouter une exception documentee.

---

## Deploiement sur MACMINI-INT (integration)

### Prerequisites

- Node.js et pnpm installes sur MACMINI-INT
- Service launchd configure : `io.claw-pilot.dashboard`

### Feature branch

```bash
# 1. Pousser la branche depuis local
git push origin feature/ma-feature

# 2. Deployer sur MACMINI-INT
ssh swoelffel@macmini.thiers '
  cd /opt/claw-pilot
  git fetch origin
  git checkout feature/ma-feature
  git pull

  # Build avec PATH complet (nvm)
  export PATH="/Users/swoelffel/.nvm/versions/node/v24.14.0/bin:$PATH"
  pnpm install --frozen-lockfile
  pnpm build

  # REDEMARRER LE DASHBOARD (OBLIGATOIRE apres chaque build)
  launchctl restart io.claw-pilot.dashboard
'

# 3. Verifier
ssh swoelffel@macmini.thiers '
  export PATH="/Users/swoelffel/.nvm/versions/node/v24.14.0/bin:$PATH"
  curl -s http://localhost:19000 | head -5
'
```

### Retour sur main (apres merge PR)

```bash
ssh swoelffel@macmini.thiers '
  cd /opt/claw-pilot
  git checkout main
  git pull

  export PATH="/Users/swoelffel/.nvm/versions/node/v24.14.0/bin:$PATH"
  pnpm install --frozen-lockfile
  pnpm build

  launchctl restart io.claw-pilot.dashboard
'
```

### Acces dashboard integration

```
URL : http://macmini.thiers:19000
SSH : ssh swoelffel@macmini.thiers
```

---

## Pieges de deploiement connus

- **MACMINI-INT : toujours redemarrer le dashboard apres build**
  - Le service launchd ne recharge pas automatiquement le code compile
  - Apres `pnpm build`, faire : `launchctl restart io.claw-pilot.dashboard`
  - Verifier avec : `curl http://localhost:19000 | head -5`

- **MACMINI-INT : PATH nvm obligatoire**
  - En session SSH, exporter : `export PATH="/Users/swoelffel/.nvm/versions/node/v24.14.0/bin:$PATH"`
  - Sans cela, `pnpm` et `npm` ne seront pas trouves

---

## Rollback

En cas de probleme apres deploiement :

### Rollback rapide (MACMINI-INT)

```bash
ssh swoelffel@macmini.thiers '
  cd /opt/claw-pilot
  export PATH="/Users/swoelffel/.nvm/versions/node/v24.14.0/bin:$PATH"

  # Identifier le dernier commit fonctionnel
  git log --oneline -10

  # Rollback vers un commit specifique
  git checkout <commit-hash>
  pnpm install --frozen-lockfile
  pnpm build
  launchctl restart io.claw-pilot.dashboard
'
```

### Rollback branche (retour a main)

```bash
ssh swoelffel@macmini.thiers '
  cd /opt/claw-pilot
  export PATH="/Users/swoelffel/.nvm/versions/node/v24.14.0/bin:$PATH"
  git checkout main
  git pull
  pnpm install --frozen-lockfile
  pnpm build
  launchctl restart io.claw-pilot.dashboard
'
```

**Important** : les migrations DB sont irreversibles (additive-only). Un rollback de code ne rollback PAS le schema DB. Si une migration a ete ajoutee, le code roule doit etre compatible avec le schema plus recent.
