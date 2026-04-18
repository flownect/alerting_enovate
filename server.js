require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const ProgrammingTracker = require('./services/programming-tracker');
const { startScheduler } = require('./services/slack-scheduler');

// Timeout pour les requêtes API (120 secondes)
const FETCH_TIMEOUT = 120000;

// Authentification
const DASHBOARD_USER = process.env.DASHBOARD_USER || 'enovate';
const DASHBOARD_PASS = process.env.DASHBOARD_PASS || '@operations2026';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 jours en ms

// Stockage des sessions en mémoire (simple pour ce cas d'usage)
const sessions = new Map();

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

// Générer un token de session
function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Vérifier si une session est valide
function isSessionValid(token) {
    const session = sessions.get(token);
    if (!session) return false;
    if (Date.now() > session.expiresAt) {
        sessions.delete(token);
        return false;
    }
    return true;
}

// Créer une nouvelle session
function createSession() {
    const token = generateSessionToken();
    sessions.set(token, {
        createdAt: Date.now(),
        expiresAt: Date.now() + SESSION_DURATION
    });
    return token;
}

const app = express();
const PORT = process.env.PORT || 3000;

// Routes
const slackRouter = require('./routes/slack');
const { sendDailyAlerts } = require('./services/slack-scheduler');

// Middleware
app.use(cors());
app.use(express.json());
app.use(cookieParser());

// API Routes
app.use('/api/slack', slackRouter);

// Route pour tester manuellement l'envoi des alertes
app.post('/api/test-slack-alerts', sessionAuth, async (req, res) => {
    try {
        log('TEST', 'Envoi manuel des alertes Slack...');
        await sendDailyAlerts();
        res.json({ success: true, message: 'Alertes envoyées avec succès' });
    } catch (error) {
        log('TEST', `Erreur: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Page de login
app.get('/login', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="fr">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta name="robots" content="noindex, nofollow">
            <title>Connexion - Dashboard E-Novate</title>
            <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-gray-100 min-h-screen flex items-center justify-center">
            <div class="bg-white p-8 rounded-xl shadow-lg w-full max-w-md">
                <div class="text-center mb-6">
                    <h1 class="text-2xl font-bold text-gray-900">📊 Dashboard Opérations</h1>
                    <p class="text-gray-500">E-Novate</p>
                </div>
                <form method="POST" action="/login" class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">Identifiant</label>
                        <input type="text" name="username" required 
                            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">Mot de passe</label>
                        <input type="password" name="password" required
                            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                    </div>
                    ${req.query.error ? '<p class="text-red-500 text-sm">Identifiants incorrects</p>' : ''}
                    <button type="submit" 
                        class="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition font-medium">
                        Se connecter
                    </button>
                </form>
                <p class="text-center text-xs text-gray-400 mt-6">Session valide 7 jours</p>
            </div>
        </body>
        </html>
    `);
});

// Traitement du login
app.use(express.urlencoded({ extended: true }));
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    
    if (username === DASHBOARD_USER && password === DASHBOARD_PASS) {
        const token = createSession();
        res.cookie('session', token, {
            httpOnly: true,
            maxAge: SESSION_DURATION,
            sameSite: 'lax'
        });
        log('AUTH', `Connexion réussie pour ${username}`);
        // Redirection relative pour fonctionner sur n'importe quel domaine
        const redirectUrl = req.query.redirect || '/dashboard.html';
        return res.redirect(redirectUrl);
    }
    
    log('AUTH', `Échec de connexion pour ${username}`);
    res.redirect('/login?error=1');
});

// Déconnexion
app.get('/logout', (req, res) => {
    const token = req.cookies.session;
    if (token) {
        sessions.delete(token);
    }
    res.clearCookie('session');
    res.redirect('/login');
});

// Middleware d'authentification par session
function sessionAuth(req, res, next) {
    // Ne pas protéger les routes API, login, logout
    if (req.path.startsWith('/api/') || req.path === '/login' || req.path === '/logout') {
        return next();
    }
    
    const token = req.cookies.session;
    if (token && isSessionValid(token)) {
        return next();
    }
    
    res.redirect('/login');
}

// Appliquer l'auth par session
app.use(sessionAuth);

app.use(express.static(path.join(__dirname, 'public')));

