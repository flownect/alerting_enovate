# Architecture Base de Données - Learnings & Intelligence

## Type de BDD recommandé : **PostgreSQL**

### Pourquoi PostgreSQL ?
- **Relationnel** : Structure claire pour les relations entre campagnes, CSM, patterns
- **JSONB** : Stockage flexible pour les métadonnées variables
- **Requêtes complexes** : Agrégations, window functions pour détecter les patterns
- **Performance** : Indexation avancée pour les analyses temporelles
- **Mature** : Écosystème riche (TimescaleDB pour time-series si besoin)

---

## Schéma de tables

### 1. `campaigns_events` (Table principale des événements)
Stocke tous les événements de campagne pour analyse historique.

```sql
CREATE TABLE campaigns_events (
    id SERIAL PRIMARY KEY,
    campaign_id VARCHAR(50) NOT NULL,
    tracker_id VARCHAR(50),
    campaign_name TEXT,
    event_type VARCHAR(50) NOT NULL, -- 'launch', 'status_change', 'alert', 'completion'
    event_subtype VARCHAR(50), -- 'late_launch', 'non_programmable_launch', 'zero_delivery', etc.
    
    -- Contexte
    csm_name VARCHAR(100),
    trader_name VARCHAR(100),
    commercial_name VARCHAR(100),
    
    -- Dates
    event_date TIMESTAMP NOT NULL,
    campaign_start_date DATE,
    campaign_end_date DATE,
    days_offset INT, -- J-3, J0, J+2, etc.
    
    -- Métadonnées flexibles
    metadata JSONB, -- { "isProgrammable": true, "wasLate": true, "format": "Interstitiel", ... }
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    
    -- Index
    INDEX idx_campaign_id (campaign_id),
    INDEX idx_event_type (event_type),
    INDEX idx_event_date (event_date),
    INDEX idx_csm_name (csm_name),
    INDEX idx_metadata (metadata) USING GIN
);
```

### 2. `learnings_patterns` (Patterns détectés automatiquement)
Stocke les patterns identifiés par l'analyse.

```sql
CREATE TABLE learnings_patterns (
    id SERIAL PRIMARY KEY,
    pattern_type VARCHAR(50) NOT NULL, -- 'recurring_late_launch', 'non_programmable_pattern', 'performance_issue'
    
    -- Entités concernées
    csm_name VARCHAR(100),
    trader_name VARCHAR(100),
    campaign_type VARCHAR(100), -- format, device, etc.
    
    -- Statistiques
    occurrence_count INT DEFAULT 1,
    first_occurrence TIMESTAMP,
    last_occurrence TIMESTAMP,
    
    -- Période d'analyse
    analysis_period_start DATE,
    analysis_period_end DATE,
    
    -- Détails
    description TEXT,
    severity VARCHAR(20), -- 'low', 'medium', 'high', 'critical'
    confidence_score FLOAT, -- 0-1, confiance dans le pattern
    
    -- Métadonnées
    metadata JSONB, -- { "avgDelay": 2.5, "affectedCampaigns": [...], "recommendation": "..." }
    
    -- Status
    status VARCHAR(20) DEFAULT 'active', -- 'active', 'resolved', 'ignored'
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Index
    INDEX idx_pattern_type (pattern_type),
    INDEX idx_csm_name (csm_name),
    INDEX idx_status (status),
    INDEX idx_last_occurrence (last_occurrence)
);
```

### 3. `learnings_rules` (Règles d'alerte personnalisées)
Règles créées automatiquement ou manuellement basées sur les learnings.

```sql
CREATE TABLE learnings_rules (
    id SERIAL PRIMARY KEY,
    rule_name VARCHAR(200) NOT NULL,
    rule_type VARCHAR(50), -- 'alert', 'recommendation', 'automation'
    
    -- Conditions (JSON pour flexibilité)
    conditions JSONB NOT NULL, -- { "csm": "John", "eventType": "launch", "isProgrammable": false, ... }
    
    -- Actions
    action_type VARCHAR(50), -- 'send_alert', 'auto_flag', 'suggest_action'
    action_config JSONB, -- { "alertLevel": "warning", "message": "...", ... }
    
    -- Métadonnées
    created_from_pattern_id INT REFERENCES learnings_patterns(id),
    is_active BOOLEAN DEFAULT true,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    INDEX idx_rule_type (rule_type),
    INDEX idx_is_active (is_active)
);
```

### 4. `learnings_insights` (Insights générés)
Insights et recommandations générés par l'analyse.

