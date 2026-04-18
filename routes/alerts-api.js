const express = require('express');
const router = express.Router();
const { generateAlerts, generatePerformanceAlerts } = require('../services/alert-generator');

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
        const allPerformanceAlerts = generatePerformanceAlerts(statsData);
        
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
