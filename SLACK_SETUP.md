# Configuration Slack

## 1. Installation des dépendances

```bash
npm install node-cron
```

## 2. Configuration Railway

Ajouter la variable d'environnement sur Railway :

```
SLACK_WEBHOOK_URL=<votre_webhook_slack>
```

**Note** : Le webhook Slack doit être configuré dans Railway, pas dans le code.

## 3. Fonctionnalités

### Envoi manuel
- Bouton "📤 Envoyer sur Slack" dans le header du dashboard
- Envoie toutes les alertes critiques (Performance + Traders + Commerce)

### Envoi automatique
- Tous les matins à **8h30** (heure de Paris)
- Envoie uniquement les alertes critiques
- Format : Performance → Traders → Commerce

### Contenu des messages
Pour chaque alerte :
- ⭐ Prioritaire (si applicable)
- Nom de la campagne
- Trader / Commercial
- Durée / Volume / Marge
- Alertes détaillées
- 💬 Commentaires récents (3 derniers)
- Liens Nova + ADX

### Totaux affichés
- Total général d'alertes critiques
- Total par section (Performance, Traders, Commerce)

## 4. Test

Pour tester l'envoi manuel :
1. Ouvrir le dashboard
2. Cliquer sur "📤 Envoyer sur Slack"
3. Vérifier le message dans Slack

Pour tester l'envoi automatique :
```bash
# Modifier temporairement l'heure dans slack-scheduler.js
cron.schedule('* * * * *', ...) // Toutes les minutes
```

## 5. Logs

Les logs du scheduler apparaissent dans la console Railway :
```
[SLACK-SCHEDULER] ✅ Scheduler démarré - Envoi quotidien à 8h30
[SLACK-SCHEDULER] 🕐 Déclenchement automatique 8h30
[SLACK-SCHEDULER] ✅ 12 alertes envoyées sur Slack
```
