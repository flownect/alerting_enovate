# Structure API Campaign Stats Analysis

## Réponse racine

| Champ | Type | Description |
|-------|------|-------------|
| `success` | boolean | Statut de la requête |
| `environment` | string | Environnement (preprod/prod) |
| `timestamp` | string (ISO) | Horodatage de la requête |
| `data` | array | Liste des campagnes |

---

## data[] (Campagnes)

### Identifiants

| Champ | Type | Description |
|-------|------|-------------|
| `briefId` | string | ID MongoDB du brief |
| `campaignId` | string | ID MongoDB de la campagne |
| `adxId` | number | ID ADX (Hubscale) |
| `adxDisplayId` | number | ID d'affichage ADX |
| `cardId` | string | ID composé (campaignId_kpi_secondaryKpi_purchasingMethod_dates) |

### Informations campagne

| Champ | Type | Description |
|-------|------|-------------|
| `campaignName` | string | Nom de la campagne (ex: "Avril_2026_JC DECAUX_NAOLIB") |
| `subdivisionName` | string/null | Nom de la subdivision |
| `vStartDate` | string | Date de début formatée (DD/MM/YYYY) |
| `vEndDate` | string | Date de fin formatée (DD/MM/YYYY) |

### Équipe

| Champ | Type | Description |
|-------|------|-------------|
| `traderName` | string | Nom du trader |
| `commercialName` | string | Nom du commercial |

### Statuts booléens

| Champ | Type | Description |
|-------|------|-------------|
| `flaggedAsImportant` | boolean | Marquée comme prioritaire |
| `isProgrammable` | boolean | Campagne programmable |
| `areSubdivisionsChecked` | boolean | Subdivisions vérifiées |
| `areSubdivisionsLive` | boolean | Subdivisions en cours |
| `areSubdivisionsPigesDone` | boolean | Piges terminées |
| `areSubdivisionsWeeklyReportDone` | boolean | Rapports hebdo terminés |
| `isLive` | boolean | Campagne en cours |
| `isJ0` | boolean | Jour de lancement |
| `isJ3` | boolean | 3ème jour |
| `hasManualCampaignId` | boolean | ID campagne manuel |
| `hasManualObjectiveId` | boolean | ID objectif manuel |

### Configuration rapport hebdo

| Champ | Type | Description |
|-------|------|-------------|
| `hasWeeklyReportData` | boolean | Données rapport hebdo disponibles |
| `weeklyReportDay` | string | Jour du rapport (Lundi, Mardi, etc.) |
| `weeklyReportHour` | number | Heure du rapport (0-23) |
| `weeklyReportPeriodicity` | string | Périodicité (weekly) |
| `isWeeklyReportActive` | boolean | Rapport hebdo actif |

### Autres

| Champ | Type | Description |
|-------|------|-------------|
| `subdivisionBalanceStatus` | string | Statut balance (pending, etc.) |
| `comments` | array | Commentaires |
| `subdivisions` | array | Liste des subdivisions |
| `lineItems` | array | Line items ADX |
| `formats` | array | Formats publicitaires |
| `purchasingMethods` | array | Méthodes d'achat |
| `kpis` | array | KPIs |
| `primaryKpis` | array | KPIs primaires |
| `secondaryKpis` | array | KPIs secondaires |
| `rawKpis` | array | KPIs bruts |

---

## objectives (Objectifs)

Structure des objectifs de campagne avec valeurs jour/mois/global.

| Champ | Type | Description |
|-------|------|-------------|
| `spend` | object | Dépenses |
| `revenue` | object | Revenus |
| `impressions` | object | Impressions |
| `clicks` | object | Clics |
| `conversions` | object | Conversions |
| `evVideoComplete` | object | Vidéos complétées |
| `evUser1` à `evUser5` | object | Événements utilisateur |

### Structure d'un objectif

```json
{
  "day": "87.000000000",
  "month": "0.000000000",
  "overall": "2250.000000000"
}
```

---

## data (Métriques temps réel)

Chaque métrique suit la même structure avec historique.

### Métriques disponibles

**Performance de base :**
- `impressions` - Impressions
- `clicks` - Clics
- `ctr` - Taux de clic
- `conversions` à `conversions7` - Conversions

**Vidéo :**
- `evVideoStart` - Démarrages vidéo
- `evVideoComplete` - Vidéos complétées
- `evVideoUnmute` - Vidéos avec son activé
- `completionRate` - Taux de complétion
- `vcr` - Video Completion Rate

**Événements utilisateur :**
- `evUser4` à `evUser40` - Événements personnalisés
- `evMraid1`, `evMraid2`, `evMraid4`, `evMraid6` - Événements MRAID

**Revenus et coûts :**
- `totalRevenue` - Revenu total
- `totalRevenueAlt` - Revenu alternatif
- `profit` - Profit
- `cpc` - Coût par clic
- `enovCoutParVisite` - Coût par visite E-Novate
- `marginRate` - Taux de marge

**Taux et engagement :**
- `conversionRate` - Taux de conversion
- `sessionsRate` - Taux de sessions
- `lpVisitsRate` - Taux de visites LP
- `bounceRate` - Taux de rebond
- `engagementRate` - Taux d'engagement
- `attentionRate` - Taux d'attention

**Interactions :**
- `creaInteractionTotal` - Interactions créa totales
- `lpInteractionTotal` - Interactions LP totales
- `creaInteractionRate` - Taux d'interaction créa
- `lpInteractionRate` - Taux d'interaction LP

**Qualité :**
- `brandSafetyRate` - Taux brand safety
- `visibilityRate` - Taux de visibilité
- `averagePageViews` - Pages vues moyennes
- `averageTimeSpent` - Temps passé moyen
- `averageAttentionTime` - Temps d'attention moyen

**Footfall :**
- `cpviFootfall` - CPVI Footfall

**Variantes _mr :**
Certaines métriques ont une variante `_mr` (ex: `ctr_mr`, `bounceRate_mr`) pour les données de marge/rapport.

### Structure d'une métrique

```json
{
  "value1": 0,
  "value2": 10952,
  "yesterday": 0,
  "beforeYesterday": 0,
  "history": [
    {
      "date": "2026-04-01",
      "value": 10458
    },
    {
      "date": "2026-04-02",
      "value": 494
    }
  ]
}
```

| Champ | Type | Description |
|-------|------|-------------|
| `value1` | number | Valeur période 1 (aujourd'hui) |
| `value2` | number | Valeur période 2 (cumul) |
| `yesterday` | number | Valeur hier |
| `beforeYesterday` | number | Valeur avant-hier |
| `history` | array | Historique jour par jour |

---

## Exemple de campagne

```json
{
  "campaignId": "69cdfa0213368f05264ec637",
  "adxId": 127431,
  "adxDisplayId": 34808,
  "campaignName": "Avril_2026_JC DECAUX_NAOLIB",
  "traderName": "Mustapha",
  "commercialName": "Sebastien",
  "vStartDate": "01/04/2026",
  "vEndDate": "26/04/2026",
  "isLive": true,
  "isProgrammable": true,
  "flaggedAsImportant": false,
  "weeklyReportDay": "Lundi",
  "weeklyReportHour": 10
}
```

---

## Notes

- **Taille des données** : ~2.5 MB par campagne en moyenne (historique complet)
- **101 campagnes** = ~250 MB de données
- L'historique contient les valeurs jour par jour depuis le début de la campagne
- Les valeurs `∞` (infini) peuvent apparaître pour certains taux (ex: CTR sans impressions)
