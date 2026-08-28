-- ============================================
-- NETTOYAGE LEGACY — À exécuter UNIQUEMENT quand
-- le nouveau système (campaign_snapshots + campaign_events)
-- est validé en production (quelques semaines de données).
-- ============================================

-- Tables legacy de tracking (remplacées par campaign_snapshots/events)
DROP TABLE IF EXISTS campaign_status_history CASCADE;
DROP TABLE IF EXISTS campaign_status_tracking CASCADE;
DROP TABLE IF EXISTS campaign_programming CASCADE;

-- Vues legacy
DROP VIEW IF EXISTS v_programming_stats_by_csm CASCADE;
DROP VIEW IF EXISTS v_programming_stats_30d CASCADE;

-- Note: campaigns_events (learnings) est conservée si utilisée par learnings-analyzer.
-- Note: campaign_comments et person_emails ne sont PAS touchées.

SELECT 'Tables legacy supprimées. campaign_snapshots et campaign_events conservées.' AS status;
