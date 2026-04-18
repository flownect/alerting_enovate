const cron = require('node-cron');
const fetch = require('node-fetch');
const { generateTradersCommerceAlerts, generatePerformanceAlerts } = require('../routes/alerts');

// Logger
function log(message) {
    console.log(`[${new Date().toISOString()}] [SLACK-SCHEDULER] ${message}`);
}

// Fonction pour récupérer les alertes critiques
async function getCriticalAlerts() {
    try {
        // Utiliser l'URL de l'environnement ou localhost
        const baseUrl = process.env.APP_URL || 'http://localhost:3000';
        
        // Récupérer les données Trello
        log('Récupération données Trello...');
        const trelloResponse = await fetch(`${baseUrl}/api/trello/cards`);
        const trelloData = await trelloResponse.json();
        
        // Récupérer les données Campaign Stats
        log('Récupération données Campaign Stats...');
        const statsResponse = await fetch(`${baseUrl}/api/campaign-stats`);
        const statsData = await statsResponse.json();
        
        // Générer les alertes Traders/Commerce
        log('Génération alertes Traders/Commerce...');
        const allTradersCommerceAlerts = await generateTradersCommerceAlerts(trelloData);
        
        // Filtrer les alertes critiques
        const tradersAlerts = allTradersCommerceAlerts.filter(a => 
            a.card?.isProgrammable && a.criticality === 'critical'
        );
        const commerceAlerts = allTradersCommerceAlerts.filter(a => 
            !a.card?.isProgrammable && a.criticality === 'critical'
        );
        
        // Générer les alertes Performance
        log('Génération alertes Performance...');
        const allPerformanceAlerts = await generatePerformanceAlerts(statsData);
        
        // Filtrer les alertes critiques
        const performanceAlerts = allPerformanceAlerts.filter(a => a.level === 'critique');
        
        log(`Alertes critiques: ${performanceAlerts.length} Performance, ${tradersAlerts.length} Traders, ${commerceAlerts.length} Commerce`);
        
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
        
        // Formater les alertes Performance pour Slack
        const formattedPerformance = alerts.performanceAlerts.map(a => {
            const endDate = a.campaign?.vEndDate ? new Date(a.campaign.vEndDate) : null;
            const daysLeft = endDate ? Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24)) : null;
            
            return {
                title: a.campaign?.campaignName || 'Sans nom',
                trader: a.trader || 'N/A',
                commercial: a.commercial || 'N/A',
                startDate: formatDateForSlack(a.campaign?.vStartDate),
                endDate: formatDateForSlack(a.campaign?.vEndDate),
                durationProgress: Math.round(a.durationProgress || 0),
                daysLeft: daysLeft,
                deliveryProgress: Math.round(a.deliveryProgress || 0),
                marginRate: a.marginRate?.toFixed(1),
                reasons: a.reasons || [],
                novaLink: a.campaign?.briefId?.briefCampaignInfo?.[0] 
                    ? `https://dashboard.e-novate.fr/trader/edition-campagne?id=${a.campaign.briefId.briefCampaignInfo[0]}` 
                    : null,
                adxLink: a.campaign?.adxId 
                    ? `https://enovate.hubscale.io/manager/campaigns/view/${a.campaign.adxId}` 
                    : null,
                commentsNova: [],
                commentsDashboard: [],
                commentsPlateforme: []
            };
        });
        
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
            commentsDashboard: []
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
            commentsDashboard: []
        }));
        
        const baseUrl = process.env.APP_URL || 'http://localhost:3000';
        const response = await fetch(`${baseUrl}/api/slack/send-alerts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                performanceAlerts: formattedPerformance,
                tradersAlerts: formattedTraders,
                commerceAlerts: formattedCommerce
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            log(`✅ ${result.message}`);
        } else {
            log(`❌ Erreur: ${result.error}`);
        }
        
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
