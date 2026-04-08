# 🚨 Alerting E-Novate

Interface de monitoring et alerting pour les APIs E-Novate (Nova Dashboard).

## 📋 Fonctionnalités

- **Dashboard API** : Interface web pour tester et visualiser les réponses des APIs
- **Trello API** : Récupération des données Trello
- **Campaign Stats** : Analyse des statistiques de campagnes
- **Endpoint personnalisé** : Test de n'importe quel endpoint Nova
- **Switch Preprod/Prod** : Basculement facile entre les environnements

## 🚀 Déploiement Railway

### 1. Créer le projet sur Railway

1. Allez sur [railway.app](https://railway.app)
2. Cliquez sur **"New Project"**
3. Sélectionnez **"Deploy from GitHub repo"**
4. Choisissez le dépôt `flownect/alerting_enovate`

### 2. Configurer les variables d'environnement

Dans Railway, ajoutez ces variables :

| Variable | Description |
|----------|-------------|
| `NOVA_API_KEY` | Clé API pour accéder aux endpoints Nova |
| `NOVA_URL_PREPROD` | URL de la preprod (ex: https://dashboard-preprod.e-novate.fr) |
| `NOVA_URL_PROD` | URL de la prod (ex: https://dashboard.e-novate.fr) |

### 3. Générer le domaine

1. Allez dans **Settings** > **Networking** > **Public Networking**
2. Cliquez sur **"Generate Domain"**

## 💻 Développement Local

```bash
# Cloner le projet
git clone https://github.com/flownect/alerting_enovate.git
cd alerting_enovate

# Installer les dépendances
npm install

# Créer le fichier .env
cp .env.example .env
# Éditer .env avec vos valeurs

# Démarrer le serveur
npm start

# Ou en mode développement (auto-reload)
npm run dev
```

Ouvrez http://localhost:3000

## 📡 Endpoints API

| Endpoint | Description |
|----------|-------------|
| `GET /api/status` | Status du serveur |
| `GET /api/trello?env=preprod` | Données Trello |
| `GET /api/campaign-stats/analysis?env=preprod` | Analyse campagnes |
| `GET /api/proxy/{endpoint}?env=preprod` | Proxy vers n'importe quel endpoint Nova |

## 🔧 Structure du Projet

```
alerting_enovate/
├── server.js           # Serveur Express
├── public/
│   └── index.html      # Interface web
├── package.json        # Dépendances
├── railway.json        # Configuration Railway
├── .env.example        # Template variables d'environnement
└── README.md           # Documentation
```

## 📈 Prochaines étapes

- [ ] Système d'alertes automatiques
- [ ] Notifications email/Slack
- [ ] Historique des appels API
- [ ] Graphiques de monitoring