```sql
CREATE TABLE learnings_insights (
    id SERIAL PRIMARY KEY,
    insight_type VARCHAR(50), -- 'recommendation', 'warning', 'opportunity'
    
    -- Cible
    target_type VARCHAR(50), -- 'csm', 'trader', 'team', 'campaign_type'
    target_value VARCHAR(200),
    
    -- Contenu
    title TEXT NOT NULL,
    description TEXT,
    impact_level VARCHAR(20), -- 'low', 'medium', 'high'
    
    -- Métriques
    affected_campaigns_count INT,
    potential_improvement JSONB, -- { "timeReduction": "2 days", "errorReduction": "30%" }
    
    -- Métadonnées
    metadata JSONB,
    
    -- Status
    status VARCHAR(20) DEFAULT 'new', -- 'new', 'acknowledged', 'applied', 'dismissed'
    acknowledged_by VARCHAR(100),
    acknowledged_at TIMESTAMP,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    
    INDEX idx_insight_type (insight_type),
    INDEX idx_target (target_type, target_value),
    INDEX idx_status (status)
);
```

---

## Exemples de requêtes d'analyse

### Détecter les campagnes non-programmables lancées à J
```sql
SELECT 
    csm_name,
    COUNT(*) as occurrence_count,
    AVG(days_offset) as avg_delay,
    ARRAY_AGG(campaign_name) as affected_campaigns
FROM campaigns_events
WHERE event_type = 'launch'
  AND event_subtype = 'non_programmable_launch'
  AND days_offset <= 0
  AND event_date >= NOW() - INTERVAL '30 days'
GROUP BY csm_name
HAVING COUNT(*) >= 3
ORDER BY occurrence_count DESC;
```

### Identifier les retards récurrents par trader
```sql
SELECT 
    trader_name,
    COUNT(*) as late_count,
    AVG(days_offset) as avg_days_late,
    MAX(days_offset) as max_days_late
FROM campaigns_events
WHERE event_type = 'launch'
  AND event_subtype = 'late_launch'
  AND event_date >= NOW() - INTERVAL '60 days'
GROUP BY trader_name
HAVING COUNT(*) >= 5
ORDER BY late_count DESC;
```

### Patterns de performance par format
```sql
SELECT 
    metadata->>'format' as format,
    metadata->>'device' as device,
    COUNT(*) as alert_count,
    AVG((metadata->>'deliveryProgress')::float) as avg_delivery,
    AVG((metadata->>'marginRate')::float) as avg_margin
FROM campaigns_events
WHERE event_type = 'alert'
  AND event_subtype = 'performance_issue'
  AND event_date >= NOW() - INTERVAL '90 days'
GROUP BY metadata->>'format', metadata->>'device'
HAVING COUNT(*) >= 10
ORDER BY alert_count DESC;
```

---

## Flux de données

### 1. Collecte (Backend Node.js)
```javascript
// À chaque événement détecté dans le dashboard
async function logCampaignEvent(eventData) {
    await db.query(`
        INSERT INTO campaigns_events 
        (campaign_id, event_type, event_subtype, csm_name, trader_name, 
         event_date, days_offset, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
        eventData.campaignId,
        eventData.eventType,
        eventData.eventSubtype,
        eventData.csmName,
        eventData.traderName,
        eventData.eventDate,
        eventData.daysOffset,
        JSON.stringify(eventData.metadata)
    ]);
}
```

### 2. Analyse (Cron job quotidien)
```javascript
// Détecter les patterns tous les jours à 6h
async function detectPatterns() {
    // 1. Analyser les 30 derniers jours
    // 2. Identifier les récurrences (seuil: 3+ occurrences)
    // 3. Créer/mettre à jour learnings_patterns
    // 4. Générer learnings_insights
    // 5. Créer learnings_rules si pertinent
}
```

### 3. Affichage (Dashboard)
- Onglet "Learnings" dans le menu settings
- Vue par CSM/Trader avec patterns détectés
- Recommandations actionnables
- Historique des insights

---

## Alternative : MongoDB (si préférence NoSQL)

Si tu préfères du NoSQL :

```javascript
// Collection: campaign_events
{
    _id: ObjectId,
    campaignId: String,
    eventType: String,
    eventSubtype: String,
    csmName: String,
    traderName: String,
    eventDate: ISODate,
    daysOffset: Number,
    metadata: Object, // Flexible
    createdAt: ISODate
}

// Collection: learnings_patterns
{
    _id: ObjectId,
    patternType: String,
    csmName: String,
    occurrenceCount: Number,
    firstOccurrence: ISODate,
    lastOccurrence: ISODate,
    description: String,
    severity: String,
    metadata: Object,
    status: String
}
```

**Avantage** : Plus simple à setup, flexible
**Inconvénient** : Requêtes d'agrégation complexes moins performantes

---

## Recommandation finale

**PostgreSQL** pour :
- Requêtes analytiques complexes
- Relations claires entre entités
- Performance sur les agrégations temporelles
- Intégrité des données

**Hébergement** : 
- **Supabase** (PostgreSQL managé, gratuit jusqu'à 500MB)
- **Railway** (PostgreSQL + Node.js, facile à déployer)
- **Render** (PostgreSQL gratuit)
