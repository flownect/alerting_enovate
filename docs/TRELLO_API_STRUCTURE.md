# Structure API Trello

## Réponse racine

| Champ | Type | Description |
|-------|------|-------------|
| `success` | boolean | Statut de la requête |
| `environment` | string | Environnement (preprod/prod) |
| `timestamp` | string (ISO) | Horodatage de la requête |
| `data` | object | Données du tableau Trello |

## data

| Champ | Type | Description |
|-------|------|-------------|
| `createdAt` | number (timestamp) | Date de création du tableau |
| `lanes` | array | Liste des colonnes (lanes) du tableau |

## lanes[] (Colonnes)

| Champ | Type | Description |
|-------|------|-------------|
| `cards` | array | Liste des cartes dans la colonne |

## cards[] (Cartes = Campagnes)

### Informations principales

| Champ | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | Identifiant unique de la carte |
| `cardId` | string | ID composé (campaignId_kpi_secondaryKpi_purchasingMethod_dates) |
| `title` | string | Titre de la campagne `[trackerId] Mois_Année_Agence_Nom` |
| `description` | string | Description (Commercial - AM / Trader + infos) |
| `label` | string | Labels des subdivisions |
| `laneId` | string | ID de la colonne (lane1, lane2, etc.) |

### Identifiants

| Champ | Type | Description |
|-------|------|-------------|
| `trackerId` | string | Numéro de tracking (ex: "34115") |
| `briefId` | string | ID MongoDB du brief |
| `campaignId` | string | ID MongoDB de la campagne |

### Équipe

| Champ | Type | Description |
|-------|------|-------------|
| `commercial` | string | Nom du commercial |
| `accountManager` | string | Nom de l'Account Manager |
| `trader` | string | Nom du trader (ou "Aucun") |

### Dates

| Champ | Type | Description |
|-------|------|-------------|
| `dates.startingDateMoment` | number (timestamp) | Date de début (ms) |
| `dates.endingDateMoment` | number (timestamp) | Date de fin (ms) |
| `dates.startingDateFormatted` | string | Date de début formatée (DD/MM/YYYY) |
| `dates.endingDateFormatted` | string | Date de fin formatée (DD/MM/YYYY) |

### Style visuel

| Champ | Type | Description |
|-------|------|-------------|
| `style.borderRadius` | number | Rayon de bordure |
| `style.borderBottom` | number | Bordure basse |
| `style.borderLeft` | string | Bordure gauche (couleur) |
| `style.backgroundColor` | string | Couleur de fond (rgba) |
| `style.borderColor` | string | Couleur de bordure (hex) |

### Tags

| Champ | Type | Description |
|-------|------|-------------|
| `tags` | array | Liste des tags |
| `tags[].bgcolor` | string | Couleur de fond du tag (hex) |
| `tags[].color` | string | Couleur du texte |
| `tags[].title` | string | Titre du tag |

**Tags possibles :**
- `Non programmable` (rouge #FF0000)
- `Programmable` (orange #ff8c00)
- `Programmé` (vert #228B22)
- `Prioritaire` (jaune #ffcf00)

### Statuts booléens

| Champ | Type | Description |
|-------|------|-------------|
| `isProgrammable` | boolean | Campagne programmable |
| `flaggedAsImportant` | boolean | Marquée comme prioritaire |
| `isWeeklyReportActive` | boolean | Rapport hebdo actif |
| `areSubdivisionsProgrammed` | boolean | Toutes subdivisions programmées |
| `areSubdivisionsUnlaunched` | boolean | Subdivisions non lancées |
| `areSubdivisionsChecked` | boolean | Subdivisions vérifiées |
| `areSubdivisionsLive` | boolean | Subdivisions en cours |
| `areSubdivisionsPigesDone` | boolean | Piges terminées |
| `areSubdivisionsWeeklyReportDone` | boolean | Rapports hebdo terminés |

### Configuration rapport hebdo

| Champ | Type | Description |
|-------|------|-------------|
| `weeklyReportDay` | string | Jour du rapport (Lundi, Mardi, etc.) |
| `weeklyReportDays` | array | Liste des jours |
| `weeklyReportHour` | number | Heure du rapport (0-23) |
| `weeklyReportPeriodicity` | string | Périodicité (weekly, etc.) |
| `weeklyReportSpecificDates` | array | Dates spécifiques |

### Autres

| Champ | Type | Description |
|-------|------|-------------|
| `adxCampaignUrl` | string | URL de la campagne Hubscale |
| `subdivisionBalanceStatus` | string | Statut balance (pending, etc.) |
| `comments` | array | Commentaires |

## subdivisions[] (Sous-campagnes)

| Champ | Type | Description |
|-------|------|-------------|
| `_id` | string | ID MongoDB |
| `name` | string | Nom de la subdivision |
| `startingDate` | string (ISO) | Date de début |
| `endingDate` | string (ISO) | Date de fin |
| `purchasingMethod` | string | Méthode d'achat (CPC, CPM, CPVV) |
| `kpi` | string | KPI principal |
| `secondaryKpi` | string/null | KPI secondaire |
| `balanceStatus` | string | Statut balance (pending) |

### Statuts subdivision

| Champ | Type | Description |
|-------|------|-------------|
| `isProgrammed` | boolean | Programmée |
| `isLive` | boolean | En cours |
| `isPigeDone` | boolean | Pige terminée |
| `isUnlaunched` | boolean | Non lancée |
| `isWeeklyReportActive` | boolean | Rapport hebdo actif |
| `isWeeklyReportDone` | boolean | Rapport hebdo terminé |

### Rapport hebdo subdivision

| Champ | Type | Description |
|-------|------|-------------|
| `weeklyReportDay` | string | Jour du rapport |
| `weeklyReportHour` | number | Heure |
| `weeklyReportPeriodicity` | string | Périodicité |
| `weeklyReportSpecificDates` | string | Dates spécifiques |
| `lastWeeklyReportDate` | string (ISO) | Dernière date de rapport |
| `checkedInDashboard` | string (ISO) | Dernière vérification dashboard |

---

## Valeurs KPI possibles

- CTR
- Taux de session
- Taux de session conditionné
- Taux de Rebond/Temps passé
- Taux de Rebond/Temps passé Conditionné
- Reach
- Visibilité
- Complétion vidéo
- Visites en Magasin / Taux de Visite LP
- Taux de visite LP

## Méthodes d'achat (purchasingMethod)

- CPC (Coût Par Clic)
- CPM (Coût Pour Mille)
- CPVV (Coût Par Vue Vidéo)

## Couleurs des statuts

| Statut | Couleur | Hex |
|--------|---------|-----|
| Non programmable | Rouge | #FF0000 |
| Programmable | Orange | #ff8c00 |
| Programmé | Vert | #228B22 |
| Prioritaire | Jaune | #ffcf00 |
