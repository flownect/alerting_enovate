-- Script pour vider UNIQUEMENT les tables de tracking
-- NE PAS TOUCHER aux commentaires !

-- Vider les tables de tracking
TRUNCATE TABLE campaign_status_tracking CASCADE;
TRUNCATE TABLE campaign_status_history CASCADE;
TRUNCATE TABLE campaign_programming CASCADE;

-- Afficher un message de confirmation
SELECT 'Tables de tracking vidées avec succès. Les commentaires sont préservés.' as status;
