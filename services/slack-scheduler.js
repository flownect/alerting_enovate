const cron = require('node-cron');
const fetch = require('node-fetch');
const { generateAlerts, generatePerformanceAlerts } = require('./alert-generator');

// Fonction pour envoyer directement sur Slack
async function sendToSlack(blocks) {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    
    if (!webhookUrl) {
        throw new Error('SLACK_WEBHOOK_URL non configurée');
    }
    
    const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks })
    });
    
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Erreur Slack ${response.status}: ${text}`);
    }
    
    return response;
}

// Variables d'environnement
const NOVA_API_KEY = process.env.NOVA_API_KEY;
const NOVA_PROD_URL = process.env.NOVA_PROD_URL || 'https://dashboard.e-novate.fr';

// Fonction helper pour récupérer les données Trello
async function fetchTrelloData() {
    const url = `${NOVA_PROD_URL}/api/trello?api_key=${NOVA_API_KEY}&cache=1`;
    const response = await fetch(url, { timeout: 120000 });
    
    if (!response.ok) {
        throw new Error(`Trello API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data; // Retourne { lanes: [...] }
}

// Fonction helper pour récupérer les données Campaign Stats
async function fetchCampaignStats() {
    const url = `${NOVA_PROD_URL}/api/campaign-stats/analysis?api_key=${NOVA_API_KEY}`;
    const response = await fetch(url, { timeout: 300000 }); // 5 minutes
    
    if (!response.ok) {
        throw new Error(`Campaign Stats API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data; // Retourne { data: [...] }
}

// Logger
function log(message) {
    console.log(`[${new Date().toISOString()}] [SLACK-SCHEDULER] ${message}`);
}

// Fonction pour récupérer les alertes critiques
async function getCriticalAlerts() {
    try {
        // Appeler l'API centralisée /api/alerts
        log('Récupération des alertes depuis /api/alerts...');
        const response = await fetch('http://localhost:8080/api/alerts?env=prod', { timeout: 300000 });
        
        if (!response.ok) {
            throw new Error(`API alerts error: ${response.status}`);
        }
        
        const alertsData = await response.json();
        
        if (!alertsData.success) {
            throw new Error('API alerts returned success=false');
        }
        
        log(`✅ Alertes récupérées: ${alertsData.data.tradersCommerceAlerts.length} Traders/Commerce, ${alertsData.data.performanceAlerts.length} Performance`);
        
        // Filtrer les alertes critiques
        const tradersAlerts = alertsData.data.tradersCommerceAlerts.filter(a => 
            a.type === 'launch' && a.criticality === 'critical'
        );
        const commerceAlerts = alertsData.data.tradersCommerceAlerts.filter(a => 
            a.type === 'commerce' && a.criticality === 'critical'
        );
        const performanceAlerts = alertsData.data.performanceAlerts.filter(a => a.level === 'critique');
        
        log(`Filtrage: ${performanceAlerts.length} Performance critiques, ${tradersAlerts.length} Traders critiques, ${commerceAlerts.length} Commerce critiques`);
        
        return {
            performanceAlerts,
            tradersAlerts,
            commerceAlerts
        };
        
    } catch (error) {
        log(`Erreur récupération alertes: ${error.message}`);
        throw error;
    }
}

// Formater les dates pour Slack
function formatDateForSlack(dateStr) {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Fonction pour envoyer les alertes sur Slack
async function sendDailyAlerts() {
    try {
        log('Début envoi alertes quotidiennes...');
        
        const alerts = await getCriticalAlerts();
        
        // Utiliser directement les alertes de l'API (déjà formatées)
        const formattedPerformance = alerts.performanceAlerts.map(a => ({
            title: a.campaign?.campaignName || 'Sans nom',
            trader: a.trader || 'N/A',
            commercial: a.commercial || 'N/A',
            startDate: a.startDate,  // Déjà formaté par l'API
            endDate: a.endDate,      // Déjà formaté par l'API
            durationProgress: Math.round(a.durationProgress || 0),
            daysLeft: a.daysLeft,    // Déjà calculé par l'API
            deliveryProgress: Math.round(a.deliveryProgress || 0),
            marginRate: a.marginRate?.toFixed(1),
            reasons: a.reasons || [],
            novaLink: a.novaLink,    // Déjà construit par l'API
            adxLink: a.adxLink,      // Déjà construit par l'API
            commentsNova: a.commentsNova || [],
            commentsDashboard: a.commentsDashboard || [],
            commentsPlateforme: a.commentsPlateforme || []
        }));
        
        // Formater les alertes Traders pour Slack
        const formattedTraders = alerts.tradersAlerts.map(a => ({
            title: a.card?.title || 'Sans nom',
            trader: a.card?.trader || 'N/A',
            commercial: a.card?.commercial || 'N/A',
            startDate: a.card?.dates?.startingDateFormatted,
            endDate: a.card?.dates?.endingDateFormatted,
            timing: a.timing,
            message: a.message,
            novaLink: a.card?.campaignId 
                ? `https://dashboard.e-novate.fr/trader/edition-campagne?id=${a.card.campaignId}` 
                : null,
            adxLink: a.card?.adxCampaignUrl,
            commentsNova: [],
            commentsDashboard: a.commentsDashboard || []
        }));
        
        // Formater les alertes Commerce pour Slack
        const formattedCommerce = alerts.commerceAlerts.map(a => ({
            title: a.card?.title || 'Sans nom',
            trader: a.card?.trader || 'N/A',
            commercial: a.card?.commercial || 'N/A',
            startDate: a.card?.dates?.startingDateFormatted,
            endDate: a.card?.dates?.endingDateFormatted,
            timing: a.timing,
            message: a.message,
            novaLink: a.card?.campaignId 
                ? `https://dashboard.e-novate.fr/trader/edition-campagne?id=${a.card.campaignId}` 
                : null,
            adxLink: a.card?.adxCampaignUrl,
            commentsNova: [],
            commentsDashboard: a.commentsDashboard || []
        }));
        
        const totalCritical = formattedPerformance.length + formattedTraders.length + formattedCommerce.length;
        log(`Envoi vers Slack: ${totalCritical} alertes (${formattedPerformance.length} Performance, ${formattedTraders.length} Traders, ${formattedCommerce.length} Commerce)`);
        
        if (totalCritical === 0) {
            log('✅ Aucune alerte critique à envoyer');
            return;
        }
        
        // Importer la fonction d'envoi Slack depuis routes/slack.js
        const { sendAlertsToSlackWebhook } = require('../routes/slack');
        
        // Utiliser la même fonction que le dashboard
        await sendAlertsToSlackWebhook({
            performanceAlerts: formattedPerformance,
            tradersAlerts: formattedTraders,
            commerceAlerts: formattedCommerce
        });
        
        log(`✅ Alertes envoyées sur Slack avec succès`);
        
    } catch (error) {
        log(`❌ Erreur envoi alertes: ${error.message}`);
    }
}

// Démarrer le scheduler
function startScheduler() {
    // Tous les jours à 8h30
    cron.schedule('30 8 * * *', () => {
        log('🕐 Déclenchement automatique 8h30');
        sendDailyAlerts();
    }, {
        timezone: 'Europe/Paris'
    });
    
    log('✅ Scheduler démarré - Envoi quotidien à 8h30');
}

module.exports = { startScheduler, sendDailyAlerts };
