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
        let commentsMap = {};
        if (process.env.DATABASE_URL) {
            try {
                const { Client } = require('pg');
                const client = new Client({
                    connectionString: process.env.DATABASE_URL,
                    ssl: { rejectUnauthorized: false }
                });
                await client.connect();
                
                const result = await client.query(`
                    SELECT campaign_id, campaign_name, text, author, created_at
                    FROM comments
                    ORDER BY created_at DESC
                `);
                
                await client.end();
                
                // Grouper par campaignId
                for (const row of result.rows) {
                    if (!commentsMap[row.campaign_id]) {
                        commentsMap[row.campaign_id] = [];
                    }
                    commentsMap[row.campaign_id].push(`${row.text} (${row.author})`);
                }
            } catch (error) {
                console.error('Erreur récupération commentaires:', error);
            }
        }
        
        // Ajouter les commentaires aux alertes Performance
        for (const alert of allPerformanceAlerts) {
            const campaignId = alert.campaign?.campaignId;
            if (campaignId && commentsMap[campaignId]) {
                alert.commentsDashboard = commentsMap[campaignId];
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
