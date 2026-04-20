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
        const NOVA_PROD_URL = process.env.NOVA_PROD_URL || 'https://dashboard.e-novate.fr';
        
        const trelloUrl = `${NOVA_PROD_URL}/api/trello?api_key=${NOVA_API_KEY}&cache=1`;
        const trelloResponse = await fetch(trelloUrl, { timeout: 120000 });
        
        if (!trelloResponse.ok) {
            throw new Error(`Trello API error: ${trelloResponse.status}`);
        }
        
        const trelloRawData = await trelloResponse.json();
        const trelloData = { data: trelloRawData };
        
        // Récupérer les données Campaign Stats
        const statsUrl = `${NOVA_PROD_URL}/api/campaign-stats/analysis?api_key=${NOVA_API_KEY}`;
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
        let commentsByIdMap = {};
        let commentsByNameMap = {};
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
                
                // Grouper par campaignId ET par campaignName
                for (const row of result.rows) {
                    const comment = `${row.comment_text} (${row.author || 'Anonyme'})`;
                    
                    // Par ID
                    if (row.campaign_id) {
                        if (!commentsByIdMap[row.campaign_id]) {
                            commentsByIdMap[row.campaign_id] = [];
                        }
                        commentsByIdMap[row.campaign_id].push(comment);
                    }
                    
                    // Par nom
                    if (row.campaign_name) {
                        if (!commentsByNameMap[row.campaign_name]) {
                            commentsByNameMap[row.campaign_name] = [];
                        }
                        commentsByNameMap[row.campaign_name].push(comment);
                    }
                }
                
                console.log(`[ALERTS-API] Commentaires groupés: ${Object.keys(commentsByNameMap).length} par nom`);
            } catch (error) {
                console.error('[ALERTS-API] Erreur récupération commentaires:', error.message);
            }
        }
        
        // Ajouter les commentaires aux alertes Performance
        for (const alert of allPerformanceAlerts) {
            const campaignId = alert.campaign?.campaignId;
            const campaignName = alert.campaign?.campaignName;
            
            // Commentaires Dashboard (base locale) - chercher par ID ou par nom
            if (campaignId && commentsByIdMap[campaignId]) {
                alert.commentsDashboard = commentsByIdMap[campaignId];
            } else if (campaignName && commentsByNameMap[campaignName]) {
                alert.commentsDashboard = commentsByNameMap[campaignName];
            }
            
            // Commentaires Nova et ADX (de Campaign Stats API)
            const allComments = alert.campaign?.comments || [];
            
            // Séparer les commentaires par type
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
            const campaignName = alert.card?.title;
            
            // Commentaires Dashboard (base locale) - chercher par nom
            if (campaignName && commentsByNameMap[campaignName]) {
                alert.commentsDashboard = commentsByNameMap[campaignName];
            }
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
