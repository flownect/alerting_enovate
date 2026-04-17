const express = require('express');
const router = express.Router();

// Fonction pour envoyer un message sur Slack
async function sendSlackMessage(blocks) {
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
        throw new Error(`Erreur Slack: ${response.statusText}`);
    }
    
    return response;
}

// Formater une alerte pour Slack (données déjà nettoyées côté client)
function formatAlertForSlack(alert) {
    const title = alert.title || 'Sans nom';
    const trader = alert.trader || 'N/A';
    const commercial = alert.commercial || 'N/A';
    
    // Infos campagne
    let details = `*Trader:* ${trader}\n*Commercial:* ${commercial}\n`;
    
    if (alert.durationProgress !== undefined) {
        details += `*Durée:* ${alert.durationProgress}%\n`;
    }
    
    if (alert.deliveryProgress !== undefined) {
        details += `*Volume:* ${alert.deliveryProgress}%\n`;
    }
    
    if (alert.marginRate) {
        details += `*Marge:* ${alert.marginRate}%\n`;
    }
    
    if (alert.timing) {
        details += `*Timing:* ${alert.timing}\n`;
    }
    
    // Alertes
    let alertsText = '';
    if (alert.reasons && alert.reasons.length > 0) {
        alertsText = alert.reasons.map(r => `• ${r}`).join('\n');
    } else if (alert.message) {
        alertsText = `• ${alert.message}`;
    }
    
    // Commentaires
    let commentsText = '';
    if (alert.comments && alert.comments.length > 0) {
        commentsText = '\n*💬 Commentaires récents:*\n' + 
            alert.comments.map(c => `• ${c}`).join('\n');
    }
    
    // Liens
    let linksText = '';
    if (alert.novaLink || alert.adxLink) {
        linksText = '\n';
        if (alert.novaLink) linksText += `<${alert.novaLink}|Nova>`;
        if (alert.novaLink && alert.adxLink) linksText += ' | ';
        if (alert.adxLink) linksText += `<${alert.adxLink}|ADX>`;
    }
    
    return {
        type: 'section',
        text: {
            type: 'mrkdwn',
            text: `*${title}*\n${details}\n⚠️ *Alertes:*\n${alertsText}${commentsText}${linksText}`
        }
    };
}

// POST /api/slack/send-alerts
// Envoyer les alertes critiques sur Slack
router.post('/send-alerts', async (req, res) => {
    try {
        const { performanceAlerts, tradersAlerts, commerceAlerts } = req.body;
        
        // Les données sont déjà filtrées et nettoyées côté client
        const criticalPerf = performanceAlerts || [];
        const criticalTraders = tradersAlerts || [];
        const criticalCommerce = commerceAlerts || [];
        
        const totalCritical = criticalPerf.length + criticalTraders.length + criticalCommerce.length;
        
        if (totalCritical === 0) {
            return res.json({ success: true, message: 'Aucune alerte critique à envoyer' });
        }
        
        // Construire le message Slack
        const blocks = [
            {
                type: 'header',
                text: {
                    type: 'plain_text',
                    text: `🚨 Alertes Critiques - ${new Date().toLocaleDateString('fr-FR')}`,
                    emoji: true
                }
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*${totalCritical} alerte${totalCritical > 1 ? 's' : ''} critique${totalCritical > 1 ? 's' : ''}*`
                }
            },
            { type: 'divider' }
        ];
        
        // Section Performance
        if (criticalPerf.length > 0) {
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*📊 PERFORMANCE (${criticalPerf.length})*`
                }
            });
            
            criticalPerf.forEach(alert => {
                blocks.push(formatAlertForSlack(alert));
                blocks.push({ type: 'divider' });
            });
        }
        
        // Section Traders
        if (criticalTraders.length > 0) {
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*👥 TRADERS (${criticalTraders.length})*`
                }
            });
            
            criticalTraders.forEach(alert => {
                blocks.push(formatAlertForSlack(alert));
                blocks.push({ type: 'divider' });
            });
        }
        
        // Section Commerce
        if (criticalCommerce.length > 0) {
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*💼 COMMERCE (${criticalCommerce.length})*`
                }
            });
            
            criticalCommerce.forEach(alert => {
                blocks.push(formatAlertForSlack(alert));
                blocks.push({ type: 'divider' });
            });
        }
        
        // Envoyer sur Slack
        await sendSlackMessage(blocks);
        
        res.json({ 
            success: true, 
            message: `${totalCritical} alerte${totalCritical > 1 ? 's' : ''} envoyée${totalCritical > 1 ? 's' : ''} sur Slack` 
        });
        
    } catch (error) {
        console.error('Erreur envoi Slack:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
