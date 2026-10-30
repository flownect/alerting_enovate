const express = require('express');
const router = express.Router();
const { generateAlerts, generatePerformanceAlerts, generateBenchmarkAlerts } = require('../services/alert-generator');

// GET /api/alerts
// Retourne toutes les alertes (Traders, Commerce, Performance)
router.get('/', async (req, res) => {
    try {
        const env = req.query.env || 'prod';
        
        // Récupérer les données Trello
        const NOVA_API_KEY = process.env.NOVA_API_KEY;
        const NOVA_PROD_URL = process.env.NOVA_PROD_URL || 'https://nova.e-novate.fr';
        
        // fresh=1 = recalcul complet demandé (bouton Slack).
        // Nova refuse souvent cache=0 (401) → on tente cache=0 puis fallback cache=1.
        const wantFresh = req.query.fresh === '1';
        let trelloRawData = null;
        let usedCache = wantFresh ? '0' : '1';

        for (const cache of wantFresh ? ['0', '1'] : ['1']) {
            const trelloUrl = `${NOVA_PROD_URL}/api/trello?api_key=${NOVA_API_KEY}&cache=${cache}`;
            console.log(`[ALERTS-API] Fetch Trello (cache=${cache})${wantFresh ? ' [fresh]' : ''}...`);
            const trelloResponse = await fetch(trelloUrl, { timeout: 120000 });
            if (trelloResponse.ok) {
                trelloRawData = await trelloResponse.json();
                usedCache = cache;
                break;
            }
            console.log(`[ALERTS-API] Trello cache=${cache} → HTTP ${trelloResponse.status}`);
            if (cache === '1') {
                throw new Error(`Trello API error: ${trelloResponse.status}`);
            }
        }

        const trelloData = { data: trelloRawData };
        
        // Campaign Stats : toujours live (clé pour impressions du jour)
        const statsUrl = `${NOVA_PROD_URL}/api/campaign-stats/analysis?api_key=${NOVA_API_KEY}`;
        console.log(`[ALERTS-API] Fetch campaign-stats (Trello cache utilisé=${usedCache})...`);
        const statsResponse = await fetch(statsUrl, { timeout: 300000 });
        
        let statsData = { data: [] };
        if (statsResponse.ok) {
            const rawStatsData = await statsResponse.json();
            statsData = { data: Array.isArray(rawStatsData) ? rawStatsData : [] };
        }
        
        // Générer les alertes Traders/Commerce
        const allTradersCommerceAlerts = generateAlerts(trelloData);
        
        // Générer les alertes Performance
        const performanceAlerts = generatePerformanceAlerts(statsData);
        
        // Générer les alertes Benchmarks
        const benchmarkAlerts = generateBenchmarkAlerts(statsData, trelloData);
        
        // Fusionner Performance + Benchmarks
        const allPerformanceAlerts = [...performanceAlerts, ...benchmarkAlerts];
        
        // Récupérer les commentaires de la base de données
        const { buildCommentsMaps, findComments } = require('../services/comment-matcher');
        let commentsMaps = buildCommentsMaps([]);
        if (process.env.DATABASE_URL) {
            try {
                console.log('[ALERTS-API] Récupération commentaires...');
                const { Pool } = require('pg');
                const pool = new Pool({
                    connectionString: process.env.DATABASE_URL,
                    ssl: { rejectUnauthorized: false },
                    max: 1,
                    connectionTimeoutMillis: 5000
                });
                
                const result = await pool.query(`
                    SELECT campaign_id, campaign_name, comment_text, author, created_at
                    FROM campaign_comments
                    ORDER BY created_at DESC
                `);
                
                console.log(`[ALERTS-API] ${result.rows.length} commentaires trouvés`);
                await pool.end();
                commentsMaps = buildCommentsMaps(result.rows, 'string');
            } catch (error) {
                console.error('[ALERTS-API] Erreur récupération commentaires:', error.message);
            }
        }
        
        // Ajouter les commentaires aux alertes Performance (ID Nova uniquement)
        for (const alert of allPerformanceAlerts) {
            // briefId = ID utilisé lors de l'ajout commentaire côté Performance ; campaignId = autre forme possible
            const novaIds = [
                alert.campaign?.briefId?.briefCampaignInfo?.[0],
                alert.campaign?.campaignId
            ].filter(Boolean);

            alert.commentsDashboard = findComments(commentsMaps, novaIds);
            
            // Commentaires Nova et ADX (de Campaign Stats API)
            const allComments = alert.campaign?.comments || [];
            
            alert.commentsNova = allComments
                .filter(c => c.isAdx && c.content)
                .slice(0, 3)
                .map(c => `${c.content} (${c.author?.name || 'Anonyme'})`);
            
            alert.commentsPlateforme = allComments
                .filter(c => !c.isAdx && c.cardId === null && c.content)
                .slice(0, 3)
                .map(c => `${c.content} (${c.author?.name || 'Anonyme'})`);
        }
        
        // Ajouter les commentaires aux alertes Traders/Commerce
        for (const alert of allTradersCommerceAlerts) {
            // Dashboard = BDD locale (clé = ID Nova)
            alert.commentsDashboard = findComments(commentsMaps, alert.card?.campaignId);

            // Nova = commentaires issus de la carte Trello/Nova (card.comments)
            alert.commentsNova = (alert.card?.comments || [])
                .filter(c => c.content)
                .slice(0, 5)
                .map(c => {
                    const author = c.author?.name || 'Anonyme';
                    const date = c.createdAt
                        ? new Date(c.createdAt).toLocaleDateString('fr-FR')
                        : null;
                    return date
                        ? `[${date}] ${c.content} (${author})`
                        : `${c.content} (${author})`;
                });
        }
        
        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            data: {
                tradersCommerceAlerts: allTradersCommerceAlerts,
                performanceAlerts: allPerformanceAlerts
            }
        });
        
    } catch (error) {
        console.error('Erreur génération alertes:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

module.exports = router;
