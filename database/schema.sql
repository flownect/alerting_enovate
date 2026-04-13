-- ============================================
-- LEARNINGS DATABASE SCHEMA
-- PostgreSQL 14+
-- ============================================

-- Table 1: Événements de campagnes
CREATE TABLE IF NOT EXISTS campaigns_events (
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
    metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW()
);

-- Index pour campaigns_events
CREATE INDEX IF NOT EXISTS idx_campaigns_events_campaign_id ON campaigns_events(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_events_event_type ON campaigns_events(event_type);
CREATE INDEX IF NOT EXISTS idx_campaigns_events_event_date ON campaigns_events(event_date);
CREATE INDEX IF NOT EXISTS idx_campaigns_events_csm_name ON campaigns_events(csm_name);
CREATE INDEX IF NOT EXISTS idx_campaigns_events_trader_name ON campaigns_events(trader_name);
CREATE INDEX IF NOT EXISTS idx_campaigns_events_metadata ON campaigns_events USING GIN(metadata);

-- Table 2: Patterns détectés
CREATE TABLE IF NOT EXISTS learnings_patterns (
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
    severity VARCHAR(20) DEFAULT 'medium', -- 'low', 'medium', 'high', 'critical'
    confidence_score FLOAT DEFAULT 0.5, -- 0-1
    
    -- Métadonnées
    metadata JSONB DEFAULT '{}',
    
    -- Status
    status VARCHAR(20) DEFAULT 'active', -- 'active', 'resolved', 'ignored'
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Index pour learnings_patterns
CREATE INDEX IF NOT EXISTS idx_learnings_patterns_pattern_type ON learnings_patterns(pattern_type);
CREATE INDEX IF NOT EXISTS idx_learnings_patterns_csm_name ON learnings_patterns(csm_name);
CREATE INDEX IF NOT EXISTS idx_learnings_patterns_trader_name ON learnings_patterns(trader_name);
CREATE INDEX IF NOT EXISTS idx_learnings_patterns_status ON learnings_patterns(status);
CREATE INDEX IF NOT EXISTS idx_learnings_patterns_last_occurrence ON learnings_patterns(last_occurrence);

-- Table 3: Règles d'alerte personnalisées
CREATE TABLE IF NOT EXISTS learnings_rules (
    id SERIAL PRIMARY KEY,
    rule_name VARCHAR(200) NOT NULL,
    rule_type VARCHAR(50), -- 'alert', 'recommendation', 'automation'
    
    -- Conditions (JSON pour flexibilité)
    conditions JSONB NOT NULL DEFAULT '{}',
    
    -- Actions
    action_type VARCHAR(50), -- 'send_alert', 'auto_flag', 'suggest_action'
    action_config JSONB DEFAULT '{}',
    
    -- Métadonnées
    created_from_pattern_id INT REFERENCES learnings_patterns(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT true,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Index pour learnings_rules
CREATE INDEX IF NOT EXISTS idx_learnings_rules_rule_type ON learnings_rules(rule_type);
CREATE INDEX IF NOT EXISTS idx_learnings_rules_is_active ON learnings_rules(is_active);
CREATE INDEX IF NOT EXISTS idx_learnings_rules_pattern_id ON learnings_rules(created_from_pattern_id);

-- Table 4: Insights générés
CREATE TABLE IF NOT EXISTS learnings_insights (
    id SERIAL PRIMARY KEY,
    insight_type VARCHAR(50), -- 'recommendation', 'warning', 'opportunity'
    
    -- Cible
    target_type VARCHAR(50), -- 'csm', 'trader', 'team', 'campaign_type'
    target_value VARCHAR(200),
    
    -- Contenu
    title TEXT NOT NULL,
    description TEXT,
    impact_level VARCHAR(20) DEFAULT 'medium', -- 'low', 'medium', 'high'
    
    -- Métriques
    affected_campaigns_count INT DEFAULT 0,
    potential_improvement JSONB DEFAULT '{}',
    
    -- Métadonnées
    metadata JSONB DEFAULT '{}',
    
    -- Status
    status VARCHAR(20) DEFAULT 'new', -- 'new', 'acknowledged', 'applied', 'dismissed'
    acknowledged_by VARCHAR(100),
    acknowledged_at TIMESTAMP,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW()
);

-- Index pour learnings_insights
CREATE INDEX IF NOT EXISTS idx_learnings_insights_insight_type ON learnings_insights(insight_type);
CREATE INDEX IF NOT EXISTS idx_learnings_insights_target ON learnings_insights(target_type, target_value);
CREATE INDEX IF NOT EXISTS idx_learnings_insights_status ON learnings_insights(status);
CREATE INDEX IF NOT EXISTS idx_learnings_insights_created_at ON learnings_insights(created_at);

-- Fonction pour mettre à jour updated_at automatiquement
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers pour updated_at
CREATE TRIGGER update_learnings_patterns_updated_at BEFORE UPDATE ON learnings_patterns
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_learnings_rules_updated_at BEFORE UPDATE ON learnings_rules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Vue pour statistiques rapides
CREATE OR REPLACE VIEW v_learnings_stats AS
SELECT 
    'events' as table_name,
    COUNT(*) as total_count,
    COUNT(DISTINCT campaign_id) as unique_campaigns,
    COUNT(DISTINCT csm_name) as unique_csms,
    MAX(event_date) as last_event_date
FROM campaigns_events
UNION ALL
SELECT 
    'patterns' as table_name,
    COUNT(*) as total_count,
    COUNT(*) FILTER (WHERE status = 'active') as unique_campaigns,
    COUNT(DISTINCT csm_name) as unique_csms,
    MAX(last_occurrence) as last_event_date
FROM learnings_patterns
UNION ALL
SELECT 
    'insights' as table_name,
    COUNT(*) as total_count,
    COUNT(*) FILTER (WHERE status = 'new') as unique_campaigns,
    COUNT(DISTINCT target_value) as unique_csms,
    MAX(created_at) as last_event_date
FROM learnings_insights;

-- Commentaires pour documentation
COMMENT ON TABLE campaigns_events IS 'Historique de tous les événements de campagnes pour analyse';
COMMENT ON TABLE learnings_patterns IS 'Patterns et récurrences détectés automatiquement';
COMMENT ON TABLE learnings_rules IS 'Règles d''alerte personnalisées basées sur les learnings';
COMMENT ON TABLE learnings_insights IS 'Insights et recommandations générés par l''analyse';
