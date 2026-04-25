-- ============================================
-- SCHEMA SIMPLIFIÉ - Tracking programmation campagnes
-- ============================================
-- Ce script peut être exécuté plusieurs fois sans problème
-- Il crée les tables seulement si elles n'existent pas

-- Table : Tracking de TOUTES les campagnes avec leur statut actuel
CREATE TABLE IF NOT EXISTS campaign_status_tracking (
    campaign_id VARCHAR(50) PRIMARY KEY,
    campaign_name TEXT,
    commercial_name VARCHAR(100), -- Commercial (avant le premier "-")
    csm_name VARCHAR(200), -- CSM (après le "-", peut contenir plusieurs noms séparés par ",")
    trader_name VARCHAR(100),
    
    -- Statut actuel
    current_status VARCHAR(50) NOT NULL, -- 'non_programmable', 'programmable', 'programmed', 'live'
    
    -- Dates importantes
    first_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
    became_non_programmable_at TIMESTAMP, -- Quand détecté comme "Non programmable"
    became_programmable_at TIMESTAMP, -- Quand passé à "Programmable"
    became_programmed_at TIMESTAMP, -- Quand passé à "Programmé"
    campaign_start_date DATE,
    
    -- Calculs
    days_to_become_programmable INT, -- Jours entre "non programmable" et "programmable/programmé"
    days_before_launch INT, -- Jours entre "programmable/programmé" et "lancement"
    
    -- Métadonnées
    metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Table : Historique complet des changements de statut
CREATE TABLE IF NOT EXISTS campaign_status_history (
    id SERIAL PRIMARY KEY,
    campaign_id VARCHAR(50) NOT NULL,
    campaign_name TEXT,
    commercial_name VARCHAR(100),
    csm_name VARCHAR(200),
    trader_name VARCHAR(100),
    
    -- Statut
    old_status VARCHAR(50),
    new_status VARCHAR(50) NOT NULL,
    
    -- Dates
    changed_at TIMESTAMP NOT NULL DEFAULT NOW(),
    campaign_start_date DATE,
    
    -- Métadonnées
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMP DEFAULT NOW()
);

-- Table unique : Suivi des programmations (date où la campagne est devenue programmable)
CREATE TABLE IF NOT EXISTS campaign_programming (
    id SERIAL PRIMARY KEY,
    campaign_id VARCHAR(50) NOT NULL,
    campaign_name TEXT,
    csm_name VARCHAR(100),
    trader_name VARCHAR(100),
    
    -- Dates clés
    became_programmable_at TIMESTAMP, -- Quand la campagne est passée en "Programmable"
    campaign_start_date DATE, -- Date de début de campagne
    days_before_start INT, -- Jours entre "devenu programmable" et "début campagne"
    
    -- Ancienne logique (à garder pour compatibilité)
    programmed_at TIMESTAMP, -- Quand on a détecté que c'était programmé
    
    -- Métadonnées
    metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Contrainte unique pour éviter les doublons
    UNIQUE(campaign_id)
);

-- Ajouter les colonnes manquantes si elles n'existent pas (migration)
DO $$ 
BEGIN
    -- Ajouter became_programmable_at si elle n'existe pas
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'campaign_programming' 
        AND column_name = 'became_programmable_at'
    ) THEN
        ALTER TABLE campaign_programming ADD COLUMN became_programmable_at TIMESTAMP;
    END IF;
    
    -- Ajouter campaign_start_date si elle n'existe pas
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'campaign_programming' 
        AND column_name = 'campaign_start_date'
    ) THEN
        ALTER TABLE campaign_programming ADD COLUMN campaign_start_date DATE;
    END IF;
END $$;

-- Index pour campaign_status_tracking
CREATE INDEX IF NOT EXISTS idx_status_tracking_status ON campaign_status_tracking(current_status);
CREATE INDEX IF NOT EXISTS idx_status_tracking_csm ON campaign_status_tracking(csm_name);
CREATE INDEX IF NOT EXISTS idx_status_tracking_became_programmable ON campaign_status_tracking(became_programmable_at);

