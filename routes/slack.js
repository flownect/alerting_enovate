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
    
    // Badges/Étiquettes (timing, types d'alertes)
    let badges = '';
    
    // Jours restants en premier
    if (alert.daysLeft !== null && alert.daysLeft !== undefined && alert.daysLeft > 0) {
        badges += `⏱️ ${alert.daysLeft}j restants\n`;
    } else if (alert.timing) {
        badges += `⏱️ ${alert.timing}\n`;
    }
    
    // Types d'alertes en badges
    if (alert.reasons && alert.reasons.length > 0) {
        const types = [];
        alert.reasons.forEach(r => {
            if (r.includes('Marge')) types.push('Marge');
            if (r.includes('diffuse pas')) types.push('Pas de diffusion');
            if (r.includes('Retard')) types.push('Retard volume');
            if (r.includes('CTR') || r.includes('VCR') || r.includes('Sessions') || r.includes('Visite LP')) types.push('Performance');
        });
        if (types.length > 0) {
            badges += types.join('\n') + '\n';
        }
    } else if (alert.message) {
        if (alert.message.includes('non programmable')) badges += 'Lancement\n';
        if (alert.message.includes('sans trader')) badges += 'Trader\n';
        if (alert.message.includes('non live')) badges += 'Non Live\n';
    }
    
    // Alertes détaillées
    let alertsText = '';
    if (alert.reasons && alert.reasons.length > 0) {
        alertsText = alert.reasons.map(r => {
            if (r.includes('Marge')) return `💰 ${r}`;
            if (r.includes('diffuse pas')) return `🚫 ${r}`;
            if (r.includes('Retard')) return `📉 ${r}`;
            if (r.includes('CTR') || r.includes('VCR')) return `📊 ${r}`;
            if (r.includes('Sessions') || r.includes('Visite LP')) return `🔗 ${r}`;
            return `⚠️ ${r}`;
        }).join('\n');
    } else if (alert.message) {
        alertsText = `⚠️ ${alert.message}`;
    }
    
    // Durée et dates
    let durationText = '';
    if (alert.durationProgress !== undefined) {
        durationText = `*Durée:* ${alert.durationProgress}%`;
        if (alert.daysLeft !== null && alert.daysLeft !== undefined) {
            durationText += ` • ${alert.daysLeft}j restants`;
        }
        durationText += '\n';
    }
    if (alert.startDate && alert.endDate) {
        durationText += `*Dates:* ${alert.startDate} → ${alert.endDate}\n`;
    }
    
    // Infos complémentaires
    let details = `*Trader:* ${trader}\n*Commercial:* ${commercial}\n`;
    
    if (alert.deliveryProgress !== undefined) {
        details += `*Volume:* ${alert.deliveryProgress}%\n`;
    }
    
    if (alert.marginRate) {
        details += `*Marge:* ${alert.marginRate}%\n`;
    }
    
    // Commentaires Nova
    let commentsNovaText = '';
    if (alert.commentsNova && alert.commentsNova.length > 0) {
        commentsNovaText = '\n*💬 Commentaires Nova:*\n' + 
            alert.commentsNova.map(c => `• ${c}`).join('\n');
    }
    
    // Commentaires Dashboard
    let commentsDashboardText = '';
    if (alert.commentsDashboard && alert.commentsDashboard.length > 0) {
        commentsDashboardText = '\n*💬 Commentaires Dashboard:*\n' + 
            alert.commentsDashboard.map(c => `• ${c}`).join('\n');
    }
    
    // Fallback pour les alertes Traders/Commerce qui n'ont qu'un seul type
    if (!commentsNovaText && !commentsDashboardText && alert.comments && alert.comments.length > 0) {
        commentsDashboardText = '\n*💬 Commentaires:*\n' + 
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
            text: `*${title}*\n\n${badges}\n${alertsText}\n\n${durationText}\n${details}${commentsNovaText}${commentsDashboardText}${linksText}`
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
                    text: `*${totalCritical} alerte${totalCritical > 1 ? 's' : ''} critique${totalCritical > 1 ? 's' : ''}*\n📊 Performance: ${criticalPerf.length} | 👥 Traders: ${criticalTraders.length} | 💼 CSM: ${criticalCommerce.length}`
                }
            },
            { type: 'divider' }
        ];
        
        // Section Performance
        if (criticalPerf.length > 0) {
            blocks.push({ type: 'divider' });
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*📊 ALERTES PERFORMANCE (${criticalPerf.length})*`
                }
            });
            blocks.push({ type: 'divider' });
            
            criticalPerf.forEach(alert => {
                blocks.push(formatAlertForSlack(alert));
                blocks.push({ type: 'divider' });
            });
        }
        
        // Section Traders
        if (criticalTraders.length > 0) {
            blocks.push({ type: 'divider' });
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*👥 ALERTES TRADERS (${criticalTraders.length})*`
                }
            });
            blocks.push({ type: 'divider' });
            
            criticalTraders.forEach(alert => {
                blocks.push(formatAlertForSlack(alert));
                blocks.push({ type: 'divider' });
            });
        }
        
        // Section Commerce (CSM)
        if (criticalCommerce.length > 0) {
            blocks.push({ type: 'divider' });
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*💼 ALERTES CSM (${criticalCommerce.length})*`
                }
            });
            blocks.push({ type: 'divider' });
            
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
