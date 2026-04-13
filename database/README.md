# Base de Données Learnings - Déploiement

## 1️⃣ Créer la base PostgreSQL sur Railway

1. Va sur ton projet Railway : https://railway.app
2. Clique sur **"New"** → **"Database"** → **"Add PostgreSQL"**
3. Railway crée automatiquement la base de données

## 2️⃣ Récupérer DATABASE_URL

1. Clique sur le service PostgreSQL dans Railway
2. Va dans l'onglet **"Variables"**
3. Copie la valeur de **`DATABASE_URL`**

Format : `postgresql://user:password@host:port/database`

## 3️⃣ Ajouter DATABASE_URL à ton service Node.js

1. Clique sur ton service Node.js dans Railway
2. Va dans l'onglet **"Variables"**
3. Ajoute une nouvelle variable :
   - **Nom** : `DATABASE_URL`
   - **Valeur** : colle la connection string PostgreSQL

## 4️⃣ Déployer le schema

### Option A : Depuis ton local (recommandé)

```bash
# Installer pg si pas déjà fait
npm install pg

# Définir DATABASE_URL localement (temporaire)
$env:DATABASE_URL="postgresql://user:password@host:port/database"

# Exécuter le déploiement
node database/deploy.js
```

### Option B : Depuis Railway CLI

```bash
# Installer Railway CLI
npm install -g @railway/cli

# Se connecter
railway login

# Lier au projet
railway link

# Exécuter le déploiement
railway run node database/deploy.js
```

### Option C : Manuellement via psql

```bash
# Connexion
psql $DATABASE_URL

# Exécuter le schema
\i database/schema.sql

# Vérifier
\dt
```

## 5️⃣ Vérifier le déploiement

Le script `deploy.js` affiche :
- ✅ Connexion réussie
- ✅ Schema déployé
- 📊 Liste des tables créées
- 📈 Statistiques initiales

## Tables créées

- ✅ `campaigns_events` - Événements de campagnes
- ✅ `learnings_patterns` - Patterns détectés
- ✅ `learnings_rules` - Règles d'alerte
- ✅ `learnings_insights` - Insights générés
- ✅ `v_learnings_stats` - Vue statistiques

## Prochaines étapes

1. **Intégrer la collecte d'événements** dans `server.js`
2. **Créer un cron job** pour l'analyse quotidienne des patterns
3. **Ajouter l'interface Learnings** dans le dashboard

## Commandes utiles

### Réinitialiser la base (⚠️ DANGER)
```sql
DROP TABLE IF EXISTS learnings_insights CASCADE;
DROP TABLE IF EXISTS learnings_rules CASCADE;
DROP TABLE IF EXISTS learnings_patterns CASCADE;
DROP TABLE IF EXISTS campaigns_events CASCADE;
DROP VIEW IF EXISTS v_learnings_stats CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;
```

### Voir les stats
```sql
SELECT * FROM v_learnings_stats;
```

### Compter les événements par type
```sql
SELECT event_type, event_subtype, COUNT(*) 
FROM campaigns_events 
GROUP BY event_type, event_subtype 
ORDER BY COUNT(*) DESC;
```

### Voir les patterns actifs
```sql
SELECT * FROM learnings_patterns 
WHERE status = 'active' 
ORDER BY occurrence_count DESC;
```
