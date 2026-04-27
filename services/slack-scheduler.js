const cron = require('node-cron');
const fetch = require('node-fetch');
const { generateAlerts, generatePerformanceAlerts } = require('./alert-generator');
const SibApiV3Sdk = require('@sendinblue/client');

// Fonction pour envoyer directement sur Slack
async function sendToSlack(blocks, webhookUrl = null) {
    const url = webhookUrl || process.env.SLACK_WEBHOOK_URL;
    
    if (!url) {
        throw new Error('SLACK_WEBHOOK_URL non configurée');
    }
    
    const response = await fetch(url, {
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
            marginRate: typeof a.marginRate === 'number' ? a.marginRate.toFixed(1) : a.marginRate,
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

// Fonction pour envoyer les alertes Commerce par email (urgent + critique)
async function sendCommerceAlertsEmail() {
    try {
        log('Début envoi alertes Commerce par email...');
        
        // Récupérer TOUTES les alertes commerce
        const response = await fetch('http://localhost:8080/api/alerts?env=prod', { timeout: 300000 });
        const alertsData = await response.json();
        
        // Filtrer les alertes Commerce urgentes + critiques
        const commerceAlerts = alertsData.data.tradersCommerceAlerts.filter(a => 
            a.type === 'commerce' && (a.criticality === 'urgent' || a.criticality === 'critical')
        );
        
        log(`Alertes Commerce: ${commerceAlerts.length} (urgentes + critiques)`);
        
        if (commerceAlerts.length === 0) {
            log('✅ Aucune alerte Commerce urgente/critique à envoyer');
            return;
        }
        
        // Construire le HTML de l'email
        const alertsHtml = commerceAlerts.map(a => {
            const emoji = a.criticality === 'critical' ? '🔴' : '🟠';
            const criticalityText = a.criticality === 'critical' ? 'CRITIQUE' : 'URGENT';
            const bgColor = a.criticality === 'critical' ? '#fee2e2' : '#fed7aa';
            const textColor = a.criticality === 'critical' ? '#991b1b' : '#9a3412';
            
            return `
                <div style="margin-bottom: 20px; padding: 15px; background-color: ${bgColor}; border-left: 4px solid ${textColor}; border-radius: 4px;">
                    <h3 style="margin: 0 0 10px 0; color: ${textColor};">
                        ${emoji} ${criticalityText} - ${a.card?.title || 'Sans nom'}
                    </h3>
                    <p style="margin: 5px 0; color: #374151;">
                        <strong>👤 Commercial:</strong> ${a.card?.commercial || 'N/A'} | 
                        <strong>Trader:</strong> ${a.card?.trader || 'N/A'}
                    </p>
                    <p style="margin: 5px 0; color: #374151;">
                        <strong>📅 Période:</strong> ${a.card?.dates?.startingDateFormatted} → ${a.card?.dates?.endingDateFormatted}
                    </p>
                    <p style="margin: 5px 0; color: #374151;">
                        <strong>⏰ Alerte:</strong> ${a.message}
                    </p>
                    ${a.card?.campaignId || a.card?.adxCampaignUrl ? `
                        <p style="margin: 10px 0 0 0;">
                            ${a.card?.campaignId ? `<a href="https://dashboard.e-novate.fr/trader/edition-campagne?id=${a.card.campaignId}" style="color: #2563eb; text-decoration: none; margin-right: 15px;">📝 Nova</a>` : ''}
                            ${a.card?.adxCampaignUrl ? `<a href="${a.card.adxCampaignUrl}" style="color: #2563eb; text-decoration: none;">📊 ADX</a>` : ''}
                        </p>
                    ` : ''}
                </div>
            `;
        }).join('');
        
        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <title>Alertes Commerce</title>
            </head>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px;">
                <h1 style="color: #1f2937; border-bottom: 3px solid #2563eb; padding-bottom: 10px;">
                    � Alertes Commerce - ${new Date().toLocaleDateString('fr-FR')}
                </h1>
                <p style="font-size: 16px; color: #6b7280; margin-bottom: 30px;">
                    ${commerceAlerts.length} alerte${commerceAlerts.length > 1 ? 's' : ''} urgente${commerceAlerts.length > 1 ? 's' : ''} / critique${commerceAlerts.length > 1 ? 's' : ''}
                </p>
                ${alertsHtml}
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
                <p style="font-size: 12px; color: #9ca3af; text-align: center;">
                    Alerting E-Novate - Envoi automatique quotidien
                </p>
            </body>
            </html>
        `;
        
        // Configurer Brevo
        const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();
        apiInstance.setApiKey(SibApiV3Sdk.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_SMTP_KEY);
        
        const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
        sendSmtpEmail.sender = { 
            name: 'Alerting E-Novate', 
            email: process.env.BREVO_SENDER_EMAIL || 'alerting@e-novate.fr' 
        };
        sendSmtpEmail.to = (process.env.COMMERCE_EMAIL_RECIPIENTS || '').split(',').map(email => ({ email: email.trim() }));
        sendSmtpEmail.subject = `🚨 ${commerceAlerts.length} Alerte${commerceAlerts.length > 1 ? 's' : ''} Commerce - ${new Date().toLocaleDateString('fr-FR')}`;
        sendSmtpEmail.htmlContent = htmlContent;
        
        await apiInstance.sendTransacEmail(sendSmtpEmail);
        log(`✅ ${commerceAlerts.length} alertes Commerce envoyées par email`);
        
    } catch (error) {
        log(`❌ Erreur envoi alertes Commerce par email: ${error.message}`);
    }
}

// Démarrer le scheduler
function startScheduler() {
    // Tous les jours à 8h30 - Envoi Traders (existant)
    cron.schedule('30 8 * * *', () => {
        log('🕐 Déclenchement automatique 8h30 - Traders');
        sendDailyAlerts();
    }, {
        timezone: 'Europe/Paris'
    });
    
    // Tous les jours à 8h30 - Envoi Commerce par email (nouveau)
    cron.schedule('30 8 * * *', () => {
        log('🕐 Déclenchement automatique 8h30 - Commerce (email)');
        sendCommerceAlertsEmail();
    }, {
        timezone: 'Europe/Paris'
    });
    
    log('✅ Scheduler démarré - Envoi quotidien à 8h30 (Traders Slack + Commerce Email)');
}

module.exports = { startScheduler, sendDailyAlerts, sendCommerceAlertsEmail };
