# 17. Mise à jour install.sh — étape auth setup

## Contexte

`install.sh` est le script d'installation de claw-pilot. Il gère deux cas :
1. **Nouvelle installation** : clone le repo, build, init, configure systemd
2. **Mise à jour** : git pull, rebuild, restart service

Cette tâche ajoute l'étape de création du compte admin dans les deux cas, avec une
logique différente :
- Nouvelle install → toujours appeler `auth setup` (afficher le mot de passe)
- Mise à jour → appeler `auth setup` UNIQUEMENT si aucun admin n'existe (`auth check`)

## Fichiers concernés

- `install.sh` — modifier

## Implémentation détaillée

### Localisation dans le script

Le script `install.sh` a une structure conditionnelle :
```bash
if [ -d "$INSTALL_DIR/.git" ]; then
  # Branche UPDATE
else
  # Branche NOUVELLE INSTALLATION
fi
```

### Branche nouvelle installation

Après l'étape `claw-pilot init` (ou équivalent), ajouter :

```bash
# Create admin account
echo ""
log "Creating admin account..."
ADMIN_OUTPUT=$($CLAW_PILOT_CMD auth setup 2>&1)
echo "$ADMIN_OUTPUT"
echo ""
warn "Save the admin password above — you will need it to access the dashboard."
warn "Reset anytime with: claw-pilot auth reset"
```

**Placement** : entre l'étape `init` et l'étape de configuration du service systemd.

### Branche mise à jour

Dans la branche update, après le rebuild et le restart du service, ajouter :

```bash
# Check if admin account exists (migration from pre-auth version)
if ! $CLAW_PILOT_CMD auth check 2>/dev/null; then
  echo ""
  log "No admin account found — creating one..."
  ADMIN_OUTPUT=$($CLAW_PILOT_CMD auth setup 2>&1)
  echo "$ADMIN_OUTPUT"
  echo ""
  warn "Save the admin password above — you will need it to access the dashboard."
fi
```

**Logique** :
- `auth check` retourne exit 0 si admin existe → ne rien faire (ne pas écraser le mdp)
- `auth check` retourne exit 1 si pas d'admin → créer le compte (première migration)
- `2>/dev/null` : supprimer les erreurs éventuelles si la commande n'existe pas encore
  (cas de mise à jour depuis une version très ancienne)

### Fonctions utilitaires

Le script utilise probablement des fonctions `log()` et `warn()`. Vérifier leur existence
et utiliser le même style que le reste du script.

### Validation du script

```bash
# Si shellcheck est disponible :
shellcheck install.sh

# Sinon, vérification manuelle :
bash -n install.sh  # Vérifie la syntaxe sans exécuter
```

## Critères de validation

- [ ] `bash -n install.sh` passe sans erreur de syntaxe
- [ ] `shellcheck install.sh` passe (si shellcheck disponible)
- [ ] Nouvelle installation → `auth setup` est appelé, mot de passe affiché
- [ ] Mise à jour avec admin existant → `auth setup` n'est PAS appelé
- [ ] Mise à jour sans admin (migration) → `auth setup` est appelé
- [ ] Le script reste idempotent (peut être relancé sans effet de bord)

## Dépendances

- Tâche 16 doit être complétée avant (`claw-pilot auth setup` et `auth check` doivent exister)
