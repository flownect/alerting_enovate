-- ============================================
-- SCHEMA SIMPLIFIÉ - Tracking programmation campagnes
-- ============================================

-- Supprimer les anciennes tables si elles existent
DROP TABLE IF EXISTS learnings_insights CASCADE;
DROP TABLE IF EXISTS learnings_rules CASCADE;
DROP TABLE IF EXISTS learnings_patterns CASCADE;
DROP TABLE IF EXISTS campaigns_events CASCADE;
DROP VIEW IF EXISTS v_learnings_stats CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;

-- Table unique : Suivi des programmations
CREATE TABLE IF NOT EXISTS campaign_programming (
    id SERIAL PRIMARY KEY,
    campaign_id VARCHAR(50) NOT NULL,
    campaign_name TEXT,
    csm_name VARCHAR(100),
    trader_name VARCHAR(100),
    
    -- Dates
    programmed_at TIMESTAMP NOT NULL, -- Quand on a détecté que c'était programmé
    campaign_start_date DATE, -- Date de début de campagne
    days_before_start INT, -- J-X (négatif si après)
    
    -- Métadonnées
    metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    
    -- Contrainte unique pour éviter les doublons
    UNIQUE(campaign_id)
);

-- Index
CREATE INDEX IF NOT EXISTS idx_campaign_programming_csm ON campaign_programming(csm_name);
CREATE INDEX IF NOT EXISTS idx_campaign_programming_trader ON campaign_programming(trader_name);
CREATE INDEX IF NOT EXISTS idx_campaign_programming_date ON campaign_programming(programmed_at);
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
    csm_name,
    COUNT(*) as total_programmed,
    COUNT(*) FILTER (WHERE days_before_start = 0) as programmed_j0,
    COUNT(*) FILTER (WHERE days_before_start = 1) as programmed_j1,
    COUNT(*) FILTER (WHERE days_before_start = 2) as programmed_j2,
    COUNT(*) FILTER (WHERE days_before_start >= 3) as programmed_j3_plus,
    COUNT(*) FILTER (WHERE days_before_start < 0) as programmed_late
FROM campaign_programming
WHERE programmed_at >= NOW() - INTERVAL '30 days'
  AND csm_name IS NOT NULL
GROUP BY csm_name
ORDER BY total_programmed DESC;

-- Commentaires
COMMENT ON TABLE campaign_programming IS 'Suivi des dates de programmation des campagnes par CSM';
COMMENT ON COLUMN campaign_programming.days_before_start IS 'Nombre de jours avant le début (0=J0, 1=J-1, 2=J-2, négatif=en retard)';
