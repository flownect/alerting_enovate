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

// Formater une alerte pour Slack
function formatAlertForSlack(alert, perfData) {
    const card = alert.card || alert.campaign;
    const title = card.title || card.campaignName || 'Sans nom';
    const trader = alert.trader || 'N/A';
    const commercial = alert.commercial || card.commercial || 'N/A';
    
    // Liens
    const novaLink = card.campaignId || card.briefId?.briefCampaignInfo?.[0] 
        ? `https://dashboard.e-novate.fr/trader/edition-campagne?id=${card.campaignId || card.briefId.briefCampaignInfo[0]}`
        : null;
    
    let adxLink = null;
    if (card.adxCampaignUrl) {
        adxLink = card.adxCampaignUrl;
    } else if (card.comments && Array.isArray(card.comments)) {
        const adxComment = card.comments.find(c => 
            c.content && c.content.includes('hubscale.io/manager/campaigns/view/')
        );
        if (adxComment) adxLink = adxComment.content.trim();
    }
    
    // Infos campagne
    let details = `*Trader:* ${trader}\n*Commercial:* ${commercial}\n`;
    
    if (alert.durationProgress !== undefined) {
        details += `*Durée:* ${Math.round(alert.durationProgress)}%\n`;
    }
    
    if (alert.deliveryProgress !== undefined) {
        details += `*Volume:* ${Math.round(alert.deliveryProgress)}%\n`;
    }
    
    if (alert.marginRate !== null && alert.marginRate !== undefined) {
        details += `*Marge:* ${alert.marginRate.toFixed(1)}%\n`;
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
    if (card.comments && Array.isArray(card.comments)) {
        const recentComments = card.comments
            .filter(c => !c.isAdx && c.content && !c.content.includes('hubscale.io'))
            .slice(0, 3);
        
        if (recentComments.length > 0) {
            commentsText = '\n*💬 Commentaires récents:*\n' + 
                recentComments.map(c => `• ${c.content} (${c.author?.name || 'Anonyme'})`).join('\n');
        }
    }
    
    // Liens
    let linksText = '';
    if (novaLink || adxLink) {
        linksText = '\n';
        if (novaLink) linksText += `<${novaLink}|Nova>`;
        if (novaLink && adxLink) linksText += ' | ';
        if (adxLink) linksText += `<${adxLink}|ADX>`;
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
        
        // Filtrer seulement les critiques
        const criticalPerf = (performanceAlerts || []).filter(a => a.level === 'critique');
        const criticalTraders = (tradersAlerts || []).filter(a => a.criticality === 'critical');
        const criticalCommerce = (commerceAlerts || []).filter(a => a.criticality === 'critical');
        
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