// Configuration API
const NOVA_API_KEY = process.env.NOVA_API_KEY;
const NOVA_URL_PREPROD = process.env.NOVA_URL_PREPROD || 'https://dashboard-preprod.e-novate.fr';
const NOVA_URL_PROD = process.env.NOVA_URL_PROD || 'https://dashboard.e-novate.fr';

// Helper pour obtenir l'URL de base selon l'environnement
function getBaseUrl(env = 'preprod') {
    return env === 'prod' ? NOVA_URL_PROD : NOVA_URL_PREPROD;
}

// Route principale - Dashboard Opérations
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Route API Debug - Ancienne interface
app.get('/api-debug', (req, res) => {
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

// Endpoint pour récupérer les stats de programmation
app.get('/api/programming-stats', async (req, res) => {
    if (!process.env.DATABASE_URL) {
        return res.status(503).json({
            success: false,
            error: 'Database not configured'
        });
    }

    try {
        const period = req.query.period || '30d';
        const tracker = new ProgrammingTracker(process.env.DATABASE_URL);
        const stats = await tracker.getStats(period);
        
        res.json({
            success: true,
            data: stats,
            period,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        log('API', `❌ Erreur stats: ${error.message}`);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== DEBUG PROGRAMMING ====================
// Debug endpoint pour voir les données brutes
app.get('/api/debug/programming', async (req, res) => {
    if (!process.env.DATABASE_URL) {
        return res.json({ success: false, error: 'Database not configured' });
    }

    try {
        const { Client } = require('pg');
        const client = new Client({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });
        
        await client.connect();
        
        // Récupérer toutes les données des 30 derniers jours
        const rawData = await client.query(`
            SELECT campaign_id, campaign_name, csm_name, trader_name, programmed_at, days_before_start
            FROM campaign_programming
            WHERE programmed_at >= NOW() - INTERVAL '30 days'
            ORDER BY programmed_at DESC
            LIMIT 50
        `);
        
        // Récupérer la vue
        const viewData = await client.query('SELECT * FROM v_programming_stats_30d');
        
        await client.end();
        
        res.json({
            success: true,
            rawData: rawData.rows,
            viewData: viewData.rows,
            count: rawData.rows.length
        });
    } catch (error) {
        log('API', `❌ Erreur debug: ${error.message}`);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Vider la table de programmation (reset)
app.post('/api/reset/programming', async (req, res) => {
    if (!process.env.DATABASE_URL) {
        return res.json({ success: false, error: 'Database not configured' });
    }

    try {
        const { Client } = require('pg');
        const client = new Client({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });
        
        await client.connect();
        
        // Compter avant suppression
        const countBefore = await client.query('SELECT COUNT(*) FROM campaign_programming');
        
        // Vider la table
        await client.query('TRUNCATE TABLE campaign_programming');
        
        await client.end();
        
        log('API', `🗑️  Table campaign_programming vidée (${countBefore.rows[0].count} lignes supprimées)`);
        
        res.json({
            success: true,
            message: `Table vidée avec succès`,
            deletedCount: parseInt(countBefore.rows[0].count)
        });
    } catch (error) {
        log('API', `❌ Erreur reset: ${error.message}`);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== BENCHMARK MATCHING ====================
// Analyse des performances avec benchmarks
app.get('/api/performance-analysis', async (req, res) => {
    try {
        log('API', '🔍 Performance analysis requested');
        const performanceAnalyzer = require('./services/performance-analyzer');
        const env = req.query.env || 'preprod';
        const baseUrl = getBaseUrl(env);
        
        // Récupérer les données Trello
        const trelloResponse = await fetch(`${baseUrl}/api/trello/get-all-campaigns-data?env=${env}`);
        const trelloData = await trelloResponse.json();
        
        log('API', `✅ Trello data: ${trelloData?.data?.lanes?.length || 0} lanes`);
        
        // Récupérer les stats de campagne
        const statsResponse = await fetch(`${baseUrl}/api/campaign-stats/get-all-campaigns-stats?env=${env}`);
        const campaignStatsData = await statsResponse.json();
        
        log('API', `✅ Campaign stats: ${campaignStatsData?.data?.length || 0} campaigns`);
        
        if (!trelloData || !trelloData.data || !trelloData.data.lanes) {
            return res.json({ success: false, error: 'No Trello data' });
        }
        
        if (!campaignStatsData || !campaignStatsData.data) {
            return res.json({ success: false, error: 'No campaign stats data' });
        }
        
        // Récupérer toutes les cartes
        const allCards = [];
        for (const lane of trelloData.data.lanes) {
            allCards.push(...(lane.cards || []));
        }
        
        log('API', `📊 Analyzing ${allCards.length} cards`);
        
        // Analyser toutes les campagnes
        const alerts = performanceAnalyzer.analyzeAllCampaigns(allCards, campaignStatsData);
        
        log('API', `✅ Generated ${alerts.length} alerts`);
        
        // Grouper par sévérité
        const grouped = {
            critical: alerts.filter(a => a.severity === 'critical'),
            urgent: alerts.filter(a => a.severity === 'urgent'),
            attention: alerts.filter(a => a.severity === 'attention')
        };
        
        res.json({
            success: true,
            total: alerts.length,
            critical: grouped.critical.length,
            urgent: grouped.urgent.length,
            attention: grouped.attention.length,
            alerts: alerts.slice(0, 50) // Limiter à 50 pour la démo
        });
    } catch (error) {
        log('API', `❌ Erreur performance analysis: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Test du matching des benchmarks
app.get('/api/benchmark-test', async (req, res) => {
    try {
        const benchmarkMatcher = require('./services/benchmark-matcher');
        const trelloData = await getTrelloData();
        
        if (!trelloData || !trelloData.data || !trelloData.data.lanes) {
            return res.json({ success: false, error: 'No Trello data' });
        }
        
        const results = [];
        
        // Parcourir toutes les cartes
        for (const lane of trelloData.data.lanes) {
            for (const card of lane.cards || []) {
                const kpis = benchmarkMatcher.getCardKpis(card);
                
                if (kpis.length > 0) {
                    const cardResult = {
                        title: card.title,
                        trackerId: card.trackerId,
                        kpis: []
                    };
                    
                    for (const kpi of kpis) {
                        const benchmark = benchmarkMatcher.findBenchmark(kpi.name, card);
                        cardResult.kpis.push({
                            name: kpi.name,
                            type: kpi.type,
                            benchmark: benchmark,
                            matched: !!benchmark
                        });
                    }
                    
                    results.push(cardResult);
                }
            }
        }
        
        res.json({
            success: true,
            totalCards: results.length,
            matched: results.filter(r => r.kpis.some(k => k.matched)).length,
            unmatched: results.filter(r => r.kpis.every(k => !k.matched)).length,
            results: results.slice(0, 20) // Limiter à 20 pour la démo
        });
    } catch (error) {
        log('API', `❌ Erreur benchmark test: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== CAMPAIGN COMMENTS ====================
// Récupérer tous les commentaires
app.get('/api/comments', async (req, res) => {
    if (!process.env.DATABASE_URL) {
        return res.json({ success: true, comments: [] });
    }

    try {
        const { Client } = require('pg');
        const client = new Client({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });
        
        await client.connect();
        const result = await client.query(
            'SELECT * FROM campaign_comments ORDER BY created_at DESC'
        );
        await client.end();
        
        // Formater les commentaires pour correspondre au format attendu
        const comments = result.rows.map(row => ({
            _id: row.id,
            content: row.comment_text,
            cardId: row.campaign_id,
            campaignName: row.campaign_name,
            author: { name: row.author || 'Anonyme' },
            createdAt: row.created_at,
            isAdx: false
        }));
        
        res.json({
            success: true,
            comments
        });
    } catch (error) {
        log('API', `❌ Erreur récupération commentaires: ${error.message}`);
        res.json({ success: true, comments: [] });
    }
});

// Récupérer le nombre de commentaires pour toutes les campagnes
app.get('/api/comments-count', async (req, res) => {
    if (!process.env.DATABASE_URL) {
        return res.json({ success: true, data: {} });
    }

    try {
        const { Client } = require('pg');
        const client = new Client({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });
        
        await client.connect();
        const result = await client.query(
            'SELECT campaign_id, COUNT(*) as count FROM campaign_comments GROUP BY campaign_id'
        );
        await client.end();
        
        // Convertir en objet { campaignId: count }
        const counts = {};
        result.rows.forEach(row => {
            counts[row.campaign_id] = parseInt(row.count);
        });
        
        res.json({
            success: true,
            data: counts
        });
    } catch (error) {
        log('API', `❌ Erreur récupération compteurs: ${error.message}`);
        res.json({ success: true, data: {} });
    }
});

// Récupérer les commentaires d'une campagne
app.get('/api/comments/:campaignId', async (req, res) => {
    if (!process.env.DATABASE_URL) {
        return res.status(503).json({
            success: false,
            error: 'Database not configured'
        });
    }

    try {
        const { campaignId } = req.params;
        const { Client } = require('pg');
        const client = new Client({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });
        
        await client.connect();
        const result = await client.query(
            'SELECT * FROM campaign_comments WHERE campaign_id = $1 ORDER BY created_at DESC',
            [campaignId]
        );
        await client.end();
        
        res.json({
            success: true,
            data: result.rows
        });
    } catch (error) {
        log('API', `❌ Erreur récupération commentaires: ${error.message}`);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Ajouter un commentaire
app.post('/api/comments', async (req, res) => {
    if (!process.env.DATABASE_URL) {
        return res.status(503).json({
            success: false,
            error: 'Database not configured'
        });
    }

    try {
        const { campaignId, campaignName, commentText, author } = req.body;
        
        if (!campaignId || !commentText) {
            return res.status(400).json({
                success: false,
                error: 'campaignId and commentText are required'
            });
        }
        
        const { Client } = require('pg');
        const client = new Client({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });
        
        await client.connect();
        const result = await client.query(
            'INSERT INTO campaign_comments (campaign_id, campaign_name, comment_text, author) VALUES ($1, $2, $3, $4) RETURNING *',
            [campaignId, campaignName, commentText, author || 'Anonyme']
        );
        await client.end();
        
        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (error) {
        log('API', `❌ Erreur ajout commentaire: ${error.message}`);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Modifier un commentaire
app.put('/api/comments/:commentId', async (req, res) => {
    if (!process.env.DATABASE_URL) {
        return res.status(503).json({
            success: false,
            error: 'Database not configured'
        });
    }

    try {
        const { commentId } = req.params;
        const { commentText } = req.body;
        
        if (!commentText) {
            return res.status(400).json({
                success: false,
                error: 'commentText is required'
            });
        }
        
        const { Client } = require('pg');
        const client = new Client({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });
        
        await client.connect();
        const result = await client.query(
            'UPDATE campaign_comments SET comment_text = $1 WHERE id = $2 RETURNING *',
            [commentText, commentId]
        );
        await client.end();
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Comment not found'
            });
        }
        
        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (error) {
        log('API', `❌ Erreur modification commentaire: ${error.message}`);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Supprimer un commentaire
app.delete('/api/comments/:commentId', async (req, res) => {
    if (!process.env.DATABASE_URL) {
        return res.status(503).json({
            success: false,
            error: 'Database not configured'
        });
    }

    try {
        const { commentId } = req.params;
        
        const { Client } = require('pg');
        const client = new Client({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });
        
        await client.connect();
        const result = await client.query(
            'DELETE FROM campaign_comments WHERE id = $1 RETURNING *',
            [commentId]
        );
        await client.end();
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Comment not found'
            });
        }
        
        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (error) {
        log('API', `❌ Erreur suppression commentaire: ${error.message}`);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== PROGRAMMING TRACKER ====================
// Tracking automatique 3x par jour: 8h, 14h, 20h
let trelloCache = null;

async function runProgrammingTracking() {
    if (!process.env.DATABASE_URL) {
        log('TRACKING', '⚠️  DATABASE_URL non configurée, tracking désactivé');
        return;
    }

    try {
        log('TRACKING', '🔍 Début du tracking des programmations...');
        
        // Récupérer les données Trello
        if (!trelloCache) {
            log('TRACKING', 'Récupération des données Trello...');
            const url = `${NOVA_URL_PROD}/api/trello?api_key=${NOVA_API_KEY}&cache=1`;
            const trelloResponse = await fetch(url, {
                timeout: FETCH_TIMEOUT
            });
            
            if (!trelloResponse.ok) {
                throw new Error(`HTTP ${trelloResponse.status}: ${trelloResponse.statusText}`);
            }
            
            trelloCache = await trelloResponse.json();
            
            // Log de la structure complète pour debug
            log('TRACKING', `Structure reçue:`, JSON.stringify(Object.keys(trelloCache || {})));
            
            // Adapter la structure selon ce qui est retourné
            let lanes = trelloCache?.data?.lanes || trelloCache?.lanes || [];
            const totalCards = lanes.reduce((sum, lane) => sum + (lane.cards?.length || 0), 0);
            
            log('TRACKING', `✅ ${totalCards} cartes récupérées dans ${lanes.length} lanes`);
        }

        // Lancer le tracking
        const tracker = new ProgrammingTracker(process.env.DATABASE_URL);
        const results = await tracker.trackProgramming(trelloCache);
        
        log('TRACKING', `✅ Tracking terminé: ${results.new} nouvelles programmations détectées (${results.total} total)`);
        
        // Réinitialiser le cache
        trelloCache = null;

    } catch (error) {
        log('TRACKING', '❌ Erreur lors du tracking:', error.message);
    }
}

// Planifier les analyses: 8h, 14h, 20h
function scheduleAnalysis() {
    const now = new Date();
    const hours = now.getHours();
    
    // Heures cibles: 8, 14, 20
    const targetHours = [8, 14, 20];
    let nextHour = targetHours.find(h => h > hours);
    if (!nextHour) nextHour = targetHours[0]; // Lendemain 8h
    
    const nextRun = new Date(now);
    nextRun.setHours(nextHour, 0, 0, 0);
    if (nextHour <= hours) {
        nextRun.setDate(nextRun.getDate() + 1);
    }
    
    const delay = nextRun - now;
    log('TRACKING', `⏰ Prochain tracking programmé à ${nextRun.toLocaleString('fr-FR')}`);
    
    setTimeout(() => {
        runProgrammingTracking();
        scheduleAnalysis(); // Reprogrammer le suivant
    }, delay);
}

// Initialiser la base de données au démarrage
async function initializeDatabase() {
    if (!process.env.DATABASE_URL) {
        log('DB', '⚠️  DATABASE_URL non configurée, initialisation ignorée');
        return;
    }

    const { Client } = require('pg');
    const fs = require('fs');
    
    try {
        log('DB', '🔧 Initialisation de la base de données...');
        const client = new Client({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });
        
        await client.connect();
        
        // Lire et exécuter le script SQL
        const sqlScript = fs.readFileSync(path.join(__dirname, 'database', 'schema-simple.sql'), 'utf8');
        await client.query(sqlScript);
        
        await client.end();
        log('DB', '✅ Base de données initialisée avec succès');
    } catch (error) {
        // Si la table existe déjà, c'est OK
        if (error.message.includes('already exists')) {
            log('DB', '✅ Base de données déjà initialisée');
        } else {
            log('DB', `❌ Erreur lors de l\'initialisation: ${error.message}`);
        }
    }
}

// Démarrage du serveur
app.listen(PORT, async () => {
    console.log(`
╔═══════════════════════════════════════════════════════╗
║         🚨 Alerting E-Novate - Server Started         ║
╠═══════════════════════════════════════════════════════╣
║  Port: ${PORT.toString().padEnd(46)}║
║  Environment: ${(process.env.NODE_ENV || 'development').padEnd(39)}║
║  API Key: ${(NOVA_API_KEY ? '✅ Configured' : '❌ Missing').padEnd(43)}║
║  Preprod URL: ${NOVA_URL_PREPROD.substring(0, 38).padEnd(39)}║
║  Programming: ${(process.env.DATABASE_URL ? '✅ Tracking (3x/day)' : '❌ Disabled').padEnd(37)}║
╚═══════════════════════════════════════════════════════╝
    `);
    
    // Initialiser la base de données
    await initializeDatabase();
    
    // Lancer le tracking immédiatement au démarrage (si DATABASE_URL existe)
    if (process.env.DATABASE_URL) {
        setTimeout(() => runProgrammingTracking(), 5000); // 5s après le démarrage
        scheduleAnalysis(); // Programmer les prochains
    }
    
    // Démarrer le scheduler Slack (si SLACK_WEBHOOK_URL existe)
    if (process.env.SLACK_WEBHOOK_URL) {
        startScheduler();
        log('SLACK', '✅ Scheduler Slack activé - Envoi quotidien à 8h30');
    } else {
        log('SLACK', '⚠️ SLACK_WEBHOOK_URL non configurée - Scheduler désactivé');
    }
});
