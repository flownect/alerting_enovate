const cron = require('node-cron');
const fetch = require('node-fetch');

// Logger
function log(message) {
    console.log(`[${new Date().toISOString()}] [SLACK-SCHEDULER] ${message}`);
}

// Fonction pour récupérer les alertes critiques
async function getCriticalAlerts() {
    try {
        // Récupérer les données Trello
        const trelloResponse = await fetch('http://localhost:3000/api/trello/cards');
        const trelloData = await trelloResponse.json();
        
        // Récupérer les données Campaign Stats
        const statsResponse = await fetch('http://localhost:3000/api/campaign-stats');
        const statsData = await statsResponse.json();
        
        // TODO: Implémenter la logique de génération des alertes
        // Pour l'instant, on retourne des données vides
        return {
            performanceAlerts: [],
            tradersAlerts: [],
            commerceAlerts: []
        };
        
    } catch (error) {
        log(`Erreur récupération alertes: ${error.message}`);
        throw error;
    }
}

// Fonction pour envoyer les alertes sur Slack
async function sendDailyAlerts() {
    try {
        log('Début envoi alertes quotidiennes...');
        
        const alerts = await getCriticalAlerts();
        
        const response = await fetch('http://localhost:3000/api/slack/send-alerts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(alerts)
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
