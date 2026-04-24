-- ============================================
-- SCHEMA COMPLET - Créer toutes les tables
-- ============================================

-- Table : Tracking de TOUTES les campagnes avec leur statut actuel
CREATE TABLE IF NOT EXISTS campaign_status_tracking (
    campaign_id VARCHAR(50) PRIMARY KEY,
    campaign_name TEXT,
    commercial_name VARCHAR(100),
    csm_name VARCHAR(200),
    trader_name VARCHAR(100),
    
    current_status VARCHAR(50) NOT NULL,
    
    first_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
    became_non_programmable_at TIMESTAMP,
    became_programmable_at TIMESTAMP,
    became_programmed_at TIMESTAMP,
    campaign_start_date DATE,
    
    days_to_become_programmable INT,
    days_before_launch INT,
    
    metadata JSONB DEFAULT '{}',
    
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
    
    old_status VARCHAR(50),
    new_status VARCHAR(50) NOT NULL,
    
    changed_at TIMESTAMP NOT NULL DEFAULT NOW(),
    campaign_start_date DATE,
    
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMP DEFAULT NOW()
);

-- Table : Suivi des programmations
CREATE TABLE IF NOT EXISTS campaign_programming (
    id SERIAL PRIMARY KEY,
    campaign_id VARCHAR(50) NOT NULL,
    campaign_name TEXT,
    csm_name VARCHAR(100),
    trader_name VARCHAR(100),
    
    became_programmable_at TIMESTAMP,
    campaign_start_date DATE,
    days_before_start INT,
    
    programmed_at TIMESTAMP,
    
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(campaign_id)
);

-- Table : Commentaires sur les campagnes
CREATE TABLE IF NOT EXISTS campaign_comments (
    id SERIAL PRIMARY KEY,
    campaign_id VARCHAR(50) NOT NULL,
    campaign_name TEXT,
    comment_text TEXT NOT NULL,
    author VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW()
);

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

-- Index pour campaign_comments
CREATE INDEX IF NOT EXISTS idx_campaign_comments_campaign ON campaign_comments(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_comments_date ON campaign_comments(created_at DESC);

-- Vues
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

-- Vérifier que tout est créé
SELECT 
    'Tables créées avec succès' as status,
    (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'campaign%') as table_count;