-- Index pour campaign_status_history
CREATE INDEX IF NOT EXISTS idx_status_history_campaign ON campaign_status_history(campaign_id);
CREATE INDEX IF NOT EXISTS idx_status_history_status ON campaign_status_history(new_status);
CREATE INDEX IF NOT EXISTS idx_status_history_date ON campaign_status_history(changed_at);

-- Index pour campaign_programming
CREATE INDEX IF NOT EXISTS idx_campaign_programming_csm ON campaign_programming(csm_name);
CREATE INDEX IF NOT EXISTS idx_campaign_programming_trader ON campaign_programming(trader_name);
CREATE INDEX IF NOT EXISTS idx_campaign_programming_date ON campaign_programming(programmed_at);
CREATE INDEX IF NOT EXISTS idx_campaign_programming_became ON campaign_programming(became_programmable_at);
CREATE INDEX IF NOT EXISTS idx_campaign_programming_days ON campaign_programming(days_before_start);

-- Vue pour stats rapides par CSM
CREATE OR REPLACE VIEW v_programming_stats_by_csm AS
SELECT 
    csm_name,
    COUNT(*) as total_programmed,
    COUNT(*) FILTER (WHERE days_before_start = 0) as programmed_j0,
    COUNT(*) FILTER (WHERE days_before_start = 1) as programmed_j1,
    COUNT(*) FILTER (WHERE days_before_start = 2) as programmed_j2,
    COUNT(*) FILTER (WHERE days_before_start >= 3) as programmed_j3_plus,
    COUNT(*) FILTER (WHERE days_before_start < 0) as programmed_late,
    MIN(programmed_at) as first_programming,
    MAX(programmed_at) as last_programming
FROM campaign_programming
WHERE csm_name IS NOT NULL
GROUP BY csm_name
ORDER BY total_programmed DESC;

-- Vue pour stats par période (30 derniers jours)
CREATE OR REPLACE VIEW v_programming_stats_30d AS
SELECT 
    COALESCE(csm_name, trader_name) as csm_name,
    COUNT(*) as total_programmed,
    COUNT(*) FILTER (WHERE days_before_start < 0) as programmed_after_start,
    COUNT(*) FILTER (WHERE days_before_start = 0) as late_j0,
    COUNT(*) FILTER (WHERE days_before_start = 1) as late_j1,
    COUNT(*) FILTER (WHERE days_before_start = 2) as late_j2,
    COUNT(*) FILTER (WHERE days_before_start = 3) as on_time_j3,
    COUNT(*) FILTER (WHERE days_before_start > 3) as on_time_j3_plus,
    MAX(programmed_at) as last_programmed_at
FROM campaign_programming
WHERE programmed_at >= NOW() - INTERVAL '30 days'
  AND (csm_name IS NOT NULL OR trader_name IS NOT NULL)
GROUP BY COALESCE(csm_name, trader_name)
ORDER BY COUNT(*) FILTER (WHERE days_before_start <= 2) DESC;

-- Table pour les commentaires sur les campagnes
CREATE TABLE IF NOT EXISTS campaign_comments (
    id SERIAL PRIMARY KEY,
    campaign_id VARCHAR(50) NOT NULL,
    campaign_name TEXT,
    comment_text TEXT NOT NULL,
    author VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Index pour recherche rapide par campagne
CREATE INDEX IF NOT EXISTS idx_campaign_comments_campaign ON campaign_comments(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_comments_date ON campaign_comments(created_at DESC);

-- Commentaires
COMMENT ON TABLE campaign_programming IS 'Suivi des dates de programmation des campagnes par CSM';
COMMENT ON COLUMN campaign_programming.days_before_start IS 'Nombre de jours avant le début (0=J0, 1=J-1, 2=J-2, négatif=en retard)';
COMMENT ON TABLE campaign_comments IS 'Commentaires sur les campagnes, persistants et associés à l''ID Nova';
