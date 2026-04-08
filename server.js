require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuration API
const NOVA_API_KEY = process.env.NOVA_API_KEY;
const NOVA_URL_PREPROD = process.env.NOVA_URL_PREPROD || 'https://dashboard-preprod.e-novate.fr';
const NOVA_URL_PROD = process.env.NOVA_URL_PROD || 'https://dashboard.e-novate.fr';

// Helper pour obtenir l'URL de base selon l'environnement
function getBaseUrl(env = 'preprod') {
    return env === 'prod' ? NOVA_URL_PROD : NOVA_URL_PREPROD;
}

// Route principale - Interface web
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API Status
app.get('/api/status', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        apiKeyConfigured: !!NOVA_API_KEY
    });
});

// Proxy pour l'API Trello
app.get('/api/trello', async (req, res) => {
    try {
        const env = req.query.env || 'preprod';
        const cache = req.query.cache || '1';
        const baseUrl = getBaseUrl(env);
        
        const url = `${baseUrl}/api/trello?api_key=${NOVA_API_KEY}&cache=${cache}`;
        console.log(`[Trello] Fetching: ${baseUrl}/api/trello (env: ${env})`);
        
        const response = await fetch(url);
        const data = await response.json();
        
        res.json({
            success: true,
            environment: env,
            timestamp: new Date().toISOString(),
            data: data
        });
    } catch (error) {
        console.error('[Trello] Error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Proxy pour l'API Campaign Stats Analysis
app.get('/api/campaign-stats/analysis', async (req, res) => {
    try {
        const env = req.query.env || 'preprod';
        const baseUrl = getBaseUrl(env);
        
        const url = `${baseUrl}/api/campaign-stats/analysis?api_key=${NOVA_API_KEY}`;
        console.log(`[Campaign Stats] Fetching: ${baseUrl}/api/campaign-stats/analysis (env: ${env})`);
        
        const response = await fetch(url);
        const data = await response.json();
        
        res.json({
            success: true,
            environment: env,
            timestamp: new Date().toISOString(),
            data: data
        });
    } catch (error) {
        console.error('[Campaign Stats] Error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Route générique pour tester n'importe quel endpoint Nova
app.get('/api/proxy/*', async (req, res) => {
    try {
        const env = req.query.env || 'preprod';
        const baseUrl = getBaseUrl(env);
        const endpoint = req.params[0];
        
        // Construire les query params (sans env)
        const queryParams = new URLSearchParams(req.query);
        queryParams.delete('env');
        queryParams.set('api_key', NOVA_API_KEY);
        
        const url = `${baseUrl}/api/${endpoint}?${queryParams.toString()}`;
        console.log(`[Proxy] Fetching: ${url}`);
        
        const response = await fetch(url);
        const contentType = response.headers.get('content-type');
        
        let data;
        if (contentType && contentType.includes('application/json')) {
            data = await response.json();
        } else {
            data = await response.text();
        }
        
        res.json({
            success: true,
            environment: env,
            endpoint: `/api/${endpoint}`,
            timestamp: new Date().toISOString(),
            data: data
        });
    } catch (error) {
        console.error('[Proxy] Error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Démarrage du serveur
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════╗
║         🚨 Alerting E-Novate - Server Started         ║
╠═══════════════════════════════════════════════════════╣
║  Port: ${PORT.toString().padEnd(46)}║
║  Environment: ${(process.env.NODE_ENV || 'development').padEnd(39)}║
║  API Key: ${(NOVA_API_KEY ? '✅ Configured' : '❌ Missing').padEnd(43)}║
║  Preprod URL: ${NOVA_URL_PREPROD.substring(0, 38).padEnd(39)}║
╚═══════════════════════════════════════════════════════╝
    `);
});
