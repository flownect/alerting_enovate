require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

// Timeout pour les requêtes API (120 secondes)
const FETCH_TIMEOUT = 120000;

// Logger avec timestamp
function log(tag, message, data = null) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${tag}]`;
    if (data) {
        console.log(`${prefix} ${message}`, data);
    } else {
        console.log(`${prefix} ${message}`);
    }
}

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
        log('Trello', `→ Requête démarrée (env: ${env})`);
        log('Trello', `  URL: ${baseUrl}/api/trello`);
        
        const startTime = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => {
            log('Trello', `⚠️ Timeout après ${FETCH_TIMEOUT/1000}s`);
            controller.abort();
        }, FETCH_TIMEOUT);
        
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        const duration = Date.now() - startTime;
        log('Trello', `← Réponse reçue (status: ${response.status}, durée: ${duration}ms)`);
        
        const data = await response.json();
        const cardsCount = data?.lanes?.reduce((acc, lane) => acc + (lane.cards?.length || 0), 0) || 0;
        log('Trello', `✅ Succès - ${cardsCount} cartes récupérées`);
        
        res.json({
            success: true,
            environment: env,
            timestamp: new Date().toISOString(),
            data: data
        });
    } catch (error) {
        log('Trello', `❌ Erreur: ${error.message}`);
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
        log('Campaign Stats', `→ Requête démarrée (env: ${env})`);
        log('Campaign Stats', `  URL: ${baseUrl}/api/campaign-stats/analysis`);
        
        const startTime = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => {
            log('Campaign Stats', `⚠️ Timeout après ${FETCH_TIMEOUT/1000}s`);
            controller.abort();
        }, FETCH_TIMEOUT);
        
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        const duration = Date.now() - startTime;
        log('Campaign Stats', `← Réponse reçue (status: ${response.status}, durée: ${duration}ms)`);
        
        const data = await response.json();
        const itemsCount = Array.isArray(data) ? data.length : (data?.length || 'N/A');
        log('Campaign Stats', `✅ Succès - ${itemsCount} éléments récupérés`);
        
        res.json({
            success: true,
            environment: env,
            timestamp: new Date().toISOString(),
            data: data
        });
    } catch (error) {
        log('Campaign Stats', `❌ Erreur: ${error.message}`);
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
        log('Proxy', `→ Requête démarrée (env: ${env})`);
        log('Proxy', `  Endpoint: /api/${endpoint}`);
        
        const startTime = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => {
            log('Proxy', `⚠️ Timeout après ${FETCH_TIMEOUT/1000}s`);
            controller.abort();
        }, FETCH_TIMEOUT);
        
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        const duration = Date.now() - startTime;
        log('Proxy', `← Réponse reçue (status: ${response.status}, durée: ${duration}ms)`);
        
        const contentType = response.headers.get('content-type');
        
        let data;
        if (contentType && contentType.includes('application/json')) {
            data = await response.json();
        } else {
            data = await response.text();
        }
        log('Proxy', `✅ Succès`);
        
        res.json({
            success: true,
            environment: env,
            endpoint: `/api/${endpoint}`,
            timestamp: new Date().toISOString(),
            data: data
        });
    } catch (error) {
        log('Proxy', `❌ Erreur: ${error.message}`);
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
